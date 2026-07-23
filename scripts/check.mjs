import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
const buildSource = fs.readFileSync(path.join(root, 'scripts', 'build.mjs'), 'utf8');
if (!buildSource.includes("'process.release.name': '\"browser\"'")) throw new Error('Obsidian renderer must use the browser inference runtime');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.id !== 'gib-search') throw new Error('manifest id must be gib-search');
if (manifest.name !== 'Gib Search') throw new Error('manifest name must be Gib Search');
if (!/^0\.\d+\.\d+$/.test(manifest.version)) throw new Error('public beta versions must remain in 0.x.x');
if (manifest.isDesktopOnly) throw new Error('Gib Search must remain available on mobile');

const builtMain = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(root, 'src', 'mobile-runtime.js'), 'utf8'); const semanticSource = runtimeSource.slice(runtimeSource.indexOf('async semanticHighlights('), runtimeSource.indexOf('cacheResult(', runtimeSource.indexOf('async semanticHighlights(')));
const embeddedWasm = builtMain.match(/EMBEDDED_WASM_GZIP\s*=\s*["']([^"']+)["']/);
if (!embeddedWasm) throw new Error('main.js does not contain the bundled WebAssembly runtime');
const embeddedWasmModule = builtMain.match(/EMBEDDED_WASM_MODULE_GZIP\s*=\s*["']([^"']+)["']/);
if (!embeddedWasmModule) throw new Error('main.js does not contain the bundled WebAssembly loader');
const bundledBinary = zlib.gunzipSync(Buffer.from(embeddedWasm[1], 'base64'));
const bundledModule = zlib.gunzipSync(Buffer.from(embeddedWasmModule[1], 'base64')).toString('utf8');
const sourceBinary = fs.readFileSync(path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist', 'ort-wasm-simd-threaded.jsep.wasm'));
if (!bundledBinary.equals(sourceBinary)) throw new Error('Bundled WebAssembly runtime differs from the pinned dependency');
if (!bundledModule.includes('n=false') || !bundledModule.includes('var isNode = false;')) throw new Error('Bundled WebAssembly loader can still select Node worker modules');
if (!bundledModule.includes('Xa??="embedded.wasm"')) throw new Error('Bundled WebAssembly loader still depends on its module URL');
if (!builtMain.includes('wasmBinary = this.plugin.embeddedWasmBinary')) throw new Error('Bundled WebAssembly runtime is not connected to inference');
if (!builtMain.includes('wasmPaths = { mjs: this.plugin.embeddedWasmModuleUrl }')) throw new Error('Bundled WebAssembly loader is not connected to inference');
if (!builtMain.includes('new window.Worker')) throw new Error('Desktop inference is not isolated in a browser worker');
if (!builtMain.includes('web-worker-wasm')) throw new Error('Desktop worker health reporting is missing');
if (builtMain.includes("require('node:worker_threads')") || builtMain.includes("require('node:child_process')") || builtMain.includes('ELECTRON_RUN_AS_NODE')) throw new Error('Unsupported Node background runtime is still bundled');
if (!builtMain.includes('embedQueue = embedQueue.then')) throw new Error('Desktop inference requests are not serialized');
if (!builtMain.includes('index.highlights.bin') || !builtMain.includes('highlightCandidates') || !builtMain.includes('packedHighlightVectors')) throw new Error('Precomputed semantic highlight index is missing');
if (builtMain.includes('cachedPassageVectors')) throw new Error('Search-time phrase embedding is still bundled');
if (/embedBatch|initializeModel|cachedPassageVectors/.test(semanticSource)) throw new Error('Semantic highlighting still performs search-time inference');
if (!builtMain.includes('contentFingerprint(content)') || !builtMain.includes('sameChunks(previous')) throw new Error('Index change detection still depends only on file timestamps');
if (!builtMain.includes('this.plugin.app.vault.read(file)')) throw new Error('Index verification still uses potentially stale cached vault reads');
if (!builtMain.includes('Index pair is incomplete') || !builtMain.includes('attempt < 40')) throw new Error('Desktop index loading does not retry transient sync races');
if (builtMain.includes('if (!existingDirectory) return undefined')) throw new Error('Desktop index loading skips retries when sync temporarily removes the index directory');
if (!builtMain.includes("if (!this.isMobile) throw error")) throw new Error('Desktop index load failures can still trigger an empty rebuild');
if (!builtMain.includes('retainedMeta.push') || builtMain.includes('const remove = new Set([...changed.map')) throw new Error('Index refresh can still discard changed files before their replacements are ready');
if (!builtMain.includes('waitForVaultSettled') || !builtMain.includes('Waiting for the vault to finish loading')) throw new Error('Startup can still scan a partial Obsidian vault');
if (builtMain.includes('this.highlightTimer') || builtMain.includes('quickLimit = Math.min(4')) throw new Error('Search results still render before semantic highlighting finishes');
if (!builtMain.includes('semanticHighlights: tweaks.semanticHighlights')) throw new Error('Semantic highlighting is not part of the initial result render');
if (builtMain.includes("if (!this.vectors.length) throw new Error(this.message || 'The semantic index is not ready'); await this.initializeModel()")) throw new Error('Desktop search still warms BGE on the UI thread');
if (!builtMain.includes('searchLive(query')) throw new Error('Live semantic query scheduling is missing');
if (!builtMain.includes('immediate ? 0 : 75')) throw new Error('Live semantic search debounce is missing');
if (!builtMain.includes('if (this.indexRun)')) throw new Error('Serialized index scheduling is missing');
if (!builtMain.includes('clearTimeout(this.updateTimer)')) throw new Error('Vault-wide index event coalescing is missing');
if (builtMain.includes('this.pending.get(file.path)')) throw new Error('Per-file full-index timers must not be used');
if (!builtMain.includes('contextualExpression') || !builtMain.includes('indexedHighlightCandidates')) throw new Error('Indexed contextual phrase scoring is missing');
if (builtMain.includes('function phraseCandidates(')) throw new Error('Legacy isolated n-gram highlighting is still bundled');
if (/device\s*:\s*["'](?:wasm|webgpu)["']/.test(builtMain)) throw new Error('Inference device must be selected by the host runtime');
if (/process\?\.release\?\.name\s*===\s*["']node["']/.test(builtMain)) throw new Error('Release build still contains Electron Node runtime detection');

const codeFiles = [
  'main.js', 'src/main.js', 'src/mobile-runtime.js', 'src/desktop-embed-worker.js', 'styles.css',
];
const forbidden = [
  /\x62\x65\x74\x74\x65\x72\x20\x63\x6c\x61\x75\x64\x65/i,
  /\b\x63\x6c\x61\x75\x64\x65\b/i,
  /\b\x63\x6f\x64\x65\x78\b/i,
  /\b\x63\x68\x61\x74\x67\x70\x74\b/i,
  /\bbc embed\b/i, /agent's semantic_search/i, /sdk mcp/i,
  /C:\\Users\\/i, /[A-Z]:\\Tucker\\/i, /console\.(?:log|debug)\s*\(/,
];
for (const relativePath of codeFiles) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const pattern of forbidden) {
    if (relativePath === 'main.js' && String(pattern).includes('console')) continue;
    if (pattern.test(source)) throw new Error(`${relativePath} contains forbidden public-release text: ${pattern}`);
  }
  if (/\.(?:js|mjs)$/.test(relativePath)) execFileSync(process.execPath, ['--check', path.join(root, relativePath)], { stdio: 'inherit' });
}

const { MobileSearchRuntime, buildHighlightCandidates } = await import(pathToFileURL(path.join(root, 'src', 'mobile-runtime.js')).href);
const desktopBatchSizes = [];
const batchRuntime = new MobileSearchRuntime({ isMobile: false, manifest: { id: 'gib-search' }, app: { vault: { adapter: { getBasePath: () => 'batch-test' }, configDir: '.obsidian', getName: () => 'batch-test' } }, desktopEmbedder: { embedBatch: async texts => { desktopBatchSizes.push(texts.length); return texts.map(() => new Float32Array(384)); } } });
const batchedVectors = await batchRuntime.embedBatch(Array.from({ length: 19 }, (_, index) => `passage ${index}`), false, 8);
if (batchedVectors.length !== 19 || desktopBatchSizes.join(',') !== '8,8,3') throw new Error(`Desktop embedding batches are unbounded: ${desktopBatchSizes.join(',')}`);
let storedIndex = null; const storagePlugin = { isMobile: false, manifest: { id: 'gib-search' }, logDiagnostic() {}, desktopIndexStore: { put: async value => { storedIndex = value; }, get: async () => storedIndex }, app: { vault: { adapter: { getBasePath: () => 'storage-test' }, configDir: '.obsidian', getName: () => 'storage-test' } } };
const storageRuntime = new MobileSearchRuntime(storagePlugin); storageRuntime.meta = [{ file: 'test.md', highlightCandidates: [{ phrase: 'free will', field: 'body' }] }]; storageRuntime.vectors = [new Float32Array(384).fill(.25)]; storageRuntime.highlightVectors = [[new Int16Array(384).fill(16384)]]; await storageRuntime.saveIndex();
if (storedIndex.highlightVectors.byteLength !== 384 * 2) throw new Error('Highlight vectors were not persisted');
const loadedRuntime = new MobileSearchRuntime(storagePlugin); await loadedRuntime.loadIndex();
if (loadedRuntime.highlightVectors.length !== 1 || loadedRuntime.highlightVectors[0].length !== 1 || loadedRuntime.highlightVectors[0][0][0] !== 16384) throw new Error('Highlight vectors did not survive save/load');
const coverage = buildHighlightCandidates('Topics/Agency and Parenting.md', { heading: 'Divine Sovereignty and Mans Will', text: "A parent's role is to teach the child. Raising children requires discipline and desire. Agency is opposed to determinism." });
const coveragePhrases = new Set(coverage.map(item => item.phrase.toLowerCase()));
for (const phrase of ['teach the child', 'raising children', 'divine sovereignty', 'agency', 'determinism', 'desire']) if (!coveragePhrases.has(phrase)) throw new Error(`Indexed highlighting missed ${phrase}: ${[...coveragePhrases].join(', ')}`);
for (const phrase of coveragePhrases) if (phrase === 'idea' || phrase === 'thought') throw new Error(`Generic highlight candidate leaked into the index: ${phrase}`);
const mockPlugin = { isMobile: false, manifest: { id: 'gib-search' }, app: { vault: { adapter: { getBasePath: () => 'test' }, configDir: '.obsidian', getName: () => 'test' } } };
const highlighter = new MobileSearchRuntime(mockPlugin); const highlightCandidates = [{ phrase: 'agency', field: 'body', sentenceId: 0, start: 0, end: 0, words: 1, hasNoun: true, hasExpression: false, adjectiveOnly: false, quality: .04 }, { phrase: 'free will', field: 'body', sentenceId: 0, start: 2, end: 3, words: 2, hasNoun: true, hasExpression: false, adjectiveOnly: false, quality: .09 }];
highlighter.highlightVectors = [[new Int16Array([Math.round(.68 * 32767)]), new Int16Array([Math.round(.84 * 32767)])]];
const highlightResults = [{ file: 'agency.md', heading: '', text: 'Agency protects free will.', passageIndex: 0, semanticScore: .8, highlightCandidates }];
await highlighter.semanticHighlights(highlightResults, new Float32Array([1]), { query: 'free will', resultMinScore: .55, singleWordMinScore: .62, phraseMinScore: .56, maxPhrases: 5 });
const directPhrases = highlightResults[0].semanticHighlights.map(item => item.phrase.toLowerCase());
if (!directPhrases.includes('agency') || !directPhrases.includes('free will')) throw new Error(`Precomputed semantic highlighting failed: ${directPhrases.join(', ')}`);

for (const required of ['main.js', 'manifest.json', 'styles.css', 'versions.json', 'README.md', 'LICENSE', 'SECURITY.md']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing public release file: ${required}`);
}

console.log(`Gib Search ${manifest.version} passed build, syntax, manifest, and public-content checks.`);
