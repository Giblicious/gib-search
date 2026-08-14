import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!fs.existsSync(chrome)) throw new Error(`Chrome was not found at ${chrome}; set CHROME_PATH to run this optional smoke check`);

const wasm = fs.readFileSync(path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist', 'ort-wasm-simd-threaded.jsep.wasm'));
const wasmModule = fs.readFileSync(path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist', 'ort-wasm-simd-threaded.jsep.mjs'), 'utf8')
  .replace('n="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node&&"renderer"!=process.type', 'n=false')
  .replace("var isNode = typeof globalThis.process?.versions?.node == 'string';\nif (isNode) isPthread = (await import('worker_threads')).workerData === 'em-pthread';", 'var isNode = false;')
  .replace('Xa??=e.locateFile?e.locateFile?e.locateFile("ort-wasm-simd-threaded.jsep.wasm",v):v+"ort-wasm-simd-threaded.jsep.wasm":(new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url)).href', 'Xa??="embedded.wasm"');
const config = { type: 'init', mobile: false, preferWebGpu: true, hardwareConcurrency: 4, wasmThreads: 2, maximumEmbedBatchSize: 4, wasmGzip: zlib.gzipSync(wasm, { level: 9 }).toString('base64'), wasmModuleGzip: zlib.gzipSync(wasmModule, { level: 9 }).toString('base64') };
const workerBuild = await build({ entryPoints: [path.join(root, 'src', 'desktop-embed-worker.js')], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2020', conditions: ['browser', 'module', 'import'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' }, logLevel: 'silent', legalComments: 'none' });
const workerSource = workerBuild.outputFiles[0].text;

let finish;
const completed = new Promise(resolve => { finish = resolve; });
const page = `<!doctype html><meta charset="utf-8"><script type="module">
const [source, configuration] = await Promise.all([fetch('/worker.js').then(value => value.text()), fetch('/config').then(value => value.json())]);
const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { name: 'gib-search-webgpu-smoke' });
let profile = null;
worker.onmessage = async event => {
  const message = event.data;
  if (message.type === 'cache') { worker.postMessage({ type: 'cache-result', id: message.id }); return; }
  if (message.type === 'runtime-profile') { profile = message; return; }
  if (message.type === 'initialized') { worker.postMessage({ type: 'embed', id: 1, texts: ['Contained WebGPU semantic indexing smoke check.'], query: false, priority: 0 }); return; }
  if (message.type === 'result') { const vector = new Float32Array(message.buffers[0]); const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)); await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: vector.length === 384 && vector.every(Number.isFinite) && Math.abs(magnitude - 1) < .01, backend: profile?.backend, dtype: profile?.dtype, dimension: vector.length, magnitude }) }); return; }
  if (message.type === 'error') await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, error: message.message, backend: profile?.backend }) });
};
worker.onerror = event => fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, error: event.message }) });
worker.postMessage(configuration);
</script>`;
const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/result') { let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => { try { finish(JSON.parse(body)); } catch (error) { finish({ ok: false, error: error.message }); } response.end('ok'); }); return; }
  const [content, type] = request.url === '/worker.js' ? [workerSource, 'text/javascript'] : request.url === '/config' ? [JSON.stringify(config), 'application/json'] : [page, 'text/html'];
  response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' }); response.end(content);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address(), profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-search-webgpu-'));
const browser = spawn(chrome, [`--user-data-dir=${profileDirectory}`, '--headless=new', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-first-run', '--disable-sync', `http://127.0.0.1:${address.port}/`], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
let browserError = ''; browser.stderr.on('data', chunk => { browserError += chunk; });
const timeout = setTimeout(() => finish({ ok: false, error: 'Timed out waiting for the WebGPU embedding' }), 180000);
try {
  const result = await completed; clearTimeout(timeout);
  if (!result.ok || result.backend !== 'webgpu') throw new Error(`WebGPU smoke check failed: ${JSON.stringify(result)}${browserError ? `\n${browserError.slice(-1200)}` : ''}`);
  console.log(`WebGPU worker smoke check passed (${result.dtype}, ${result.dimension} dimensions, magnitude ${result.magnitude.toFixed(4)}).`);
} finally {
  clearTimeout(timeout); browser.kill();
  if (browser.exitCode === null) await Promise.race([new Promise(resolve => browser.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
  await new Promise(resolve => server.close(resolve));
  const temporaryRoot = path.resolve(os.tmpdir());
  if (path.resolve(profileDirectory).startsWith(`${temporaryRoot}${path.sep}`)) { try { fs.rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { console.warn(`Temporary Chrome profile retained at ${profileDirectory}`); } }
}
