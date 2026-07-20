import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeFiles = [
  'embed-server.mjs',
  'package.json',
  'package-lock.json',
  'lib/chunker.mjs',
  'lib/engine.mjs',
  'lib/indexer.mjs',
  'lib/status.mjs',
  'lib/watcher.mjs',
];

const runtime = Object.fromEntries(runtimeFiles.map(relativePath => {
  const contents = fs.readFileSync(path.join(root, 'worker', relativePath));
  return [relativePath, contents.toString('base64')];
}));

const source = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const marker = 'const EMBEDDED_RUNTIME = null;';
if (!source.includes(marker)) throw new Error('Runtime marker is missing from src/main.js');
fs.writeFileSync(path.join(root, 'main.js'), source.replace(marker, `const EMBEDDED_RUNTIME = ${JSON.stringify(runtime)};`));
