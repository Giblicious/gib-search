const FORMAT_VERSION = 1;

function bytesToBase64(bytes) {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(result);
}
function base64ToBytes(value) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function gzip(bytes) {
  if (typeof CompressionStream !== 'function') return { bytes, encoding: 'identity' };
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), encoding: 'gzip' };
}
async function gunzip(bytes, encoding) {
  if (encoding !== 'gzip') return bytes;
  if (typeof DecompressionStream !== 'function') throw new Error('This device cannot decompress the mobile bootstrap package');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function ensureDirectory(adapter, directory) {
  let current = '';
  for (const part of String(directory || '').replace(/\\/g, '/').split('/').filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!await adapter.exists(current)) await adapter.mkdir(current);
  }
}
function bufferSlice(bytes) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }

export function bootstrapBucket(path, count = 16) {
  let hash = 2166136261;
  for (const character of String(path || '')) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % count;
}

export async function writeMobileBootstrap(adapter, directory, value) {
  let previous = null; try { if (await adapter.exists(`${directory}/manifest.json`)) previous = JSON.parse(await adapter.read(`${directory}/manifest.json`)); } catch {}
  const generation = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, encoder = new TextEncoder(), segmentCount = 16, groups = Array.from({ length: segmentCount }, () => ({ meta: [], vectors: [] }));
  value.meta.forEach((item, index) => { const group = groups[bootstrapBucket(item.file, segmentCount)]; group.meta.push(item); group.vectors.push(value.vectors[index]); });
  await ensureDirectory(adapter, directory);
  const segments = [];
  for (let bucket = 0; bucket < groups.length; bucket++) {
    const group = groups[bucket], packed = new Float32Array(group.vectors.length * value.dimension);
    group.vectors.forEach((vector, index) => packed.set(vector, index * value.dimension));
    const raw = encoder.encode(JSON.stringify({ version: FORMAT_VERSION, meta: group.meta, vectors: bytesToBase64(new Uint8Array(packed.buffer)) })), compressed = await gzip(raw), name = `${generation}.${String(bucket).padStart(2, '0')}.json${compressed.encoding === 'gzip' ? '.gz' : ''}`;
    await adapter.writeBinary(`${directory}/${name}`, bufferSlice(compressed.bytes));
    segments.push({ name, bucket, bytes: compressed.bytes.byteLength, sha256: await digest(compressed.bytes), encoding: compressed.encoding, records: group.meta.length });
  }
  const manifest = { format: 'gib-search-mobile-bootstrap', version: FORMAT_VERSION, generation, createdAt: Date.now(), modelId: value.modelId, dtype: 'q8', dimension: value.dimension, passageVersion: value.passageVersion, chunkCharacters: value.chunkCharacters, files: new Set(value.meta.map(item => item.file)).size, records: value.meta.length, segments };
  await adapter.write(`${directory}/manifest.json.download`, JSON.stringify(manifest));
  if (await adapter.exists(`${directory}/manifest.json`)) await adapter.remove(`${directory}/manifest.json`);
  await adapter.rename(`${directory}/manifest.json.download`, `${directory}/manifest.json`);
  for (const segment of previous?.segments || []) if (segment?.name && !segments.some(current => current.name === segment.name)) try { if (await adapter.exists(`${directory}/${segment.name}`)) await adapter.remove(`${directory}/${segment.name}`); } catch {}
  return manifest;
}

export async function readMobileBootstrap(adapter, directory) {
  const manifestPath = `${directory}/manifest.json`;
  if (!await adapter.exists(manifestPath)) return null;
  const manifest = JSON.parse(await adapter.read(manifestPath));
  if (manifest?.format !== 'gib-search-mobile-bootstrap' || manifest.version !== FORMAT_VERSION || !Array.isArray(manifest.segments)) throw new Error('Unsupported mobile bootstrap manifest');
  const decoder = new TextDecoder(), meta = [], vectors = [];
  for (const segment of manifest.segments) {
    const path = `${directory}/${segment.name}`;
    if (!await adapter.exists(path)) throw new Error(`Mobile bootstrap segment has not synced yet: ${segment.name}`);
    const compressed = new Uint8Array(await adapter.readBinary(path));
    if (compressed.byteLength !== Number(segment.bytes) || await digest(compressed) !== segment.sha256) throw new Error(`Mobile bootstrap segment failed validation: ${segment.name}`);
    const payload = JSON.parse(decoder.decode(await gunzip(compressed, segment.encoding)));
    if (payload.version !== FORMAT_VERSION || !Array.isArray(payload.meta)) throw new Error(`Mobile bootstrap segment is invalid: ${segment.name}`);
    const packedBytes = base64ToBytes(payload.vectors || ''), expectedBytes = payload.meta.length * Number(manifest.dimension) * 4;
    if (packedBytes.byteLength !== expectedBytes) throw new Error(`Mobile bootstrap vectors are incomplete: ${segment.name}`);
    const packed = new Float32Array(packedBytes.buffer, packedBytes.byteOffset, packedBytes.byteLength / 4);
    payload.meta.forEach((item, index) => { meta.push(item); vectors.push(new Float32Array(packed.slice(index * manifest.dimension, (index + 1) * manifest.dimension))); });
  }
  if (meta.length !== Number(manifest.records)) throw new Error('Mobile bootstrap record count does not match its manifest');
  return { manifest, meta, vectors };
}
