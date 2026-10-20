import { pipeline, env } from '@huggingface/transformers';
import { embedInNote } from './in-note-embedding.js';
import { sentenceReaderInputs, sentenceReaderResults } from './in-note-sentence-codec.js';

const native = __GIB_NATIVE_IN_NOTE__;
const READER_REVISION = '0.54.67';
const definitions = {
  embed: ['feature-extraction', 'Xenova/bge-small-en-v1.5', 'ea104dacec62c0de699686887e3f920caeb4f3e3'],
  classify: ['text-classification', 'Xenova/mobilebert-uncased-mnli', '8b0ea66ab7b190bba77418ba03b67d69cfc9a1ee'],
  rank: ['text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', 'a09144355adeed5f58c8ed011d209bf8ee5a1fec'],
  guard: ['text-classification', 'Xenova/nli-deberta-v3-xsmall', '2a4f614a701367a02d51389039afc998faeda637'],
  read: ['text-classification', 'Giblicious/gib-search', READER_REVISION],
};
let configuration, nextCacheId = 0, queue = Promise.resolve();
const pendingCache = new Map(), models = new Map();
const post = (message, transfers) => self.postMessage(message, transfers || []);
const keyOf = request => typeof request === 'string' ? request : request.url;
function cache(action, key, buffer) {
  const id = ++nextCacheId;
  return new Promise((resolve, reject) => { pendingCache.set(id, { resolve, reject }); post({ type: 'cache', id, action, key, ...(buffer ? { buffer } : {}) }, buffer ? [buffer] : []); });
}
async function validateReaderFile(url, buffer) {
  if (!url.startsWith(`https://raw.githubusercontent.com/Giblicious/gib-search/${READER_REVISION}/model-assets/in-note-reader/`)) return;
  const filename = url.split('/model-assets/in-note-reader/')[1], expected = configuration.readerAssets?.[filename];
  if (!expected) return;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (buffer.byteLength !== expected.bytes || hash !== expected.sha256) throw new Error('Local reader asset failed integrity verification');
}
async function gunzip(encoded, text = false) {
  const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return text ? new Response(stream).text() : new Uint8Array(await new Response(stream).arrayBuffer());
}
async function initialize(message) {
  configuration = message;
  const fetchModel = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (request, options) => {
    const response = await fetchModel(request, options), url = keyOf(request);
    if (!response.ok || !url.startsWith(`https://raw.githubusercontent.com/Giblicious/gib-search/${READER_REVISION}/model-assets/in-note-reader/`)) return response;
    const expected = configuration.readerAssets?.[url.split('/model-assets/in-note-reader/')[1]];
    if (!expected) return response;
    const data = new Uint8Array(expected.bytes), stream = response.body.getReader(); let received = 0, lastProgress = 0;
    for (;;) {
      const { value, done } = await stream.read(); if (done) break;
      if (received + value.length > data.length) { await stream.cancel(); throw new Error('Local reader asset exceeds its expected size'); }
      data.set(value, received); received += value.length;
      if (Date.now() - lastProgress > 500) { post({ type: 'progress', kind: 'read', progress: received / data.length * 100 }); lastProgress = Date.now(); }
    }
    if (received !== data.length) throw new Error('Local reader asset download is incomplete');
    const buffer = data.buffer; await validateReaderFile(url, buffer);
    return new Response(buffer, { status: response.status, headers: response.headers });
  };
  env.allowRemoteModels = true; env.allowLocalModels = false; env.useFSCache = false; env.useBrowserCache = false; env.useCustomCache = true;
  env.customCache = {
    async match(request) {
      const url = keyOf(request), buffer = await cache('match', url);
      if (!buffer) return undefined;
      try { await validateReaderFile(url, buffer); } catch { return undefined; }
      return new Response(buffer, { headers: { 'Content-Length': String(buffer.byteLength) } });
    },
    async put(request, response) { const url = keyOf(request), buffer = await response.arrayBuffer(); await validateReaderFile(url, buffer); await cache('put', url, buffer); },
  };
  if (!native) {
    env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([await gunzip(message.wasmModuleGzip, true)], { type: 'text/javascript' })) };
    env.backends.onnx.wasm.wasmBinary = await gunzip(message.wasmGzip);
  }
  return { backend: native ? 'native-cpu' : 'wasm', threads: native ? Math.max(1, Math.min(2, message.cores || 2)) : 1 };
}
async function model(kind) {
  if (models.has(kind)) return models.get(kind);
  const definition = definitions[kind]; if (!definition) throw new Error('Unknown in-note model');
  const options = { dtype: kind === 'embed' ? 'fp32' : 'q8', device: native ? 'cpu' : 'wasm', ...(definition[2] ? { revision: definition[2] } : {}), session_options: { intraOpNumThreads: native ? Math.max(1, Math.min(2, configuration.cores || 2)) : 1, interOpNumThreads: 1, ...(kind === 'read' ? { graphOptimizationLevel: 'basic' } : {}) }, progress_callback: progress => { if (progress.status === 'progress') post({ type: 'progress', kind, progress: Number(progress.progress) || 0 }); } };
  const host = env.remoteHost, template = env.remotePathTemplate;
  try {
    if (kind === 'read') { env.remoteHost = 'https://raw.githubusercontent.com/'; env.remotePathTemplate = '{model}/{revision}/model-assets/in-note-reader/'; }
    const loaded = await pipeline(definition[0], definition[1], options);
    if (kind === 'read' && loaded.model.config.reader_sentence_check !== true) throw new Error('The local reader does not preserve sentence checks');
    models.set(kind, loaded); return loaded;
  } finally { env.remoteHost = host; env.remotePathTemplate = template; }
}
async function classify(kind, pairs) {
  if (!pairs.length) return [];
  const loaded = await model(kind), result = [], batchSize = kind === 'guard' ? 1 : configuration.mobile ? 6 : 24;
  for (let offset = 0; offset < pairs.length; offset += batchSize) {
    const batch = pairs.slice(offset, offset + batchSize), inputs = loaded.tokenizer(batch.map(pair => pair.premise), { text_pair: batch.map(pair => pair.hypothesis), padding: true, truncation: true, max_length: 512 }), values = (await loaded.model(inputs)).logits.to('float32').data;
    batch.forEach((_, row) => { const logits = Array.from(values.slice(row * 3, row * 3 + 3)), exponentials = logits.map(value => Math.exp(value - Math.max(...logits))), sum = exponentials.reduce((a, b) => a + b); result.push(Object.fromEntries(exponentials.map((value, index) => [loaded.model.config.id2label[index].toLowerCase(), value / sum]))); });
  }
  return result;
}
async function handle(message) {
  if (message.type === 'init') return initialize(message);
  if (message.type === 'warm') { for (const kind of ['embed', 'read', 'guard', 'classify', 'rank']) await model(kind); return true; }
  if (message.type === 'embed') { const loaded = await model('embed'), vectors = []; for (const text of message.texts) vectors.push(...await embedInNote(loaded, [text])); const buffers = vectors.map(vector => vector.buffer); post({ type: 'result', id: message.id, value: { buffers, focus: vectors.map(vector => vector.focus) } }, buffers); return undefined; }
  if (message.type === 'classify' || message.type === 'guard') return classify(message.type, message.pairs || []);
  if (message.type === 'rank') { if (!message.pairs?.length) return []; const loaded = await model('rank'), inputs = loaded.tokenizer(message.pairs.map(pair => pair.query), { text_pair: message.pairs.map(pair => pair.passage), padding: true, truncation: true, max_length: 512 }); return Array.from((await loaded.model(inputs)).logits.to('float32').data); }
  if (message.type === 'read') { const pairs = message.pairs || []; if (!pairs.length) return []; const loaded = await model('read'), { selected, inputs } = sentenceReaderInputs(loaded.tokenizer, pairs); return sentenceReaderResults(pairs, selected, inputs ? (await loaded.model(inputs)).logits : null); }
  throw new Error('Unknown in-note inference request');
}
self.onmessage = ({ data: message }) => {
  if (message.type === 'cache-result') { const pending = pendingCache.get(message.id); if (pending) { pendingCache.delete(message.id); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.buffer); } return; }
  queue = queue.catch(() => {}).then(async () => { try { const value = await handle(message); if (value !== undefined) post({ type: 'result', id: message.id, value }); } catch (error) { post({ type: 'error', id: message.id, message: error?.message || String(error) }); } });
};
