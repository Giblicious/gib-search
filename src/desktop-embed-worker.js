const { pipeline, env } = require('@huggingface/transformers');

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
let configuration = null;
let pipe = null;
let modelPromise = null;
let nextCacheId = 1;
const pendingCache = new Map();
let embedQueue = Promise.resolve();

function requestKey(request) { return typeof request === 'string' ? request : request?.url || String(request || ''); }
function cacheRequest(action, key, buffer = null) {
  const id = nextCacheId++;
  return new Promise((resolve, reject) => {
    pendingCache.set(id, { resolve, reject });
    const message = { type: 'cache', id, action, key };
    if (buffer) { message.buffer = buffer; self.postMessage(message, [buffer]); } else self.postMessage(message);
  });
}

const modelCache = {
  async match(request) {
    const buffer = await cacheRequest('match', requestKey(request));
    return buffer ? new Response(buffer, { headers: { 'Content-Length': String(buffer.byteLength) } }) : undefined;
  },
  async put(request, response) { await cacheRequest('put', requestKey(request), await response.arrayBuffer()); },
};

async function gunzipBase64(encoded, text = false) {
  const compressed = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return text ? new Response(stream).text() : new Uint8Array(await new Response(stream).arrayBuffer());
}

async function initializeModel() {
  if (pipe) return pipe;
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    env.allowRemoteModels = true; env.allowLocalModels = false; env.useCustomCache = true; env.customCache = modelCache; env.useBrowserCache = false; env.useFSCache = false;
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
      const moduleSource = await gunzipBase64(configuration.wasmModuleGzip, true);
      env.backends.onnx.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' })) };
      env.backends.onnx.wasm.wasmBinary = await gunzipBase64(configuration.wasmGzip);
    }
    const loaded = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8', progress_callback: progress => {
      if (progress.status === 'progress' && Number.isFinite(Number(progress.progress))) self.postMessage({ type: 'progress', file: progress.file || 'BGE', progress: Number(progress.progress) });
    } });
    await loaded([`${QUERY_PREFIX}warm semantic search`], { pooling: 'mean', normalize: true });
    pipe = loaded; self.postMessage({ type: 'ready' }); return pipe;
  })();
  try { return await modelPromise; } finally { modelPromise = null; }
}

async function embed(texts, query) {
  const model = await initializeModel(); const input = texts.map(text => query ? `${QUERY_PREFIX}${text}` : text);
  const output = await model(input, { pooling: 'mean', normalize: true }); const dimension = output.dims.at(-1);
  const buffers = input.map((_, index) => new Float32Array(output.data.slice(index * dimension, (index + 1) * dimension)).buffer);
  return { buffers, transfer: buffers };
}

async function handleEmbed(message) {
  try { const result = await embed(message.texts || [], Boolean(message.query)); self.postMessage({ type: 'result', id: message.id, buffers: result.buffers }, result.transfer); }
  catch (error) { self.postMessage({ type: 'error', id: message.id, message: error?.message || String(error) }); }
}

self.onmessage = event => {
  const message = event.data;
  if (message.type === 'cache-result') {
    const pending = pendingCache.get(message.id); if (!pending) return; pendingCache.delete(message.id);
    if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.buffer || null); return;
  }
  if (message.type === 'init') { configuration = message; self.postMessage({ type: 'initialized' }); return; }
  if (message.type !== 'embed') return;
  embedQueue = embedQueue.then(() => handleEmbed(message));
};
