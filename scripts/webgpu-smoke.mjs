import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchmark = process.argv.includes('--benchmark'), wasmOnly = process.argv.includes('--wasm'), reportPath = process.argv.find(value => value.startsWith('--report='))?.slice(9);
const modelRoot = process.argv.find(value => value.startsWith('--model-root='))?.slice(13);
const batchSize = Number(process.argv.find(value => value.startsWith('--batch-size='))?.slice(13)) || 24;
const parallel = process.argv.includes('--parallel');
const mobileProfile = process.argv.includes('--mobile-batches');
const unitCount = Number(process.argv.find(value => value.startsWith('--units='))?.slice(8)) || 400;
const queryCount = Number(process.argv.find(value => value.startsWith('--query-count='))?.slice(14)) || 5;
const matcherSource = process.argv.find(value => value.startsWith('--matcher-source='))?.slice(17);
const embeddingSource = process.argv.find(value => value.startsWith('--embedding-source='))?.slice(19);
const screenshotPath = process.argv.find(value => value.startsWith('--screenshot='))?.slice(13);
const benchmarkSource = process.argv.find(value => value.startsWith('--source='))?.slice(9), benchmarkQueries = process.argv.filter(value => value.startsWith('--query=')).map(value => value.slice(8));
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!fs.existsSync(chrome)) throw new Error(`Chrome was not found at ${chrome}; set CHROME_PATH to run this optional smoke check`);

const wasm = fs.readFileSync(path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist', 'ort-wasm-simd-threaded.jsep.wasm'));
const wasmModule = fs.readFileSync(path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist', 'ort-wasm-simd-threaded.jsep.mjs'), 'utf8')
  .replace('n="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node&&"renderer"!=process.type', 'n=false')
  .replace("var isNode = typeof globalThis.process?.versions?.node == 'string';\nif (isNode) isPthread = (await import('worker_threads')).workerData === 'em-pthread';", 'var isNode = false;')
  .replace('Xa??=e.locateFile?e.locateFile?e.locateFile("ort-wasm-simd-threaded.jsep.wasm",v):v+"ort-wasm-simd-threaded.jsep.wasm":(new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url)).href', 'Xa??="embedded.wasm"');
const config = { type: 'init', mobile: false, preferWebGpu: !wasmOnly, hardwareConcurrency: 4, wasmThreads: 2, maximumEmbedBatchSize: 4, benchmark, batchSize, parallel, unitCount, queryCount, relevanceEvidence: !matcherSource || process.argv.includes('--relevance-audit'), tokenFocus: !matcherSource || process.argv.includes('--token-focus'), wasmGzip: zlib.gzipSync(wasm, { level: 9 }).toString('base64'), wasmModuleGzip: zlib.gzipSync(wasmModule, { level: 9 }).toString('base64') };
config.mobile = mobileProfile;
config.rankedInNote = !matcherSource;
if (benchmarkSource) config.benchmarkSource = fs.readFileSync(path.resolve(benchmarkSource), 'utf8');
if (benchmarkQueries.length) config.benchmarkQueries = benchmarkQueries;
const workerBuild = await build({ entryPoints: [path.join(root, 'src', 'desktop-embed-worker.js')], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2020', conditions: ['browser', 'module', 'import'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' }, logLevel: 'silent', legalComments: 'none', plugins: embeddingSource ? [{ name: 'frozen-baseline-embedding', setup(builder) { builder.onLoad({ filter: /in-note-embedding\.js$/ }, args => ({ contents: fs.readFileSync(embeddingSource, 'utf8'), loader: 'js', resolveDir: path.dirname(args.path) })); } }] : [] });
const workerSource = workerBuild.outputFiles[0].text;
const matcherBuild = matcherSource ? null : await build({ stdin: { contents: "export { RankedInNoteMatcher as InNoteMatcher } from './src/ranked-in-note-search.js'; export { inNoteProjection } from './src/in-note-search.js';", resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2020', logLevel: 'silent' });

let finish;
const completed = new Promise(resolve => { finish = resolve; });
const page = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><style>body{background:#202025;color:#ddd;font:18px system-ui;padding:32px}section{margin-top:40px;--color-purple:#b48aeb;--text-accent:#b48aeb}p{line-height:1.8}</style><script>window.onerror = message => fetch('/result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(message) }) });</script><script type="module">
import { InNoteMatcher } from '/in-note-search.js';
const [source, configuration] = await Promise.all([fetch('/worker.js').then(value => value.text()), fetch('/config').then(value => value.json())]);
const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { name: 'gib-search-webgpu-smoke' });
const inferencePending = new Map(); let inferenceId = 100;
function inference(message) { const id = inferenceId++; return new Promise((resolve, reject) => { inferencePending.set(id, { resolve, reject }); worker.postMessage({ ...message, id }); }); }
function embeddings(message) { return message.buffers.map((buffer, index) => { const vector = new Float32Array(buffer); vector.focus = message.focus?.[index]; return vector; }); }
function highlightSmoke() {
  const elements = ['--text-highlight-bg:transparent', '--text-highlight-bg:initial', '--color-yellow:#E0DE71;--text-highlight-bg:transparent'].map(properties => { const element = document.createElement('p'); element.style = properties; element.textContent = 'Exact text stays visibly highlighted.'; document.body.append(element); return element; });
  const ranges = elements.map(element => { const range = new Range(); range.selectNodeContents(element); return range; }); CSS.highlights.set('gib-search-lexical-find', new Highlight(...ranges)); CSS.highlights.set('gib-search-lexical-current', new Highlight(ranges[0]));
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d'), fills = [];
  for (const element of elements) for (const name of ['lexical-find', 'lexical-current']) { const color = getComputedStyle(element, '::highlight(gib-search-' + name + ')').backgroundColor; context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); fills.push({ color, alpha: context.getImageData(0, 0, 1, 1).data[3] }); }
  return { ok: fills.every(fill => fill.alpha >= 80), fills };
}
async function inNoteSmoke() {
  const matcher = new InNoteMatcher({ embed: async texts => embeddings(await inference({ type: 'embed', texts, query: false, tokenFocus: configuration.tokenFocus, priority: 1 })), classify: async pairs => (await inference({ type: 'relations', pairs, interactive: true })).results, rank: async pairs => (await inference({ type: 'in-note-rank', pairs })).scores, guard: async pairs => (await inference({ type: 'in-note-guard', pairs })).results, batchSize: 6 });
  const checks = [
    { query: 'reset database password', text: 'Water the tomato plants before sunrise. The garden receives six hours of sunlight.', count: 0 },
    { query: 'fix the car', text: 'We plan to fix the car tomorrow. The mechanic repaired the automobile yesterday.', count: 2 },
    { query: 'data is encrypted', text: 'Data is not encrypted in the archive. Confidential records are stored as plaintext.', count: 0 },
    { query: 'Alice paid Bob', text: 'Bob paid Alice for the repairs. Later, Alice sent money to Bob for the supplies.', count: 1 },
  ];
  const findings = [];
  for (const check of checks) { const matches = await matcher.search(check.query, check.text); findings.push({ query: check.query, count: matches.length, expected: check.count, validOffsets: matches.every(match => check.text.slice(match.from, match.to) === match.sourcePhrase && (!configuration.tokenFocus || match.highlight && check.text.slice(match.highlight.from, match.highlight.to) === match.highlight.sourcePhrase)), phrases: matches.map(match => match.highlight?.phrase) }); }
  const ui = configuration.tokenFocus ? await inNoteUiSmoke(matcher) : { ok: true, skipped: true }, relevance = [];
  if (configuration.relevanceEvidence) {
    const { inNoteRelevanceCases } = await import('/in-note-relevance-cases.mjs'), { inNoteLogicCases } = await import('/in-note-logic-cases.mjs'), { inNoteQuestionCases } = await import('/in-note-question-cases.mjs');
    for (const test of [...inNoteRelevanceCases, ...inNoteLogicCases, ...inNoteQuestionCases]) for (const breadth of ['precise', 'balanced', 'broad']) {
      const { matches, candidates } = await matcher.search(test.query, test.source, { breadth, diagnostics: true }), forbidden = (test.forbidden || []).filter(pattern => matches.some(match => pattern.test(match.phrase))).length + (test.empty ? matches.length : 0), missed = (test.expected || []).filter(pattern => !matches.some(match => pattern.test(match.phrase))).length;
      const countWrong = breadth !== 'precise' && Number.isInteger(test.expectedCount) && matches.length !== test.expectedCount;
      relevance.push({ name: test.name, breadth, forbidden, missed, ok: !forbidden && !countWrong && (breadth === 'precise' || !test.required || !missed), phrases: matches.map(match => match.highlight?.phrase || match.phrase), ...(missed || forbidden || countWrong ? { candidates } : {}) });
    }
  }
  return { ok: findings.every(check => check.count === check.expected && check.validOffsets) && ui.ok && relevance.every(check => check.ok), findings, ui, relevance };
}
async function inNoteUiSmoke(matcher) {
  const { SemanticInNoteSearch } = await import('/in-note-ui.js'), source = 'The mechanic **repaired** the [[Fleet|automobile]] after diagnosing the engine.\\n\\nThe mechanic **repaired** the [[Fleet|automobile]] after diagnosing the engine.';
  const matches = await matcher.search('fix the car', source), host = document.createElement('section');
  host.innerHTML = '<h3>Only the verified occurrence is highlighted</h3><div class="ProseMirror"><p data-index="0">The mechanic <strong>repaired</strong> the <a>automobile</a> after diagnosing the engine.</p><p data-index="1">The mechanic <strong>repaired</strong> the <a>automobile</a> after diagnosing the engine.</p></div>'; document.body.append(host);
  const ui = new SemanticInNoteSearch({ workspace: {} }, {}, { file: { path: 'Example.md' } }); ui.host = host; ui.el = document.createElement('div'); host.append(ui.el); ui.isButter = true; ui.options = { lexical: false, semantic: true }; ui.current = 0;
  ui.matches = ui.compactPhrases(matches, 'fix the car', source); ui.paintHighlights(); const ranges = [...CSS.highlights.get(ui.highlightNames.semantic)];
  const allNarrow = ranges.length === 2 && ranges.every(range => range.toString() === 'repaired the automobile');
  ui.matches = ui.compactPhrases([matches[1]], 'fix the car', source); ui.current = 0; ui.paintHighlights(); const second = [...CSS.highlights.get(ui.highlightNames.semantic)];
  const onlyVerified = second.length === 1 && second[0].startContainer.parentElement.closest('p').dataset.index === '1';
  return { ok: allNarrow && onlyVerified, allNarrow, onlyVerified, spans: ranges.map(range => range.toString()) };
}
async function inNoteBenchmark() {
  const { DesktopEmbedder } = await import('/desktop-embedder.js');
  const helperModels = [], plugin = { isMobile: configuration.mobile, search: { indexingConfig: { cores: 4, memoryGiB: 8 }, activeWasmThreads: 1 }, logDiagnostic() {}, reportOnce() {}, modelCache: { async match(key) { helperModels.push(key); const response = await fetch('/model-cache?key=' + encodeURIComponent(key)); return response.ok ? response : undefined; }, async put() {} } };
  const pool = new DesktopEmbedder(plugin); pool.backend = profile.backend; pool.relationBackend = relationProfile.backend;
  pool.request = async message => (await inference(message)).results;
  const classify = pairs => configuration.parallel ? pool.classifyRelations(pairs, { interactive: true }) : inference({ type: 'relations', pairs, interactive: true }).then(result => result.results);
  if (configuration.parallel) { const results = await classify(Array.from({ length: 12 }, () => ({ premise: 'The mechanic repaired the automobile.', hypothesis: 'fix the car' }))); if (results.length !== 12 || results.some(result => result.entailment < .4)) throw new Error('Parallel meaning verification lost results'); }
  const cpuHelper = { active: Boolean(pool.inNoteWorker?.worker), embeddingModelLoaded: helperModels.some(key => key.includes('bge-small')), models: [...new Set(helperModels.map(key => key.split('/resolve/')[0]))] };
  if (cpuHelper.embeddingModelLoaded || configuration.parallel && profile.backend === 'wasm' && !cpuHelper.active) throw new Error('CPU helper model isolation failed');
  const metrics = { embedTexts: 0, embedBatches: 0, embedMs: 0, classifiedPairs: 0, classifyMs: 0, classifyBatches: 0, focusBytes: 0, rankedPairs: 0, rankMs: 0, guardedPairs: 0, guardMs: 0 }, matcher = new InNoteMatcher({ batchSize: configuration.batchSize,
    embed: async texts => { const start = performance.now(); const result = await inference({ type: 'embed', texts, query: false, tokenFocus: configuration.tokenFocus, priority: 1 }); metrics.embedTexts += texts.length; metrics.embedBatches++; metrics.embedMs += performance.now() - start; metrics.focusBytes += (result.focus || []).reduce((sum, value) => sum + (value?.vectors?.byteLength || 0), 0); return embeddings(result); },
    classify: async pairs => { const start = performance.now(); const result = await classify(pairs); metrics.classifiedPairs += pairs.length; metrics.classifyBatches++; metrics.classifyMs += performance.now() - start; return result; },
    rank: async pairs => { const start = performance.now(), scores = await pool.inNotePairs(pairs, 'rank'); metrics.rankedPairs += pairs.length; metrics.rankMs += performance.now() - start; return scores; }, guard: async pairs => { const start = performance.now(), scores = await pool.inNotePairs(pairs, 'guard'); metrics.guardedPairs += pairs.length; metrics.guardMs += performance.now() - start; return scores; },
  });
  const patterns = ['Encrypt confidential records before creating a backup.', 'Private data remains in plaintext in the archive.', 'The security report describes access to confidential files.', 'Private meetings occur on Friday and records are reviewed.', 'The mechanic repaired the automobile after diagnosing the engine.', 'The subscription renews automatically each month.', 'Slow breathing helped her feel calm again.', 'The garden receives six hours of sunlight.'];
  const text = configuration.benchmarkSource || Array.from({ length: configuration.unitCount }, (_, index) => 'Entry ' + (index + 1) + ': ' + patterns[index % patterns.length]).join('\\n\\n'), rows = [];
  const preparationStart = performance.now(); await matcher.prepare?.(text); const preparationMs = performance.now() - preparationStart;
  const modelStart = performance.now(); if (configuration.rankedInNote) await pool.prepareInNoteModels?.(); const modelPreparationMs = performance.now() - modelStart;
  const queries = (configuration.benchmarkQueries || ['protect private data', 'encrypt records', 'cancel subscription', 'fix the car', 'reduce anxiety']).slice(0, configuration.queryCount);
  for (const query of queries) {
    const before = { ...metrics }, start = performance.now(), matches = await matcher.search(query, text), elapsedMs = performance.now() - start;
    const row = { query, elapsedMs, matches: matches.length, ...Object.fromEntries(Object.keys(metrics).map(key => [key, metrics[key] - before[key]])) }; rows.push(row); await fetch('/progress', { method: 'POST', body: JSON.stringify(row) });
  }
  const repeatedStart = performance.now(), repeatedBefore = { ...metrics }; await matcher.search(queries[0], text); const repeatedMs = performance.now() - repeatedStart, repeatedWork = Object.keys(metrics).some(key => metrics[key] !== repeatedBefore[key]);
  cpuHelper.relevanceModels = [...new Set(helperModels.map(key => key.split('/resolve/')[0]))];
  cpuHelper.relevanceEmbeddingLoaded = helperModels.some(key => key.includes('bge-small'));
  pool.stop(); matcher.dispose?.(); return { characters: text.length, preparationMs, modelPreparationMs, repeatedMs, repeatedWork, cpuHelper, rows };
}
let profile = null, relationProfile = null, semanticResult = null, mobileResult = null, priorityCompleted = false;
worker.onmessage = async event => {
  const message = event.data;
  if (message.type === 'cache') { const response = message.action === 'match' ? await fetch('/model-cache?key=' + encodeURIComponent(message.key)) : null, buffer = response?.ok ? await response.arrayBuffer() : null; worker.postMessage({ type: 'cache-result', id: message.id, buffer }, buffer ? [buffer] : []); return; }
  if (['ready', 'relation-ready', 'backend-fallback'].includes(message.type)) fetch('/progress', { method: 'POST', body: JSON.stringify({ stage: message.type, backend: message.backend, error: message.message }) });
  if (inferencePending.has(message.id)) { const pending = inferencePending.get(message.id); inferencePending.delete(message.id); if (message.type === 'error') pending.reject(new Error(message.message)); else pending.resolve(message); return; }
  if (message.type === 'runtime-profile') { profile = message; return; }
  if (message.type === 'relation-ready') { relationProfile = message; return; }
  if (message.type === 'initialized') { worker.postMessage({ type: 'embed', id: 1, texts: ['Contained WebGPU semantic indexing smoke check.'], query: false, priority: 0 }); return; }
  if (message.type === 'result' && message.id === 1) { const vector = new Float32Array(message.buffers[0]); const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)); semanticResult = { ok: vector.length === 384 && vector.every(Number.isFinite) && Math.abs(magnitude - 1) < .01, backend: profile?.backend, dtype: profile?.dtype, dimension: vector.length, magnitude }; worker.postMessage({ type: 'mobile-bootstrap', id: 4, texts: ['Exact q8 mobile bootstrap smoke check.'] }); return; }
  if (message.type === 'result' && message.id === 4) { const vector = new Float32Array(message.buffers[0]); const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)); mobileResult = { ok: vector.length === 384 && vector.every(Number.isFinite) && Math.abs(magnitude - 1) < .01, dimension: vector.length, magnitude }; worker.postMessage({ type: 'release-mobile-bootstrap', id: 5 }); return; }
  if (message.type === 'mobile-bootstrap-released' && message.id === 5) { const pair = { premise: 'A written schedule organizes actions and times.', hypothesis: 'This text is a plan.' }; worker.postMessage({ type: 'relations', id: 2, lowPriority: true, pairs: Array.from({ length: 24 }, () => pair) }); worker.postMessage({ type: 'embed', id: 3, texts: ['Priority search must run between profile batches.'], query: true, priority: 0 }); return; }
  if (message.type === 'result' && message.id === 3) { priorityCompleted = true; return; }
  if (message.type === 'relation-result' && message.id === 2) { const row = message.results?.[0] || {}, probabilities = [row.entailment, row.neutral, row.contradiction].map(Number), total = probabilities.reduce((sum, value) => sum + value, 0), relation = { ok: message.results?.length === 24 && probabilities.every(Number.isFinite) && Math.abs(total - 1) < .01 && priorityCompleted, backend: relationProfile?.backend, dtype: relationProfile?.dtype, probabilities, interactivePreemption: priorityCompleted }; const highlights = highlightSmoke(); let inNote, benchmark; try { inNote = await inNoteSmoke(); if (configuration.benchmark) benchmark = await inNoteBenchmark(); } catch (error) { inNote = { ok: false, error: error.message }; } await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: semanticResult?.ok && mobileResult?.ok && relation.ok && inNote.ok && highlights.ok, highlights, semantic: semanticResult, mobile: mobileResult, relation, inNote, benchmark }) }); return; }
  if (message.type === 'error') await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, error: message.message, backend: profile?.backend }) });
};
worker.onerror = event => fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, error: event.message }) });
worker.postMessage(configuration);
</script>`;
const server = http.createServer((request, response) => {
  if (request.url === '/in-note-ui.js') { const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'), cleanStart = main.indexOf('function cleanSourceText('), clean = main.slice(cleanStart, main.indexOf('\nfunction ', cleanStart + 1)), pool = main.slice(main.indexOf('function inNoteSemanticPool('), main.indexOf('\nconst IMAGE_EXTENSION')), ui = main.slice(main.indexOf('class SemanticInNoteSearch'), main.indexOf('\nclass AtlasNavigatorView')); response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end("import { inNoteProjection } from '/in-note-search.js';\n" + clean + '\n' + pool + '\n' + ui + '\nexport { SemanticInNoteSearch };'); return; }
  if (request.url === '/in-note-focus.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(fs.readFileSync(path.join(root, 'src/in-note-focus.js'), 'utf8')); return; }
  if (request.url === '/in-note-relevance-cases.mjs') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(fs.readFileSync(path.join(root, 'scripts/in-note-relevance-cases.mjs'), 'utf8')); return; }
  if (['/in-note-logic-cases.mjs', '/in-note-question-cases.mjs'].includes(request.url)) { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(fs.readFileSync(path.join(root, 'scripts', request.url.slice(1)), 'utf8')); return; }
  if (request.url === '/desktop-embedder.js') { const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'), source = main.slice(main.indexOf('class DesktopEmbedder {'), main.indexOf('\nfunction activeTweaks(')); response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(`const configuration = await fetch('/config').then(response => response.json()); const EMBEDDED_DESKTOP_WORKER = await fetch('/worker.js').then(response => response.text()), EMBEDDED_WASM_GZIP = configuration.wasmGzip, EMBEDDED_WASM_MODULE_GZIP = configuration.wasmModuleGzip; ${source}; export { DesktopEmbedder };`); return; }
  if (request.url.startsWith('/model-cache?')) { const key = new URL(request.url, 'http://localhost').searchParams.get('key'), match = key?.match(/^https:\/\/huggingface.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/u), file = modelRoot && match && path.resolve(modelRoot, match[1], match[2]); if (file && file.startsWith(path.resolve(modelRoot) + path.sep) && fs.existsSync(file)) { response.writeHead(200); fs.createReadStream(file).pipe(response); } else { response.writeHead(404); response.end(); } return; }
  if (request.method === 'POST' && request.url === '/progress') { let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => { console.log(body); response.end('ok'); }); return; }
  if (request.method === 'POST' && request.url === '/result') { let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => { try { finish(JSON.parse(body)); } catch (error) { finish({ ok: false, error: error.message }); } response.end('ok'); }); return; }
  const [content, type] = request.url === '/worker.js' ? [workerSource, 'text/javascript'] : request.url === '/styles.css' ? [fs.readFileSync(path.join(root, 'styles.css'), 'utf8'), 'text/css'] : request.url === '/in-note-search.js' ? [matcherBuild ? matcherBuild.outputFiles[0].text : fs.readFileSync(matcherSource, 'utf8'), 'text/javascript'] : request.url === '/config' ? [JSON.stringify(config), 'application/json'] : [page, 'text/html'];
  response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' }); response.end(content);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address(), profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-search-webgpu-'));
const browser = spawn(chrome, [`--user-data-dir=${profileDirectory}`, '--headless=new', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-first-run', '--disable-sync', '--window-size=1100,760', ...(screenshotPath ? ['--remote-debugging-port=0'] : []), `http://127.0.0.1:${address.port}/`], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
let browserError = ''; browser.stderr.on('data', chunk => { browserError += chunk; });
const timeout = setTimeout(() => finish({ ok: false, error: 'Timed out waiting for WebGPU semantic and profile inference' }), 180000);
try {
  const result = await completed; clearTimeout(timeout);
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), JSON.stringify(result, null, 2));
  const expectedBackend = wasmOnly ? 'wasm' : 'webgpu';
  if (!result.ok || result.semantic?.backend !== expectedBackend || result.relation?.backend !== expectedBackend) throw new Error(`Browser inference smoke check failed: ${JSON.stringify(result)}${browserError ? `\n${browserError.slice(-1200)}` : ''}`);
  if (screenshotPath) {
    const port = browserError.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//u)?.[1]; if (!port) throw new Error('Chrome did not expose a screenshot connection');
    const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()), target = tabs.find(tab => tab.type === 'page');
    const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const captured = new Promise((resolve, reject) => socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id === 1) message.error ? reject(new Error(message.error.message)) : resolve(message.result.data); })); socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    fs.writeFileSync(path.resolve(screenshotPath), Buffer.from(await captured, 'base64')); socket.close();
  }
  console.log(`${expectedBackend} worker smoke check passed (semantic ${result.semantic.dtype}, ${result.semantic.dimension} dimensions; mobile bootstrap q8 ${result.mobile.dimension} dimensions; profile ${result.relation.dtype}, probabilities ${result.relation.probabilities.map(value => value.toFixed(3)).join('/')}; interactive preemption verified; ${result.inNote.findings.length} live-source meaning/polarity checks passed).`);
  if (result.benchmark) console.log(JSON.stringify(result.benchmark, null, 2));
} finally {
  clearTimeout(timeout); browser.kill();
  if (browser.exitCode === null) await Promise.race([new Promise(resolve => browser.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
  await new Promise(resolve => server.close(resolve));
  const temporaryRoot = path.resolve(os.tmpdir());
  if (path.resolve(profileDirectory).startsWith(`${temporaryRoot}${path.sep}`)) { try { fs.rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { console.warn(`Temporary Chrome profile retained at ${profileDirectory}`); } }
}
