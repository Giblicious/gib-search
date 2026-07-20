import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.id !== 'gib-search') throw new Error('manifest id must be gib-search');
if (manifest.name !== 'Gib Search') throw new Error('manifest name must be Gib Search');
if (!/^0\.\d+\.\d+$/.test(manifest.version)) throw new Error('public beta versions must remain in 0.x.x');
if (manifest.isDesktopOnly) throw new Error('Gib Search must remain available on mobile');

const builtMain = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const embeddedMatch = builtMain.match(/^(?:const|var) EMBEDDED_RUNTIME = (\{.*\});$/m);
if (!embeddedMatch) throw new Error('main.js does not contain the embedded runtime');
const embeddedRuntime = JSON.parse(embeddedMatch[1]);
for (const [relativePath, encoded] of Object.entries(embeddedRuntime)) {
  const source = fs.readFileSync(path.join(root, 'worker', relativePath));
  if (!Buffer.from(encoded, 'base64').equals(source)) throw new Error(`Embedded runtime differs from worker/${relativePath}`);
}

const codeFiles = [
  'main.js', 'src/main.js', 'src/mobile-runtime.js', 'styles.css', 'worker/embed-server.mjs',
  'worker/lib/chunker.mjs', 'worker/lib/engine.mjs', 'worker/lib/indexer.mjs',
  'worker/lib/status.mjs', 'worker/lib/watcher.mjs',
];
const forbidden = [
  /\x62\x65\x74\x74\x65\x72\x20\x63\x6c\x61\x75\x64\x65/i,
  /\b\x63\x6c\x61\x75\x64\x65\b/i,
  /\b\x63\x6f\x64\x65\x78\b/i,
  /\b\x63\x68\x61\x74\x67\x70\x74\b/i,
  /\bbc embed\b/i, /agent's semantic_search/i, /sdk mcp/i,
  /C:\\Users\\/i, /[A-Z]:\\Tucker\\/i, /console\.(?:log|debug)\s*\(/,
];
for (const relativePath of codeFiles) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const pattern of forbidden) {
    if (relativePath === 'main.js' && String(pattern).includes('console')) continue;
    if (pattern.test(source)) throw new Error(`${relativePath} contains forbidden public-release text: ${pattern}`);
  }
  if (/\.(?:js|mjs)$/.test(relativePath)) execFileSync(process.execPath, ['--check', path.join(root, relativePath)], { stdio: 'inherit' });
}

for (const required of ['main.js', 'manifest.json', 'styles.css', 'versions.json', 'README.md', 'LICENSE', 'SECURITY.md']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing public release file: ${required}`);
}

console.log(`Gib Search ${manifest.version} passed build, syntax, manifest, and public-content checks.`);
