import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
export function tarMember(tar, wanted) {
  // Read one checked archive member in memory; never extract archive paths.
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
    const field = (from, to) => header.subarray(from, to).toString().replace(/\0.*$/su, '').trim();
    const size = Number.parseInt(field(124, 136), 8), checksum = Number.parseInt(field(148, 156), 8);
    const sum = header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0);
    if (!Number.isSafeInteger(size) || size < 0 || sum !== checksum || offset + 512 + size > tar.length) throw new Error('Invalid Node runtime archive');
    const name = [field(345, 500), field(0, 100)].filter(Boolean).join('/');
    if (name === wanted && (header[156] === 0 || header[156] === 48)) return Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Node runtime archive member is missing');
}
export async function buildNodeRuntimes(root, output, runtimes) {
  const lock = JSON.parse(await fs.readFile(path.join(root, 'scripts/node-runtime-lock.json'))), cache = path.join(root, 'build/node-source'); await fs.mkdir(cache, { recursive: true });
  if (sha(await fs.readFile(path.join(root, 'licenses/node/LICENSE'))) !== lock.license.sha256) throw new Error('Node runtime license differs from its pinned source');
  for (const [platform, source] of Object.entries(lock.platforms)) {
    if (!runtimes[platform]) throw new Error(`Missing inference platform: ${platform}`);
    const sourceFile = path.join(cache, `${lock.version}-${platform}.source`), recordFile = sourceFile + '.json'; let bytes;
    try { bytes = await fs.readFile(sourceFile); if (sha(bytes) !== source.sha256) bytes = null; } catch {}
    if (!bytes) {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(180000) }); if (!response.ok) throw new Error(`Could not fetch pinned Node runtime: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer()); if (sha(bytes) !== source.sha256) throw new Error('Node source archive failed integrity verification');
      await fs.writeFile(sourceFile, bytes);
    }
    const asset = `node-${lock.version}-${platform}.gz`, assetPath = path.join(output, asset); let cached;
    try { const record = JSON.parse(await fs.readFile(recordFile)); if (record.sourceSha256 === source.sha256 && sha(await fs.readFile(assetPath)) === record.assetSha256) cached = record; } catch {}
    if (!cached) {
      const binary = source.member ? tarMember(zlib.gunzipSync(bytes), source.member) : bytes;
      const compressed = zlib.gzipSync(binary, { level: 9 }); compressed[9] = 255;
      await fs.writeFile(assetPath, compressed);
      cached = { name: `node-${lock.version}${platform.startsWith('win32-') ? '.exe' : ''}`, role: 'node', compression: 'gzip', asset, bytes: binary.length, sha256: sha(binary), assetBytes: compressed.length, assetSha256: sha(compressed), sourceSha256: source.sha256 };
      await fs.writeFile(recordFile, JSON.stringify(cached));
    }
    runtimes[platform].push(cached);
  }
  return lock.version;
}
