import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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
const bundledSource = source.replace(marker, `const EMBEDDED_RUNTIME = ${JSON.stringify(runtime)};`);
await build({
  stdin: { contents: bundledSource, resolveDir: path.join(root, 'src'), sourcefile: 'main.js', loader: 'js' },
  outfile: path.join(root, 'main.js'), bundle: true, platform: 'browser', format: 'cjs', target: 'es2020',
  external: ['obsidian', 'electron', 'child_process', 'fs', 'path', 'http', 'os', 'crypto', 'node:*'],
  conditions: ['browser', 'module', 'import'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning', legalComments: 'none',
});
const outputPath = path.join(root, 'main.js');
fs.writeFileSync(outputPath, fs.readFileSync(outputPath, 'utf8').replace(/[ \t]+$/gm, ''));
