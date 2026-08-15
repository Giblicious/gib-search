const FORMAT_VERSION = 1;
export const MOBILE_BOOTSTRAP_SEGMENTS = 16;

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

function validManifest(manifest) {
  if (manifest?.format !== 'gib-search-mobile-bootstrap' || manifest.version !== FORMAT_VERSION || !Number.isInteger(Number(manifest.dimension)) || Number(manifest.dimension) < 1 || !Number.isInteger(Number(manifest.files)) || Number(manifest.files) < 0 || !Number.isInteger(Number(manifest.records)) || Number(manifest.records) < 0 || !Array.isArray(manifest.segments) || manifest.segments.length !== MOBILE_BOOTSTRAP_SEGMENTS) return false;
  const buckets = new Set(manifest.segments.map(segment => Number(segment?.bucket))), records = manifest.segments.reduce((sum, segment) => sum + Number(segment?.records || 0), 0); return records === Number(manifest.records) && buckets.size === MOBILE_BOOTSTRAP_SEGMENTS && [...buckets].every(bucket => Number.isInteger(bucket) && bucket >= 0 && bucket < MOBILE_BOOTSTRAP_SEGMENTS) && manifest.segments.every(segment => segment?.name && Number.isInteger(Number(segment.records)) && Number(segment.records) >= 0 && Number.isInteger(Number(segment.bytes)) && Number(segment.bytes) >= 0 && /^[a-f\d]{64}$/i.test(String(segment.sha256 || '')) && ['gzip', 'identity'].includes(segment.encoding));
}
export function mobileBootstrapFileIndex(manifest) {
  const index = new Map();
  for (const row of manifest?.fileIndex || []) {
    if (!Array.isArray(row) || row.length < 6 || !String(row[0] || '')) continue;
    const bucket = Number(row[4]), records = Number(row[5]); if (!Number.isInteger(bucket) || bucket < 0 || bucket >= MOBILE_BOOTSTRAP_SEGMENTS || !Number.isInteger(records) || records < 1) continue;
    index.set(String(row[0]), { mtime: Number(row[1]) || 0, size: Number(row[2]) || 0, contentHash: String(row[3] || ''), bucket, records });
  }
  return index;
}
export async function readMobileBootstrapManifest(adapter, directory) {
  const manifestPath = `${directory}/manifest.json`; if (!await adapter.exists(manifestPath)) return null;
  const manifest = JSON.parse(await adapter.read(manifestPath)); if (!validManifest(manifest)) throw new Error('Unsupported mobile bootstrap manifest'); return manifest;
}
export async function readMobileBootstrapSegment(adapter, directory, manifest, bucketOrSegment) {
  const segment = typeof bucketOrSegment === 'number' ? manifest?.segments?.find(item => Number(item.bucket) === bucketOrSegment) : bucketOrSegment;
  if (!segment?.name) throw new Error(`Mobile bootstrap segment is missing${typeof bucketOrSegment === 'number' ? ` for bucket ${bucketOrSegment}` : ''}`);
  const path = `${directory}/${segment.name}`; if (!await adapter.exists(path)) throw new Error(`Mobile bootstrap segment has not synced yet: ${segment.name}`);
  const compressed = new Uint8Array(await adapter.readBinary(path)); if (compressed.byteLength !== Number(segment.bytes) || await digest(compressed) !== segment.sha256) throw new Error(`Mobile bootstrap segment failed validation: ${segment.name}`);
  const payload = JSON.parse(new TextDecoder().decode(await gunzip(compressed, segment.encoding))); if (payload.version !== FORMAT_VERSION || !Array.isArray(payload.meta)) throw new Error(`Mobile bootstrap segment is invalid: ${segment.name}`);
  const packedBytes = base64ToBytes(payload.vectors || ''), dimension = Number(manifest.dimension), expectedBytes = payload.meta.length * dimension * 4; if (packedBytes.byteLength !== expectedBytes) throw new Error(`Mobile bootstrap vectors are incomplete: ${segment.name}`);
  const packed = new Float32Array(packedBytes.buffer, packedBytes.byteOffset, packedBytes.byteLength / 4), vectors = payload.meta.map((_, index) => new Float32Array(packed.slice(index * dimension, (index + 1) * dimension)));
  return { segment, meta: payload.meta, vectors };
}

export async function writeMobileBootstrap(adapter, directory, value) {
  let previous = value.previousManifest || null; if (!previous) try { previous = await readMobileBootstrapManifest(adapter, directory); } catch {}
  const generation = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, encoder = new TextEncoder(), incremental = value.buckets instanceof Map, groups = incremental ? value.buckets : new Map(Array.from({ length: MOBILE_BOOTSTRAP_SEGMENTS }, (_, bucket) => [bucket, { meta: [], vectors: [] }]));
  if (!incremental) value.meta.forEach((item, index) => { const group = groups.get(bootstrapBucket(item.file, MOBILE_BOOTSTRAP_SEGMENTS)); group.meta.push(item); group.vectors.push(value.vectors[index]); });
  await ensureDirectory(adapter, directory);
  const segments = []; let reusedSegments = 0, changedSegments = 0;
  for (let bucket = 0; bucket < MOBILE_BOOTSTRAP_SEGMENTS; bucket++) {
    if (!groups.has(bucket)) {
      const retained = previous?.segments?.find(segment => Number(segment.bucket) === bucket); if (!retained?.name || !await adapter.exists(`${directory}/${retained.name}`)) throw new Error(`Cannot reuse missing mobile bootstrap bucket ${bucket}`);
      segments.push(retained); reusedSegments++; continue;
    }
    const group = groups.get(bucket) || { meta: [], vectors: [] }, packed = new Float32Array(group.vectors.length * value.dimension);
    group.vectors.forEach((vector, index) => packed.set(vector, index * value.dimension));
    const raw = encoder.encode(JSON.stringify({ version: FORMAT_VERSION, meta: group.meta, vectors: bytesToBase64(new Uint8Array(packed.buffer)) })), compressed = await gzip(raw), name = `${generation}.${String(bucket).padStart(2, '0')}.json${compressed.encoding === 'gzip' ? '.gz' : ''}`;
    await adapter.writeBinary(`${directory}/${name}`, bufferSlice(compressed.bytes));
    segments.push({ name, bucket, bytes: compressed.bytes.byteLength, sha256: await digest(compressed.bytes), encoding: compressed.encoding, records: group.meta.length }); changedSegments++;
  }
  const fileIndex = value.fileIndex instanceof Map ? [...value.fileIndex].map(([path, state]) => [path, Number(state.mtime) || 0, Number(state.size) || 0, String(state.contentHash || ''), Number(state.bucket), Number(state.records)]) : null;
  const manifest = { format: 'gib-search-mobile-bootstrap', version: FORMAT_VERSION, generation, createdAt: Date.now(), modelId: value.modelId, dtype: 'q8', dimension: value.dimension, passageVersion: value.passageVersion, chunkCharacters: value.chunkCharacters, files: fileIndex ? fileIndex.length : new Set(value.meta.map(item => item.file)).size, records: fileIndex ? fileIndex.reduce((sum, row) => sum + row[5], 0) : value.meta.length, segments, ...(fileIndex ? { fileIndex, reusedSegments, changedSegments } : {}) };
  await adapter.write(`${directory}/manifest.json.download`, JSON.stringify(manifest));
  if (await adapter.exists(`${directory}/manifest.json`)) await adapter.remove(`${directory}/manifest.json`);
  await adapter.rename(`${directory}/manifest.json.download`, `${directory}/manifest.json`);
  for (const segment of previous?.segments || []) if (segment?.name && !segments.some(current => current.name === segment.name)) try { if (await adapter.exists(`${directory}/${segment.name}`)) await adapter.remove(`${directory}/${segment.name}`); } catch {}
  return manifest;
}

export async function readMobileBootstrap(adapter, directory) {
  const manifest = await readMobileBootstrapManifest(adapter, directory); if (!manifest) return null; const meta = [], vectors = [];
  for (const segment of manifest.segments) { const value = await readMobileBootstrapSegment(adapter, directory, manifest, segment); meta.push(...value.meta); vectors.push(...value.vectors); }
  if (meta.length !== Number(manifest.records)) throw new Error('Mobile bootstrap record count does not match its manifest');
  return { manifest, meta, vectors };
}
