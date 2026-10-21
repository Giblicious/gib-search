import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function embeddedWasmArtifacts(root) {
  const base = path.join(root, 'node_modules/@huggingface/transformers/dist');
  const wasm = fs.readFileSync(path.join(base, 'ort-wasm-simd-threaded.jsep.wasm'));
  const source = fs.readFileSync(path.join(base, 'ort-wasm-simd-threaded.jsep.mjs'), 'utf8')
    .replace('n="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node&&"renderer"!=process.type', 'n=false')
    .replace("var isNode = typeof globalThis.process?.versions?.node == 'string';\nif (isNode) isPthread = (await import('worker_threads')).workerData === 'em-pthread';", 'var isNode = false;')
    .replace('Xa??=e.locateFile?e.locateFile?e.locateFile("ort-wasm-simd-threaded.jsep.wasm",v):v+"ort-wasm-simd-threaded.jsep.wasm":(new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url)).href', 'Xa??="embedded.wasm"');
  if (!source.includes('n=false') || !source.includes('var isNode = false;') || !source.includes('Xa??="embedded.wasm"')) throw new Error('Could not prepare the browser-only WASM module');
  const gzip = value => { const bytes = zlib.gzipSync(value, { level: 9 }); bytes[9] = 255; return bytes.toString('base64'); };
  return { wasmGzip: gzip(wasm), wasmModuleGzip: gzip(source) };
}
