import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasm = fs.readFileSync(path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist', 'ort-wasm-simd-threaded.jsep.wasm'));
const embeddedWasm = zlib.gzipSync(wasm, { level: 9 }).toString('base64');
const marker = 'const EMBEDDED_WASM_GZIP = null;';
const source = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8').replace(marker, `const EMBEDDED_WASM_GZIP = '${embeddedWasm}';`);
await build({
  stdin: { contents: source, resolveDir: path.join(root, 'src'), sourcefile: 'main.js', loader: 'js' },
  outfile: path.join(root, 'main.js'), bundle: true, platform: 'browser', format: 'cjs', target: 'es2020',
  external: ['obsidian', 'electron', 'fs', 'path', 'os', 'crypto', 'node:*'],
  conditions: ['browser', 'module', 'import'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' },
  logLevel: 'warning', legalComments: 'none',
});
const outputPath = path.join(root, 'main.js');
fs.writeFileSync(outputPath, fs.readFileSync(outputPath, 'utf8').replace(/[ \t]+$/gm, ''));
