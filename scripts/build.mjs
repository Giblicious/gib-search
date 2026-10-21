import fs from 'node:fs';
import path from 'node:path';
import { embeddedWasmArtifacts } from './embedded-wasm.mjs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildInNoteWorkers } from './build-in-note-worker.mjs';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readerRoot = path.join(root, 'model-assets/in-note-reader');
for (const [file, expected] of Object.entries(JSON.parse(fs.readFileSync(path.join(readerRoot, 'asset-manifest.json'), 'utf8')))) {
  const bytes = fs.readFileSync(path.join(readerRoot, file));
  if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`Reader asset hash mismatch: ${file}`);
}
const { wasmGzip: embeddedWasm, wasmModuleGzip: embeddedWasmModule } = embeddedWasmArtifacts(root);
const workerBuild = await build({
  entryPoints: [path.join(root, 'src', 'desktop-embed-worker.js')], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2020',
  conditions: ['browser', 'module', 'import'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' },
  logLevel: 'warning', legalComments: 'none',
});
const embeddedDesktopWorker = workerBuild.outputFiles[0].text;
const inNoteWorkers = await buildInNoteWorkers();
const readerAssets = JSON.parse(fs.readFileSync(path.join(root, 'model-assets/in-note-reader/asset-manifest.json'), 'utf8'));
const marker = 'const EMBEDDED_WASM_GZIP = null;';
const moduleMarker = 'const EMBEDDED_WASM_MODULE_GZIP = null;';
const workerMarker = 'const EMBEDDED_DESKTOP_WORKER = null;';
const source = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8')
  .replace(marker, `const EMBEDDED_WASM_GZIP = '${embeddedWasm}';`)
  .replace(moduleMarker, `const EMBEDDED_WASM_MODULE_GZIP = '${embeddedWasmModule}';`)
  .replace(workerMarker, () => `const EMBEDDED_DESKTOP_WORKER = ${JSON.stringify(embeddedDesktopWorker)};`)
  .replace('const EMBEDDED_IN_NOTE_BROWSER = null;', () => `const EMBEDDED_IN_NOTE_BROWSER = ${JSON.stringify(inNoteWorkers.browser)};`)
  .replace('const EMBEDDED_IN_NOTE_NATIVE = null;', () => `const EMBEDDED_IN_NOTE_NATIVE = ${JSON.stringify(inNoteWorkers.native)};`)
  .replace('const IN_NOTE_RUNTIME = null;', () => `const IN_NOTE_RUNTIME = ${JSON.stringify(inNoteWorkers.metadata)};`)
  .replace('const IN_NOTE_READER_ASSETS = null;', () => `const IN_NOTE_READER_ASSETS = ${JSON.stringify(readerAssets)};`);
await build({
  stdin: { contents: source, resolveDir: path.join(root, 'src'), sourcefile: 'main.js', loader: 'js' },
  outfile: path.join(root, 'main.js'), bundle: true, platform: 'browser', format: 'cjs', target: 'es2020',
  external: ['obsidian', 'electron', 'fs', 'path', 'os', 'crypto', 'node:*'],
  conditions: ['browser', 'module', 'import'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' },
  logLevel: 'warning', legalComments: 'none',
});
const outputPath = path.join(root, 'main.js');
const notices = ['THIRD_PARTY_NOTICES.txt', 'licenses/mxbai/LICENSE', 'licenses/node/LICENSE', 'licenses/onnxruntime/LICENSE', 'licenses/onnxruntime/DirectML-LICENSE.txt', 'licenses/onnxruntime/ThirdPartyNotices.txt'].map(file => `${file}\n${fs.readFileSync(path.join(root, file), 'utf8')}`).join('\n\n').replace(/\r\n?/gu, '\n').replace(/\t/gu, '    ').replace(/[ \t]+$/gm, '');
fs.writeFileSync(path.join(root, 'build/in-note-runtime/in-note-notices.txt'), notices + '\n');
fs.writeFileSync(outputPath, fs.readFileSync(outputPath, 'utf8').replace(/[ \t]+$/gm, '') + `\n/*!\n${notices.replace(/\*\//g, '* /')}\n*/\n`);
