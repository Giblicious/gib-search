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
if (!builtMain.includes('Desktop embedding worker exited with code')) throw new Error('Desktop inference is not isolated in a worker');
if (!builtMain.includes('worker-wasm')) throw new Error('Desktop worker health reporting is missing');
if (!builtMain.includes('searchLive(query')) throw new Error('Live semantic query scheduling is missing');
if (!builtMain.includes('immediate ? 0 : 75')) throw new Error('Live semantic search debounce is missing');
if (!builtMain.includes('if (this.indexRun)')) throw new Error('Serialized index scheduling is missing');
if (!builtMain.includes('clearTimeout(this.updateTimer)')) throw new Error('Vault-wide index event coalescing is missing');
if (builtMain.includes('this.pending.get(file.path)')) throw new Error('Per-file full-index timers must not be used');
if (!builtMain.includes('contextualExpression') || !builtMain.includes('phraseStructure')) throw new Error('Contextual span attribution is missing');
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

const { MobileSearchRuntime } = await import(pathToFileURL(path.join(root, 'src', 'mobile-runtime.js')).href);
const mockPlugin = { isMobile: false, manifest: { id: 'gib-search' }, app: { vault: { adapter: { getBasePath: () => 'test' }, configDir: '.obsidian', getName: () => 'test' } } };
const highlighter = new MobileSearchRuntime(mockPlugin);
const mockScores = new Map([['i can feel the spirit.', .82], ['feel the spirit', .88], ['feel', .69], ['spirit', .76], ['i can', .28], ['i can the spirit.', .58], ['i can feel the.', .54], ['the lord warmed my bosom.', .77], ['warmed my bosom', .79], ['warmed', .66], ['bosom', .62], ['the lord.', .31]]);
highlighter.cachedPassageVectors = async () => text => new Float32Array([mockScores.get(String(text).toLowerCase()) ?? (/feel|spirit|warm|bosom/i.test(text) ? .57 : .2)]);
const highlightResults = [{ file: 'direct.md', heading: '', text: 'I can feel the spirit.', score: .8 }, { file: 'expression.md', heading: '', text: 'The Lord warmed my bosom.', score: .75 }];
await highlighter.semanticHighlights(highlightResults, new Float32Array([1]), { query: 'i felt the spirit', resultMinScore: .55, singleWordMinScore: .62, phraseMinScore: .56, maxPhrases: 5 });
const directPhrases = highlightResults[0].semanticHighlights.map(item => item.phrase.toLowerCase()); const expressionPhrases = highlightResults[1].semanticHighlights.map(item => item.phrase.toLowerCase());
if (!directPhrases.includes('feel the spirit') || directPhrases.includes('the spirit')) throw new Error(`Contextual phrase selection failed: ${directPhrases.join(', ')}`);
if (!expressionPhrases.includes('warmed my bosom')) throw new Error(`Contextual expression selection failed: ${expressionPhrases.join(', ')}`);

for (const required of ['main.js', 'manifest.json', 'styles.css', 'versions.json', 'README.md', 'LICENSE', 'SECURITY.md']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing public release file: ${required}`);
}

console.log(`Gib Search ${manifest.version} passed build, syntax, manifest, and public-content checks.`);
