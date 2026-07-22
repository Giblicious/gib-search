const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline, env } = require('@huggingface/transformers');

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
let configuration = null;
let pipe = null;
let modelPromise = null;

function modelCachePath(root, request) {
  let key = typeof request === 'string' ? request : request?.url || String(request || '');
  try { const url = new URL(key); key = decodeURIComponent(url.pathname.replace(/^\//, '').replace('/resolve/main/', '/')); } catch { key = key.replace(/^\/?models\//, '').replace(/^\//, ''); }
  const safe = key.split('/').filter(part => part && part !== '.' && part !== '..').join(path.sep);
  const target = path.resolve(root, safe);
  return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null;
}

class FileModelCache {
  constructor(root) { this.root = root; }
  async match(request) {
    const target = modelCachePath(this.root, request);
    if (!target || !fs.existsSync(target)) return undefined;
    const data = await fs.promises.readFile(target);
    return new Response(data, { headers: { 'Content-Length': String(data.length) } });
  }
  async put(request, response) {
    const target = modelCachePath(this.root, request);
    if (!target) throw new Error('Invalid model cache path');
    const data = Buffer.from(await response.arrayBuffer());
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.download`;
    await fs.promises.writeFile(temporary, data);
    await fs.promises.rename(temporary, target);
  }
}

async function initializeModel() {
  if (pipe) return pipe;
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    if (!configuration) throw new Error('Desktop embedding worker was not initialized');
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.useCustomCache = true;
    env.customCache = new FileModelCache(configuration.modelDir);
    env.useBrowserCache = false;
    env.useFSCache = false;
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
      const moduleSource = zlib.gunzipSync(Buffer.from(configuration.wasmModuleGzip, 'base64')).toString('utf8');
      env.backends.onnx.wasm.wasmPaths = { mjs: `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}` };
      env.backends.onnx.wasm.wasmBinary = new Uint8Array(zlib.gunzipSync(Buffer.from(configuration.wasmGzip, 'base64')));
    }
    const loaded = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',
      progress_callback: progress => {
        if (progress.status === 'progress' && Number.isFinite(Number(progress.progress))) parentPort.postMessage({ type: 'progress', file: progress.file || 'BGE', progress: Number(progress.progress) });
      },
    });
    await loaded([`${QUERY_PREFIX}warm semantic search`], { pooling: 'mean', normalize: true });
    pipe = loaded;
    parentPort.postMessage({ type: 'ready' });
    return pipe;
  })();
  try { return await modelPromise; } finally { modelPromise = null; }
}

async function embed(texts, query) {
  const model = await initializeModel();
  const input = texts.map(text => query ? `${QUERY_PREFIX}${text}` : text);
  const output = await model(input, { pooling: 'mean', normalize: true });
  const dimension = output.dims.at(-1);
  const vectors = input.map((_, index) => new Float32Array(output.data.slice(index * dimension, (index + 1) * dimension)));
  const buffers = vectors.map(vector => vector.buffer);
  return { buffers, transfer: buffers };
}

parentPort.on('message', async message => {
  if (message.type === 'init') { configuration = message; parentPort.postMessage({ type: 'initialized' }); return; }
  if (message.type !== 'embed') return;
  try {
    const result = await embed(message.texts || [], Boolean(message.query));
    parentPort.postMessage({ type: 'result', id: message.id, buffers: result.buffers }, result.transfer);
  } catch (error) {
    parentPort.postMessage({ type: 'error', id: message.id, message: error?.message || String(error) });
  }
});
