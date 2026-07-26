const { Plugin, PluginSettingTab, Setting, SuggestModal, ItemView, Notice, TFile, setIcon, Platform } = require('obsidian');
const { MobileSearchRuntime } = require('./mobile-runtime');
const EMBEDDED_WASM_GZIP = null;
const EMBEDDED_WASM_MODULE_GZIP = null;
const EMBEDDED_DESKTOP_WORKER = null;
let fs, path, os, crypto;
function loadDesktopModules() {
  if (fs) return;
  fs = require('fs'); path = require('path'); os = require('os'); crypto = require('crypto');
}

const GRAPH_VIEW = 'gib-search-graph';
const NEIGHBORHOOD_VIEW = 'gib-search-neighborhood';
const MODEL_PROFILES = {
  bge: { label: 'BGE Small English v1.5', indexFolder: 'bge-small-en-v1.5' },
};
const MODEL_TWEAK_DEFAULTS = {
  bge: { topK: 10, minScore: 0.5, scoreWindow: 0.14, folderPathBoost: 0.06, semanticHighlights: true, highlightResultMinScore: 0.55, highlightSingleWordMinScore: 0.62, highlightPhraseMinScore: 0.56, highlightMaxPhrases: 3 },
};
const SEARCH_LENSES = {
  relevance: { label: 'Relevance', description: 'Rank by relevance and reveal the concepts within the results.' },
  arguments: { label: 'Arguments', description: 'Organize results by support, tension, and related argument.' },
  context: { label: 'Context', description: 'Favor results that connect strongly to the wider vault.' },
};
function validSearchLens(value) { return value === 'concepts' ? 'relevance' : SEARCH_LENSES[value] ? value : 'relevance'; }
const DEFAULTS = { enabled: true, verboseLogging: false, allowExternalImageThumbnails: false, folderPathBoostEnabled: true, searchMapEnabled: false, searchMapGenerations: 1, defaultSearchLens: 'relevance', magicGraphEnabled: true, graphSemanticColors: true, graphRelationshipIntelligence: true, graphRelationshipBudgetDesktop: 8, graphRelationshipBudgetMobile: 2, topK: 10, minScore: 0.5, semanticHighlights: true, highlightResultMinScore: 0.55, highlightSingleWordMinScore: 0.62, highlightPhraseMinScore: 0.56, highlightMaxPhrases: 3, graphK: 5, graphMaxEdges: 2000, showWikilinks: true };
function activeIndexDir(plugin) {
  return path.join(plugin.pluginDir, 'embeddings', MODEL_PROFILES.bge.indexFolder);
}
function desktopCacheRoot() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Gib Search');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'Gib Search');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'gib-search');
}
function vaultCacheKey(vaultPath) {
  const normalized = path.resolve(vaultPath).replaceAll('\\', '/').toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
function directoryFiles(directory, root = directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...directoryFiles(target, root));
    else { try { files.push({ relative: path.relative(root, target), size: fs.statSync(target).size }); } catch {} }
  }
  return files;
}
function migrateDirectory(source, destination, plugin) {
  if (!fs.existsSync(source) || path.resolve(source) === path.resolve(destination)) return true;
  try {
    for (const file of directoryFiles(source)) {
      const from = path.join(source, file.relative), to = path.join(destination, file.relative);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (!fs.existsSync(to) || fs.statSync(to).size !== file.size) fs.copyFileSync(from, to);
    }
    const complete = directoryFiles(source).every(file => {
      const target = path.join(destination, file.relative);
      return fs.existsSync(target) && fs.statSync(target).size === file.size;
    });
    if (!complete) throw new Error('destination verification failed');
    fs.rmSync(source, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    return true;
  } catch (error) { plugin.logDiagnostic(`Could not migrate ${source}: ${error.message}`, true); return false; }
}
function removeIfEmpty(directory) { try { if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory); } catch {} }
function restoreDesktopData(plugin) {
  const externalIndex = path.join(plugin.cacheRoot, 'indexes', plugin.vaultCacheKey, MODEL_PROFILES.bge.indexFolder);
  try { const status = JSON.parse(fs.readFileSync(path.join(externalIndex, 'status.json'), 'utf8')); if (Number(status.pid) > 0) process.kill(Number(status.pid)); } catch {}
  migrateDirectory(path.join(plugin.cacheRoot, 'models'), path.join(plugin.pluginDir, 'models'), plugin);
  if (plugin.legacyModelsPath && path.isAbsolute(plugin.legacyModelsPath)) migrateDirectory(plugin.legacyModelsPath, path.join(plugin.pluginDir, 'models'), plugin);
  migrateDirectory(externalIndex, activeIndexDir(plugin), plugin);
  migrateDirectory(path.join(plugin.cacheRoot, 'logs', plugin.vaultCacheKey), path.join(plugin.pluginDir, 'logs'), plugin);
  migrateDirectory(path.join(plugin.pluginDir, 'worker', 'models'), path.join(plugin.pluginDir, 'models'), plugin);
  for (const obsolete of [path.join(plugin.cacheRoot, 'runtime', plugin.vaultCacheKey), path.join(plugin.pluginDir, 'runtime'), path.join(plugin.pluginDir, 'worker')]) {
    try { if (fs.existsSync(obsolete)) fs.rmSync(obsolete, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); } catch (error) { plugin.logDiagnostic(`Could not remove obsolete runtime ${obsolete}: ${error.message}`, true); }
  }
  for (const directory of [path.join(plugin.cacheRoot, 'indexes', plugin.vaultCacheKey), path.join(plugin.cacheRoot, 'indexes'), path.join(plugin.cacheRoot, 'logs'), path.join(plugin.cacheRoot, 'runtime'), plugin.cacheRoot]) removeIfEmpty(directory);
}
function modelCachePath(root, request) {
  let key = typeof request === 'string' ? request : request?.url || String(request || '');
  try { const url = new URL(key); key = decodeURIComponent(url.pathname.replace(/^\//, '').replace('/resolve/main/', '/')); } catch { key = key.replace(/^\/?models\//, '').replace(/^\//, ''); }
  key = key.replaceAll('\\', '/').replace(/^Xenova\//, 'Xenova/');
  const safe = key.split('/').filter(part => part && part !== '.' && part !== '..').join(path.sep);
  const target = path.resolve(root, safe); return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null;
}
class FileModelCache {
  constructor(root) { this.root = root; }
  async match(request) {
    const target = modelCachePath(this.root, request); if (!target || !fs.existsSync(target)) return undefined;
    const data = await fs.promises.readFile(target); return new Response(data, { headers: { 'Content-Length': String(data.length) } });
  }
  async put(request, response) {
    const target = modelCachePath(this.root, request); if (!target) throw new Error('Invalid model cache path');
    const data = Buffer.from(await response.arrayBuffer()); fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.download`; await fs.promises.writeFile(temporary, data); await fs.promises.rename(temporary, target);
  }
}
class DesktopIndexStore {
  constructor(directory) { this.directory = directory; }
  async get() {
    const existingDirectory = fs.existsSync(this.directory);
    let lastError = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const meta = JSON.parse(await fs.promises.readFile(path.join(this.directory, 'index.meta.json'), 'utf8')); const data = await fs.promises.readFile(path.join(this.directory, 'index.vectors.bin'));
        if (data.byteLength !== meta.length * 384 * 4) throw new Error(`Index pair is incomplete (${meta.length} passages, ${data.byteLength} vector bytes)`);
        const highlightCount = meta.reduce((total, item) => total + (item.highlightCandidates?.length || 0), 0); let highlightData = Buffer.alloc(0);
        if (highlightCount) { highlightData = await fs.promises.readFile(path.join(this.directory, 'index.highlights.bin')); if (highlightData.byteLength !== highlightCount * 384 * 2) throw new Error(`Highlight index is incomplete (${highlightCount} phrases, ${highlightData.byteLength} vector bytes)`); }
        let state = {}; try { state = JSON.parse(await fs.promises.readFile(path.join(this.directory, 'index.state.json'), 'utf8')); } catch {}
        return { meta, vectors: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), highlightVectors: highlightData.buffer.slice(highlightData.byteOffset, highlightData.byteOffset + highlightData.byteLength), ...state };
      } catch (error) { lastError = error; if (attempt < 39) await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    const hasIndexFiles = fs.existsSync(path.join(this.directory, 'index.meta.json')) || fs.existsSync(path.join(this.directory, 'index.vectors.bin'));
    if (!hasIndexFiles && !existingDirectory) return undefined;
    if (!hasIndexFiles) throw new Error('Existing semantic index files are temporarily unavailable'); throw lastError || new Error('Could not load the semantic index');
  }
  async put(value) {
    fs.mkdirSync(this.directory, { recursive: true });
    await fs.promises.writeFile(path.join(this.directory, 'index.meta.json'), JSON.stringify(value.meta)); await fs.promises.writeFile(path.join(this.directory, 'index.vectors.bin'), Buffer.from(value.vectors)); await fs.promises.writeFile(path.join(this.directory, 'index.highlights.bin'), Buffer.from(value.highlightVectors || new ArrayBuffer(0)));
    await fs.promises.writeFile(path.join(this.directory, 'index.state.json'), JSON.stringify({ lastSuccessfulIndexAt: value.lastSuccessfulIndexAt || null }));
  }
  async getRelations() { try { return JSON.parse(await fs.promises.readFile(path.join(this.directory, 'index.relationships.json'), 'utf8')); } catch { return []; } }
  async putRelations(entries) { fs.mkdirSync(this.directory, { recursive: true }); const target = path.join(this.directory, 'index.relationships.json'), temporary = `${target}.download`; await fs.promises.writeFile(temporary, JSON.stringify(entries)); await fs.promises.rename(temporary, target); }
}
class DesktopEmbedder {
  constructor(plugin) { this.plugin = plugin; this.worker = null; this.workerUrl = null; this.pending = new Map(); this.nextId = 1; this.ready = false; this.relationReady = false; }
  start() {
    if (this.worker) return;
    this.workerUrl = URL.createObjectURL(new Blob([EMBEDDED_DESKTOP_WORKER], { type: 'text/javascript' }));
    const worker = new window.Worker(this.workerUrl, { name: 'gib-search-bge' }); this.worker = worker;
    worker.onmessage = event => this.receive(event.data);
    worker.onerror = event => this.fail(new Error(event.message || 'Desktop embedding worker failed'));
    worker.onmessageerror = () => this.fail(new Error('Desktop embedding worker sent an unreadable message'));
    worker.postMessage({ type: 'init', wasmGzip: EMBEDDED_WASM_GZIP, wasmModuleGzip: EMBEDDED_WASM_MODULE_GZIP });
  }
  async receive(message) {
    if (message.type === 'cache') { await this.cache(message); return; }
    if (message.type === 'ready') { this.ready = true; this.plugin.search?.changed(); return; }
    if (message.type === 'relation-ready') { this.relationReady = true; this.plugin.search?.changed(); return; }
    if (message.type === 'relation-progress') { const percent = Math.round(Number(message.progress) || 0); this.plugin.search?.relationActivity?.(`Downloading relationship model: ${percent}%`); return; }
    if (message.type === 'progress') { const percent = Math.round(Number(message.progress) || 0); this.plugin.search?.setState('loading_model', `Downloading ${message.file}: ${percent}%`); return; }
    const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id);
    if (message.type === 'error') pending.reject(new Error(message.message));
    else if (message.type === 'relation-result') pending.resolve(message.results || []);
    else pending.resolve((message.buffers || []).map(buffer => new Float32Array(buffer)));
  }
  async cache(message) {
    try {
      if (message.action === 'match') {
        const response = await this.plugin.modelCache.match(message.key); const buffer = response ? await response.arrayBuffer() : null;
        if (buffer) this.worker?.postMessage({ type: 'cache-result', id: message.id, buffer }, [buffer]); else this.worker?.postMessage({ type: 'cache-result', id: message.id });
      } else if (message.action === 'put') {
        await this.plugin.modelCache.put(message.key, new Response(message.buffer)); this.worker?.postMessage({ type: 'cache-result', id: message.id });
      }
    } catch (error) { this.worker?.postMessage({ type: 'cache-result', id: message.id, error: error?.message || String(error) }); }
  }
  fail(error) { const worker = this.worker; this.worker = null; worker?.terminate(); if (this.workerUrl) URL.revokeObjectURL(this.workerUrl); this.workerUrl = null; for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); this.ready = false; this.plugin.reportOnce(`Desktop embedding worker failed: ${error.message}`); }
  embedBatch(texts, query = false) {
    this.start(); const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); try { this.worker.postMessage({ type: 'embed', id, texts, query }); } catch (error) { this.pending.delete(id); reject(error); } });
  }
  classifyRelations(pairs) { this.start(); const id = this.nextId++; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); try { this.worker.postMessage({ type: 'relations', id, pairs }); } catch (error) { this.pending.delete(id); reject(error); } }); }
  stop() { const worker = this.worker; this.worker = null; this.ready = false; this.relationReady = false; for (const pending of this.pending.values()) pending.reject(new Error('Desktop embedding worker stopped')); this.pending.clear(); worker?.terminate(); if (this.workerUrl) URL.revokeObjectURL(this.workerUrl); this.workerUrl = null; }
}
function activeTweaks(plugin) {
  return plugin.settings.modelTweaks.bge;
}
function directorySize(directory) {
  if (!directory || !fs?.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    try { total += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size; } catch {}
  }
  return total;
}
function formatBytes(bytes) {
  const value = Number(bytes) || 0; if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB']; const unit = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function formatWhen(timestamp) { return timestamp ? new Date(Number(timestamp)).toLocaleString() : 'Never'; }
function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  if (seconds < 60) return `${seconds}s`; const minutes = Math.floor(seconds / 60); return `${minutes}m ${seconds % 60}s`;
}

const SEARCH_STOP_WORDS = new Set(['about', 'after', 'again', 'also', 'and', 'are', 'because', 'been', 'before', 'being', 'between', 'but', 'can', 'could', 'does', 'for', 'from', 'have', 'into', 'more', 'not', 'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'with', 'would', 'your']);
function queryTerms(query) {
  return [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [])].filter(word => word.length > 2 && !SEARCH_STOP_WORDS.has(word));
}
function cleanSourceText(source) {
  return String(source || '')
    .replace(/^---\s*[\s\S]*?\n---\s*/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*>\s*\[![^\]]+\][+-]?\s*/gim, '')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )\s*/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, ' ')
    .replace(/\|/g, ' · ')
    .replace(/(?:\*\*|__|~~|==)(.*?)(?:\*\*|__|~~|==)/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
function distillSnippet(source, query, semanticPhrases = [], limit = 240) {
  const clean = cleanSourceText(source); if (!clean) return '';
  const terms = queryTerms(query); const semantic = semanticPhrases.map(cleanSourceText).filter(Boolean); const sentences = clean.match(/[^.!?\n]+[.!?]?/g)?.map(s => s.trim()).filter(Boolean) || [clean];
  let best = 0, bestScore = -1;
  sentences.forEach((sentence, index) => { const lower = sentence.toLowerCase(); const lexical = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0); const attributed = semantic.reduce((sum, phrase) => sum + (lower.includes(phrase.toLowerCase()) || phrase.toLowerCase().includes(lower) ? 3 : 0), 0); const score = lexical + attributed; if (score > bestScore) { best = index; bestScore = score; } });
  let excerpt = sentences[best] || clean;
  if (excerpt.length < limit * .55 && sentences[best + 1]) excerpt += ` ${sentences[best + 1]}`;
  if (excerpt.length < limit * .55 && best > 0) excerpt = `${sentences[best - 1]} ${excerpt}`;
  return excerpt.length > limit ? `${excerpt.slice(0, limit).replace(/\s+\S*$/, '')}…` : excerpt;
}
function semanticPhrasePool(results) {
  const phrases = [];
  for (const hit of results) for (const field of ['filenameHighlights', 'headingHighlights', 'semanticHighlights']) for (const item of hit[field] || []) {
    const phrase = cleanSourceText(item.phrase);
    if (phrase && !phrases.some(existing => existing.toLowerCase() === phrase.toLowerCase())) phrases.push(phrase);
  }
  return phrases;
}
const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
function extractImageReferences(source, anchorPhrases = []) {
  const value = String(source || '').replace(/```[\s\S]*?```/g, ' '); const found = []; const seen = new Set(); const lower = value.toLowerCase();
  const anchors = anchorPhrases.flatMap(phrase => { const needle = String(phrase || '').toLowerCase().trim(); const positions = []; if (!needle) return positions; let index = 0; while ((index = lower.indexOf(needle, index)) >= 0) { positions.push(index); index += Math.max(1, needle.length); } return positions; });
  const add = (target, alt = '', position = 0) => { const normalized = String(target || '').trim(); if (!normalized || seen.has(normalized)) return; seen.add(normalized); const distance = anchors.length ? Math.min(...anchors.map(anchor => Math.abs(anchor - position))) : position; found.push({ target: normalized, alt: String(alt || '').trim(), distance }); };
  for (const match of value.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) add(match[1], match[1].split('/').pop(), match.index);
  for (const match of value.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*)?\)/g)) add(match[2] || match[3], match[1], match.index);
  for (const match of value.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) { const alt = match[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || ''; add(match[1], alt, match.index); }
  return found.sort((a, b) => a.distance - b.distance).map(({ distance, ...reference }) => reference);
}
function groupSearchResults(results, query, maxFiles) {
  const files = new Map();
  for (const hit of results) {
    let group = files.get(hit.file);
    const rankingScore = Number(hit.rankingScore ?? hit.score ?? 0);
    if (!group) { group = { file: hit.file, score: rankingScore, semanticScore: Number(hit.score || 0), filenameBoost: Number(hit.filenameBoost || 0), folderPathBoost: Number(hit.folderPathBoost || 0), snippets: [], filenameHighlights: [] }; files.set(hit.file, group); }
    if (rankingScore > group.score) { group.score = rankingScore; group.semanticScore = Number(hit.score || 0); group.filenameBoost = Number(hit.filenameBoost || 0); group.folderPathBoost = Number(hit.folderPathBoost || 0); }
    const semanticHighlights = (hit.semanticHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean);
    const filenameHighlights = (hit.filenameHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean);
    const headingHighlights = (hit.headingHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean);
    for (const phrase of filenameHighlights) if (!group.filenameHighlights.includes(phrase)) group.filenameHighlights.push(phrase);
    const text = distillSnippet(hit.text, query, semanticHighlights);
    if (text && !group.snippets.some(item => item.text === text) && group.snippets.length < 3) group.snippets.push({ text, heading: hit.heading, score: Number(hit.score || 0), lineStart: hit.lineStart, lineEnd: hit.lineEnd, semanticHighlights, headingHighlights, imageReferences: extractImageReferences(hit.text, [query, ...semanticHighlights]) });
  }
  // Preserve the model's tuned rank. Map insertion order reflects the first
  // (best-ranked) chunk for each file; sorting again by raw cosine would erase
  // model-specific reranking such as filename relevance.
  return [...files.values()].filter(group => group.snippets.length).slice(0, maxFiles);
}
function passageSearchResults(results, query, maximum) {
  return results.slice(0, maximum).map(hit => { const semanticHighlights = (hit.semanticHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean); const filenameHighlights = (hit.filenameHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean); const headingHighlights = (hit.headingHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean); return { file: hit.file, score: Number(hit.rankingScore ?? hit.score ?? 0), semanticScore: Number(hit.score || 0), filenameBoost: Number(hit.filenameBoost || 0), folderPathBoost: Number(hit.folderPathBoost || 0), filenameHighlights, snippets: [{ text: distillSnippet(hit.text, query, semanticHighlights), heading: hit.heading, score: Number(hit.score || 0), lineStart: hit.lineStart, lineEnd: hit.lineEnd, semanticHighlights, headingHighlights, imageReferences: extractImageReferences(hit.text, [query, ...semanticHighlights]) }] }; }).filter(result => result.snippets[0].text);
}
function argumentEvidenceText(result) { const snippet = result?.snippets?.[0]; if (!snippet) return ''; const heading = cleanSourceText(snippet.heading); const text = cleanSourceText(snippet.text); return `${heading ? `${heading}. ` : ''}${text}`.trim().slice(0, 720); }
function renderHighlighted(parent, text, query, semanticPhrases = []) {
  const matches = [...new Set(semanticPhrases.filter(phrase => { const words = phrase.trim().split(/\s+/).length; return phrase.length >= 3 && phrase.length <= 60 && words >= 1 && words <= 3 && text.toLowerCase().includes(phrase.toLowerCase()); }))].sort((a, b) => b.length - a.length);
  if (!matches.length) { parent.setText(text); return; }
  const escaped = matches.map(match => match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); const regex = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu'); const normalized = new Set(matches.map(match => match.toLowerCase()));
  for (const part of text.split(regex)) { if (!part) continue; if (normalized.has(part.toLowerCase())) parent.createEl('mark', { cls: 'gib-semantic-highlight gib-semantic-highlight-phrase', text: part }); else parent.appendText(part); }
}

function stableMapAngle(value) {
  let hash = 2166136261; for (const character of String(value || '')) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 0) / 4294967295) * Math.PI * 2;
}
function mapEdgeKey(a, b) { return [a, b].sort().join('\0'); }
class SemanticMapCanvas {
  constructor(host, app, options = {}) {
    this.host = host; this.app = app; this.options = options; this.nodes = []; this.edges = []; this.byId = new Map(); this.hovered = null; this.selected = null; this.animationFrame = null;
    host.empty(); const heading = host.createDiv({ cls: 'gib-search-map-heading' }); this.headingEl = heading; this.titleEl = heading.createSpan({ cls: 'gib-search-map-title', text: options.title || 'Semantic map' }); this.statusEl = heading.createSpan({ cls: 'gib-search-map-status' });
    this.stage = host.createDiv({ cls: 'gib-search-map-stage' }); this.canvas = this.stage.createEl('canvas', { cls: 'gib-search-map-canvas' });
    this.detail = host.createDiv({ cls: 'gib-search-map-detail' }); this.detailText = this.detail.createDiv({ cls: 'gib-search-map-detail-text' });
    if (options.onExplore) { const explore = this.detail.createEl('button', { text: 'Explore from note' }); explore.addEventListener('click', () => { if (this.selected) options.onExplore(this.selected); }); }
    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event)); this.canvas.addEventListener('pointermove', event => this.pointerMove(event)); this.canvas.addEventListener('pointerup', event => this.pointerUp(event)); this.canvas.addEventListener('pointercancel', event => this.pointerUp(event)); this.canvas.addEventListener('pointerleave', () => { if (!this.dragging) this.setHover(null, true); }); this.canvas.addEventListener('click', event => this.click(event)); this.canvas.addEventListener('dblclick', event => this.open(event));
    this.resizeObserver = new ResizeObserver(() => this.draw()); this.resizeObserver.observe(this.stage); this.detail.hide();
  }
  setTitle(value) { this.titleEl.textContent = value || this.options.title || 'Semantic map'; }
  setGraph(center, values, edges = []) {
    const sameCenter = this.center?.label === center?.label, previous = sameCenter ? this.byId : new Map(); const scores = values.map(value => Number(value.score || 0)); const low = scores.length ? Math.min(...scores) : 0, high = scores.length ? Math.max(...scores) : 1; const spread = Math.max(.001, high - low);
    this.center = center; this.edges = edges; this.nodes = values.map((value, order) => {
      const relevance = spread > .001 && Number.isFinite(Number(value.score)) ? (Number(value.score) - low) / spread : 1 - order / Math.max(1, values.length); const radius = .16 + (1 - relevance) * .7; const projected = Number.isFinite(value.x) && Number.isFinite(value.y), angle = projected ? Math.atan2(value.y, value.x) : stableMapAngle(value.id); const old = previous.get(value.id);
      return { ...value, order, relevance, radius, x: old?.x ?? 0, y: old?.y ?? 0, targetX: Math.cos(angle) * radius, targetY: Math.sin(angle) * radius };
    });
    this.settleLayout(); this.byId = new Map(this.nodes.map(node => [node.id, node])); this.selected = this.byId.has(this.selected) ? this.selected : null; this.hovered = this.byId.has(this.hovered) ? this.hovered : null; this.statusEl.textContent = `${this.nodes.length} note${this.nodes.length === 1 ? '' : 's'}`; this.animationStarted = performance.now(); this.animate(); this.updateDetail();
  }
  settleLayout() {
    const strength = new Map(this.edges.map(edge => [mapEdgeKey(edge.source, edge.target), Number(edge.score || 0)])); const similarities = this.edges.map(edge => Number(edge.score || 0)); const low = similarities.length ? Math.min(...similarities) : 0, high = similarities.length ? Math.max(...similarities) : 1, spread = Math.max(.001, high - low); const velocity = this.nodes.map(() => ({ x: 0, y: 0 }));
    for (let step = 0; step < 120; step++) {
      for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i], b = this.nodes[j]; let dx = b.targetX - a.targetX, dy = b.targetY - a.targetY; const distance = Math.max(.03, Math.hypot(dx, dy)); dx /= distance; dy /= distance;
        const similarity = (Number(strength.get(mapEdgeKey(a.id, b.id)) || low) - low) / spread, desired = .14 + (1 - similarity) * .72; let force = (distance - desired) * (.004 + similarity * .012); if (distance < .12) force -= (.12 - distance) * .12;
        velocity[i].x += dx * force; velocity[i].y += dy * force; velocity[j].x -= dx * force; velocity[j].y -= dy * force;
      }
      this.nodes.forEach((node, index) => {
        const distance = Math.max(.001, Math.hypot(node.targetX, node.targetY)), radial = (node.radius - distance) * .18; velocity[index].x += node.targetX / distance * radial; velocity[index].y += node.targetY / distance * radial; velocity[index].x *= .72; velocity[index].y *= .72; node.targetX += velocity[index].x; node.targetY += velocity[index].y;
      });
    }
    for (const node of this.nodes) { const distance = Math.max(.001, Math.hypot(node.targetX, node.targetY)); node.targetX = node.targetX / distance * node.radius; node.targetY = node.targetY / distance * node.radius; }
  }
  animate() { cancelAnimationFrame(this.animationFrame); const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 280; const tick = () => { const progress = Math.min(1, (performance.now() - this.animationStarted) / duration); const eased = 1 - Math.pow(1 - progress, 3); for (const node of this.nodes) { node.renderX = node.x + (node.targetX - node.x) * eased; node.renderY = node.y + (node.targetY - node.y) * eased; } this.draw(); if (progress < 1) this.animationFrame = requestAnimationFrame(tick); else for (const node of this.nodes) { node.x = node.targetX; node.y = node.targetY; } }; tick(); }
  colors() { const style = getComputedStyle(this.host); const value = name => style.getPropertyValue(name).trim(); return { accent: value('--text-accent') || '#8b6cff', normal: value('--text-normal') || '#ddd', muted: value('--text-muted') || '#999', faint: value('--text-faint') || '#666', background: value('--background-primary') || '#202020', border: value('--background-modifier-border') || '#444' }; }
  coordinates(node, width, height) { const scale = Math.max(20, Math.min(width, height) / 2 - 42); return [width / 2 + Number(node.renderX ?? node.targetX) * scale, height / 2 + Number(node.renderY ?? node.targetY) * scale]; }
  draw() {
    const rect = this.canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; const dpr = window.devicePixelRatio || 1; this.canvas.width = Math.round(rect.width * dpr); this.canvas.height = Math.round(rect.height * dpr); const ctx = this.canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height); const colors = this.colors(), cx = rect.width / 2, cy = rect.height / 2;
    const focused = this.hovered || this.selected; this.hit = []; for (const node of this.nodes) { const [x, y] = this.coordinates(node, rect.width, rect.height), active = node.id === focused, radius = 3.2 + Math.max(0, Math.min(1, Number(node.fileScale ?? .35))) * 4.8 + (active ? 1.2 : 0); ctx.globalAlpha = focused && !active ? .45 : active ? 1 : .72 + node.relevance * .2; ctx.fillStyle = active || node.id === this.selected ? colors.accent : colors.normal; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); if (active || node.order < 4) this.label(ctx, node.label, x + radius + 5, y + 4, colors, active); this.hit.push({ node, x, y, radius: radius + 11 }); }
    ctx.globalAlpha = 1; ctx.fillStyle = colors.background; ctx.strokeStyle = colors.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); this.label(ctx, this.center?.label || '', cx, cy + 29, colors, true, true);
  }
  label(ctx, value, x, y, colors, active, centered = false) { const text = String(value || ''); const clipped = text.length > 28 ? `${text.slice(0, 27)}…` : text; ctx.font = `${active ? 600 : 500} 11px -apple-system, BlinkMacSystemFont, sans-serif`; ctx.fillStyle = active ? colors.normal : colors.muted; ctx.textAlign = centered ? 'center' : 'left'; ctx.fillText(clipped, x, y); }
  hitAt(event) { const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top; let closest = null, closestDistance = Infinity; for (const item of this.hit || []) { const distance = Math.hypot(item.x - x, item.y - y); if (distance <= item.radius && distance < closestDistance) { closest = item.node; closestDistance = distance; } } return closest; }
  pointerDown(event) { const node = this.hitAt(event); if (!node) return; event.preventDefault(); this.dragging = node; this.canvas.setPointerCapture?.(event.pointerId); this.setSelected(node.id); }
  pointerMove(event) { if (this.dragging) { const rect = this.canvas.getBoundingClientRect(), scale = Math.max(20, Math.min(rect.width, rect.height) / 2 - 42); this.dragging.targetX = this.dragging.renderX = (event.clientX - rect.left - rect.width / 2) / scale; this.dragging.targetY = this.dragging.renderY = (event.clientY - rect.top - rect.height / 2) / scale; this.draw(); return; } const node = this.hitAt(event); this.canvas.style.cursor = node ? 'grab' : 'default'; this.setHover(node?.id || null, true); }
  pointerUp(event) { if (!this.dragging) return; const node = this.dragging; this.dragging = null; this.canvas.releasePointerCapture?.(event.pointerId); const distance = Math.max(.001, Math.hypot(node.targetX, node.targetY)); node.targetX = node.targetX / distance * node.radius; node.targetY = node.targetY / distance * node.radius; this.nodes.forEach(value => { value.x = Number(value.renderX ?? value.targetX); value.y = Number(value.renderY ?? value.targetY); }); this.settleLayout(); this.animationStarted = performance.now(); this.animate(); }
  setHover(id, notify = false) { if (id === this.hovered) return; this.hovered = id; this.updateDetail(); this.draw(); if (notify) this.options.onHover?.(id); }
  setSelected(id) { this.selected = this.byId.has(id) ? id : null; this.updateDetail(); this.draw(); }
  click(event) { const node = this.hitAt(event); this.setSelected(node?.id || null); if (node) this.options.onSelect?.(node.id); }
  open(event) { const node = this.hitAt(event); if (node) this.options.onOpen?.(node.id); }
  updateDetail() { const node = this.byId.get(this.hovered) || this.byId.get(this.selected); if (!node) { this.detail.hide(); return; } this.detail.show(); const folder = node.id.includes('/') ? node.id.slice(0, node.id.lastIndexOf('/')) : 'Vault'; this.detailText.empty(); this.detailText.createDiv({ cls: 'gib-search-map-detail-title', text: node.label }); this.detailText.createDiv({ cls: 'gib-search-map-detail-folder', text: folder }); if (node.entities?.length) this.detailText.createDiv({ cls: 'gib-search-map-detail-entities', text: node.entities.slice(0, 4).join(' · ') }); }
  destroy() { cancelAnimationFrame(this.animationFrame); this.resizeObserver?.disconnect(); }
}

class LivingSemanticMapCanvas extends SemanticMapCanvas {
  constructor(host, app, options = {}) { super(host, app, options); cancelAnimationFrame(this.animationFrame); this.animationFrame = null; this.simulationFrame = null; this.alpha = 0; this.queryPresence = 0; this.targetQueryPresence = 0; this.queryMarkerFocus = 0; this.gaussianLookup = Float32Array.from({ length: 1025 }, (_, index) => Math.exp(-index / 1024 * 9)); this.cameraX = 0; this.cameraY = 0; this.cameraZoom = 1; this.userZoom = 1; this.panX = 0; this.panY = 0; this.pointers = new Map(); this.pendingQuery = false; if (options.onGenerations) { this.headingEl.addClass('has-generations'); this.generationControl = this.headingEl.createDiv({ cls: 'gib-search-map-generations', attr: { 'aria-label': 'Semantic generations' } }); this.headingEl.insertBefore(this.generationControl, this.statusEl); this.generationControl.createSpan({ cls: 'gib-search-map-generations-label', text: 'Gen' }); this.generationButtons = [1, 2, 3].map(value => { const button = this.generationControl.createEl('button', { text: String(value), attr: { type: 'button', title: value === 1 ? 'Query results only' : `${value} semantic generations`, 'aria-label': value === 1 ? 'Show query results only' : `Show ${value} semantic generations` } }); button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); this.setGenerations(value); options.onGenerations(value); }); return button; }); this.setGenerations(options.generations || 1); } this.setupViewportControls(); this.canvas.addEventListener('wheel', event => this.wheel(event), { passive: false }); }
  setGenerations(value) { this.generations = Math.max(1, Math.min(3, Number(value) || 1)); this.generationButtons?.forEach((button, index) => { const active = index + 1 === this.generations; button.toggleClass('is-active', active); button.setAttribute('aria-pressed', String(active)); }); }
  setIntelligenceStatus(value = '') { this.intelligenceStatus = value; const count = this.center?.resultCount || this.nodes.filter(node => node.matched).length; this.statusEl.textContent = value || (this.hasQuery ? `${count} results${this.nodes.length > count ? ` · ${this.nodes.length} shown` : ''}` : `${this.nodes.length} notes`); }
  applyCalculatedLayout(layout, details = null) { if (details instanceof Map) this.activeEdges = (this.activeEdges || []).map(edge => ({ ...edge, relation: details.get(mapEdgeKey(edge.source, edge.target)) || edge.relation })); this.relationships = new Map(this.activeEdges.map(edge => [mapEdgeKey(edge.source, edge.target), edge])); if (layout instanceof Map) for (const node of this.nodes) { const target = layout.get(node.id); if (!target) continue; node.layoutX = target.x; node.layoutY = target.y; } this.queryNode.layoutX = 0; this.queryNode.layoutY = 0; this.lastTerrainAt = 0; this.startSimulation(.82); }
  setupViewportControls() { this.headingEl.addClass('has-viewport'); this.viewportControls = this.headingEl.createDiv({ cls: 'gib-search-map-viewport-controls', attr: { 'aria-label': 'Map view controls' } }); this.headingEl.insertBefore(this.viewportControls, this.statusEl); const control = (iconName, label, action) => { const button = this.viewportControls.createEl('button', { attr: { type: 'button', title: label, 'aria-label': label } }); setIcon(button, iconName); button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); }); return button; }; control('minus', 'Zoom out', () => this.zoomBy(1 / 1.25)); control('maximize-2', 'Fit graph', () => this.resetViewport()); control('plus', 'Zoom in', () => this.zoomBy(1.25)); this.canvas.setAttribute('title', 'Drag empty space to pan · scroll to zoom · double-click empty space to fit'); }
  setUserZoom(value, x = null, y = null) { const rect = this.canvas.getBoundingClientRect(), previous = this.userZoom, next = Math.max(.45, Math.min(4.5, Number(value) || 1)); if (!rect.width || !rect.height || Math.abs(next - previous) < .0001) return; const relativeX = (x ?? rect.width / 2) - rect.width / 2, relativeY = (y ?? rect.height / 2) - rect.height / 2, factor = next / previous; this.panX = relativeX - (relativeX - this.panX) * factor; this.panY = relativeY - (relativeY - this.panY) * factor; this.userZoom = next; this.lastTerrainAt = 0; this.draw(); }
  zoomBy(factor) { this.setUserZoom(this.userZoom * factor); }
  resetViewport() { this.userZoom = 1; this.panX = 0; this.panY = 0; this.lastTerrainAt = 0; this.draw(); }
  wheel(event) { event.preventDefault(); const rect = this.canvas.getBoundingClientRect(), factor = Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * .0018); this.setUserZoom(this.userZoom * factor, event.clientX - rect.left, event.clientY - rect.top); }
  setGraph(center, values, edges = []) {
    this.lastTerrainAt = 0;
    const previous = this.byId || new Map(), previousQuery = this.queryNode, hasQuery = Boolean(center?.hasQuery), semanticScores = values.map(value => Number(value.semanticScore || 0)), low = semanticScores.length ? Math.min(...semanticScores) : 0, high = semanticScores.length ? Math.max(...semanticScores) : 1, spread = Math.max(.001, high - low); this.center = center; this.edges = edges; this.hasQuery = hasQuery; this.targetQueryPresence = hasQuery ? 1 : 0;
    this.queryNode = { id: '__query__', label: center?.label || 'Search', isQuery: true, x: previousQuery?.x || 0, y: previousQuery?.y || 0, layoutX: 0, layoutY: 0, vx: previousQuery?.vx || 0, vy: previousQuery?.vy || 0 };
    this.nodes = values.map((value, order) => {
      const old = previous.get(value.id), angle = stableMapAngle(value.id), normalized = hasQuery ? Math.max(0, Math.min(1, (Number(value.semanticScore || 0) - low) / spread)) : .5, relevance = Number.isFinite(Number(value.relevance)) ? Number(value.relevance) : normalized, fileScale = Math.max(0, Math.min(1, Number(value.fileScale ?? .35))), targetVisibility = hasQuery ? .12 + relevance * .88 : .38 + fileScale * .42;
      const matched = Boolean(value.matched), generation = Math.max(1, Math.min(3, Number(value.generation) || 1)), generationVisibility = generation === 1 ? .78 + relevance * .22 : generation === 2 ? .68 : .52;
      const layoutX = Number.isFinite(value.layoutX) ? value.layoutX : Number.isFinite(value.x) ? value.x : Math.cos(angle) * (.18 + ((order % 17) / 17) * .64), layoutY = Number.isFinite(value.layoutY) ? value.layoutY : Number.isFinite(value.y) ? value.y : Math.sin(angle) * (.18 + ((order % 17) / 17) * .64); return { ...value, matched, generation, order, fileScale, relevance: old?.relevance ?? relevance, targetRelevance: relevance, visibility: old?.visibility ?? 0, targetVisibility: hasQuery ? (matched ? generationVisibility : 0) : targetVisibility, accent: old?.accent ?? 0, targetAccent: hasQuery && matched && generation === 1 ? .3 + relevance * .7 : 0, layoutX, layoutY, x: old?.x ?? layoutX, y: old?.y ?? layoutY, vx: old?.vx || 0, vy: old?.vy || 0 };
    });
    const communityById = new Map(this.nodes.map(node => [node.id, node.community])), overallScores = edges.map(edge => Number(edge.affinity ?? edge.score ?? 0)), overallLow = overallScores.length ? Math.min(...overallScores) : 0, overallHigh = overallScores.length ? Math.max(...overallScores) : 1, overallSpread = Math.max(.001, overallHigh - overallLow); this.activeEdges = edges.map(edge => { const weight = Number(edge.affinity ?? edge.score ?? overallLow), overall = (weight - overallLow) / overallSpread, residual = Math.max(-1, Math.min(1, Number(edge.residualScore || 0))), sourceCommunity = communityById.get(edge.source), targetCommunity = communityById.get(edge.target), crossCommunity = sourceCommunity !== undefined && targetCommunity !== undefined && sourceCommunity !== targetCommunity, baseStrength = edge.bridge ? .1 : overall * (.62 + Math.max(0, residual) * .48), strength = crossCommunity ? baseStrength * .08 : baseStrength; return { ...edge, overall, residual, strength, crossCommunity }; }).filter(edge => edge.strength > .008); this.relationships = new Map(this.activeEdges.map(edge => [mapEdgeKey(edge.source, edge.target), edge]));
    this.pendingQuery = false; this.byId = new Map(this.nodes.map(node => [node.id, node])); this.selected = this.byId.has(this.selected) ? this.selected : null; this.hovered = this.byId.has(this.hovered) || this.hovered === '__query__' ? this.hovered : null; const activeCount = this.nodes.filter(node => node.matched).length; this.statusEl.textContent = hasQuery ? `${Number(center.resultCount || 0)} results${activeCount > Number(center.resultCount || 0) ? ` · ${activeCount} shown` : ''}` : `${this.nodes.length} notes`; this.startSimulation(previous.size ? .82 : 1); this.updateDetail();
  }
  beginQuery(label) { if (!this.queryNode || this.hasQuery) return; this.hasQuery = true; this.pendingQuery = true; this.center = { ...(this.center || {}), label, hasQuery: true, resultCount: 0 }; this.queryNode.label = label; const centerX = this.nodes.reduce((sum, node) => sum + node.x, 0) / Math.max(1, this.nodes.length), centerY = this.nodes.reduce((sum, node) => sum + node.y, 0) / Math.max(1, this.nodes.length); this.queryNode.x = centerX; this.queryNode.y = centerY; this.queryNode.vx = this.queryNode.vy = 0; this.targetQueryPresence = 1; for (const node of this.nodes) { node.matched = false; node.targetVisibility = .38 + node.fileScale * .42; node.targetAccent = 0; } this.startSimulation(.7); }
  endQuery() { if (!this.queryNode || !this.hasQuery) return; this.hasQuery = false; this.pendingQuery = false; this.center = { ...(this.center || {}), label: 'Search', hasQuery: false, resultCount: 0 }; this.targetQueryPresence = 0; for (const node of this.nodes) { node.matched = false; node.targetVisibility = .38 + node.fileScale * .42; node.targetAccent = 0; } this.startSimulation(.72); }
  physicsStep(alpha) {
    this.queryPresence += (this.targetQueryPresence - this.queryPresence) * .075; this.queryMarkerFocus += ((this.hovered === '__query__' ? 1 : 0) - this.queryMarkerFocus) * .18; for (const node of this.nodes) { node.relevance += (node.targetRelevance - node.relevance) * .075; node.visibility += (node.targetVisibility - node.visibility) * .09; node.accent += (node.targetAccent - node.accent) * .09; }
    const query = this.queryNode, foreground = this.nodes.filter(node => node.matched), activeNodes = this.hasQuery && !this.pendingQuery ? foreground : this.nodes; for (const node of activeNodes) { if (node === this.dragging) continue; node.vx += (node.layoutX - node.x) * .018 * alpha; node.vy += (node.layoutY - node.y) * .018 * alpha; } if (this.queryPresence > .01 && query !== this.dragging) { query.vx += (query.layoutX - query.x) * .012 * alpha; query.vy += (query.layoutY - query.y) * .012 * alpha; }
    for (let first = 0; first < activeNodes.length; first++) for (let second = first + 1; second < activeNodes.length; second++) { const a = activeNodes[first], b = activeNodes[second]; let dx = b.x - a.x, dy = b.y - a.y; const distance = Math.max(.018, Math.hypot(dx, dy)); dx /= distance; dy /= distance; const collisionDistance = .035 + (a.fileScale + b.fileScale) * .022, collision = distance < collisionDistance ? -(collisionDistance - distance) * .1 * alpha : 0, relaxation = -Math.min(.0012, .000008 / (distance * distance)) * alpha, force = collision + relaxation; if (a !== this.dragging) { a.vx += dx * force; a.vy += dy * force; } if (b !== this.dragging) { b.vx -= dx * force; b.vy -= dy * force; } }
    const corralBodies = this.queryPresence > .04 ? [query, ...activeNodes] : activeNodes; for (const body of corralBodies) { if (body === this.dragging) continue; const distance = Math.hypot(body.x, body.y); if (distance <= .92) continue; body.vx -= body.x / distance * (distance - .92) * .045 * alpha; body.vy -= body.y / distance * (distance - .92) * .045 * alpha; }
    const bodies = this.queryPresence > .04 ? [query, ...this.nodes] : this.nodes; for (const body of bodies) { if (body === this.dragging) { body.vx = body.vy = 0; continue; } body.vx *= .86; body.vy *= .86; body.x += body.vx; body.y += body.vy; }
    const cameraBodies = this.hasQuery ? (this.pendingQuery ? this.nodes : [query, ...foreground]) : this.nodes, targetX = this.hasQuery && cameraBodies.length ? cameraBodies.reduce((sum, body) => sum + body.x, 0) / cameraBodies.length : 0, targetY = this.hasQuery && cameraBodies.length ? cameraBodies.reduce((sum, body) => sum + body.y, 0) / cameraBodies.length : 0, extent = this.hasQuery && cameraBodies.length ? Math.max(.16, ...cameraBodies.map(body => Math.hypot(body.x - targetX, body.y - targetY))) : .8, targetZoom = this.hasQuery && !this.pendingQuery ? Math.max(1.12, Math.min(2.15, .7 / extent)) : 1; this.cameraX += (targetX - this.cameraX) * .055; this.cameraY += (targetY - this.cameraY) * .055; this.cameraZoom += (targetZoom - this.cameraZoom) * .05;
  }
  startSimulation(alpha = .7) { this.alpha = Math.max(this.alpha, alpha); if (this.simulationFrame) return; const tick = () => { this.simulationFrame = null; if (!matchMedia('(prefers-reduced-motion: reduce)').matches) this.physicsStep(this.alpha); else { this.queryPresence = this.targetQueryPresence; this.cameraZoom = this.hasQuery ? 1.35 : 1; this.queryNode.x = this.queryNode.layoutX; this.queryNode.y = this.queryNode.layoutY; for (const node of this.nodes) { node.relevance = node.targetRelevance; node.visibility = node.targetVisibility; node.accent = node.targetAccent; node.x = node.layoutX; node.y = node.layoutY; } } this.alpha *= .986; this.draw(); const transitioning = Math.abs(this.queryPresence - this.targetQueryPresence) > .01 || this.nodes.some(node => Math.abs(node.visibility - node.targetVisibility) > .015); if (this.alpha > .01 || this.dragging || transitioning) this.simulationFrame = requestAnimationFrame(tick); }; this.simulationFrame = requestAnimationFrame(tick); }
  coordinates(node, width, height) { const scale = Math.max(20, Math.min(width, height) / 2 - 68) * this.cameraZoom * this.userZoom; return [width / 2 + (Number(node.x) - this.cameraX) * scale + this.panX, height / 2 + (Number(node.y) - this.cameraY) * scale + this.panY]; }
  semanticDensityField(width, height) {
    const step = 5, columns = Math.max(2, Math.ceil(width / step) + 1), rows = Math.max(2, Math.ceil(height / step) + 1), values = new Float32Array(columns * rows), visible = this.nodes.filter(node => node.visibility > .04 && (!this.hasQuery || this.pendingQuery || node.matched)), points = new Map(visible.map(node => { const [x, y] = this.coordinates(node, width, height); return [node.id, { node, x, y }]; })), zoom = Math.max(.35, this.cameraZoom * this.userZoom), sigma = Math.max(9, 27 * zoom), anchors = [...points.values()].map(point => ({ x: point.x, y: point.y, coreRadius: (2.8 + Number(point.node.fileScale || 0) * 2.6) * zoom })), gaussian = ratio => this.gaussianLookup[Math.max(0, Math.min(1024, Math.round(ratio / 9 * 1024)))];
    const addMass = (x, y, radius, amplitude) => { const reach = radius * 3, left = Math.max(0, Math.floor((x - reach) / step)), right = Math.min(columns - 1, Math.ceil((x + reach) / step)), top = Math.max(0, Math.floor((y - reach) / step)), bottom = Math.min(rows - 1, Math.ceil((y + reach) / step)), divisor = 2 * radius * radius; for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) { const dx = column * step - x, dy = row * step - y; values[row * columns + column] += amplitude * gaussian((dx * dx + dy * dy) / divisor); } };
    const addRidge = (source, target, radius, amplitude) => { const reach = radius * 3, left = Math.max(0, Math.floor((Math.min(source.x, target.x) - reach) / step)), right = Math.min(columns - 1, Math.ceil((Math.max(source.x, target.x) + reach) / step)), top = Math.max(0, Math.floor((Math.min(source.y, target.y) - reach) / step)), bottom = Math.min(rows - 1, Math.ceil((Math.max(source.y, target.y) + reach) / step)), dx = target.x - source.x, dy = target.y - source.y, lengthSquared = Math.max(1, dx * dx + dy * dy), divisor = 2 * radius * radius; for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) { const x = column * step, y = row * step, along = Math.max(0, Math.min(1, ((x - source.x) * dx + (y - source.y) * dy) / lengthSquared)), nearestX = source.x + dx * along, nearestY = source.y + dy * along, distanceX = x - nearestX, distanceY = y - nearestY, taper = Math.sin(Math.PI * along) ** .6; values[row * columns + column] += amplitude * taper * gaussian((distanceX * distanceX + distanceY * distanceY) / divisor); } };
    for (const { node, x, y } of points.values()) { const generationWeight = node.generation === 1 ? 1 : node.generation === 2 ? .58 : .36, amplitude = node.visibility * generationWeight * (.82 + Math.max(0, Math.min(1, node.relevance)) * .18); addMass(x, y, sigma, amplitude); }
    const degree = new Map(), ridges = (this.activeEdges || []).filter(edge => !edge.crossCommunity && edge.strength > .14 && points.has(edge.source) && points.has(edge.target)).sort((a, b) => b.strength - a.strength).filter(edge => { const source = degree.get(edge.source) || 0, target = degree.get(edge.target) || 0; if (source >= 2 || target >= 2) return false; degree.set(edge.source, source + 1); degree.set(edge.target, target + 1); return true; }).slice(0, 28), ridgeRadius = sigma * .58;
    for (const edge of ridges) addRidge(points.get(edge.source), points.get(edge.target), ridgeRadius, .12 + Math.min(1, edge.strength) * .2);
    if (this.hasQuery && this.queryPresence > .04) { const [centerX, centerY] = this.coordinates(this.queryNode, width, height), center = { x: centerX, y: centerY }, directResults = [...points.values()].filter(({ node }) => node.matched && node.generation === 1).sort((first, second) => second.node.relevance - first.node.relevance).slice(0, 5); for (const target of directResults) addRidge(center, target, sigma * .46, this.queryPresence * target.node.visibility * (.07 + Math.max(0, Math.min(1, target.node.relevance)) * .11)); const supportMaximum = Math.max(0, ...values); addMass(centerX, centerY, sigma * .56, (supportMaximum * 1.18 + .42) * this.queryPresence); anchors.push({ ...center, coreRadius: 4.2 * zoom }); }
    this.suppressEmptySummits(values, columns, rows, step, anchors, sigma);
    this.anchorSummitMesas(values, columns, rows, step, anchors, sigma);
    return { values, columns, rows, step };
  }
  suppressEmptySummits(values, columns, rows, step, anchors, sigma) {
    if (anchors.length < 2) return; const anchorRadius = Math.max(step * 1.75, sigma * .38), nearbyRadius = sigma * 3.2, sample = ({ x, y }) => values[Math.max(0, Math.min(rows - 1, Math.round(y / step))) * columns + Math.max(0, Math.min(columns - 1, Math.round(x / step)))], anchorHeights = anchors.map(anchor => ({ ...anchor, height: sample(anchor) })), candidates = [];
    for (let row = 1; row < rows - 1; row++) for (let column = 1; column < columns - 1; column++) { const index = row * columns + column, height = values[index]; if (height < .35) continue; let maximum = true, hasLowerNeighbor = false; for (let dy = -1; dy <= 1 && maximum; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const neighbor = values[(row + dy) * columns + column + dx]; if (neighbor > height) { maximum = false; break; } if (neighbor < height) hasLowerNeighbor = true; } if (!maximum || !hasLowerNeighbor) continue; const x = column * step, y = row * step, distances = anchorHeights.map(anchor => ({ anchor, distance: Math.hypot(anchor.x - x, anchor.y - y) })).sort((first, second) => first.distance - second.distance), nearestDistance = distances[0]?.distance ?? Infinity; if (nearestDistance <= anchorRadius) continue; const nearby = distances.filter(item => item.distance <= nearbyRadius), anchorHeight = Math.max(0, ...(nearby.length ? nearby : distances.slice(0, 1)).map(item => item.anchor.height)), excess = height - (anchorHeight - .025); if (excess > .04) candidates.push({ x, y, excess, radius: Math.max(step * 1.4, Math.min(sigma * .68, nearestDistance * .48)) }); }
    if (!candidates.length) return; const depression = new Float32Array(values.length); for (const candidate of candidates.slice(0, 24)) { const reach = candidate.radius * 2.6, left = Math.max(0, Math.floor((candidate.x - reach) / step)), right = Math.min(columns - 1, Math.ceil((candidate.x + reach) / step)), top = Math.max(0, Math.floor((candidate.y - reach) / step)), bottom = Math.min(rows - 1, Math.ceil((candidate.y + reach) / step)), divisor = 2 * candidate.radius * candidate.radius; for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) { const dx = column * step - candidate.x, dy = row * step - candidate.y, index = row * columns + column, amount = candidate.excess * Math.exp(-(dx * dx + dy * dy) / divisor); depression[index] = Math.max(depression[index], amount); } } for (let index = 0; index < values.length; index++) values[index] = Math.max(0, values[index] - depression[index]);
  }
  anchorSummitMesas(values, columns, rows, step, anchors, sigma) {
    if (!anchors.length) return; const source = Float32Array.from(values), terrainScale = sigma / 27, sample = (column, row) => source[Math.max(0, Math.min(rows - 1, row)) * columns + Math.max(0, Math.min(columns - 1, column))], mesas = anchors.map(anchor => { const coreRadius = Math.max(1.8, Number(anchor.coreRadius || 0)), searchRadius = coreRadius * 2.75, left = Math.max(0, Math.floor((anchor.x - searchRadius) / step)), right = Math.min(columns - 1, Math.ceil((anchor.x + searchRadius) / step)), top = Math.max(0, Math.floor((anchor.y - searchRadius) / step)), bottom = Math.min(rows - 1, Math.ceil((anchor.y + searchRadius) / step)); let summit = 0; for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) if (Math.hypot(column * step - anchor.x, row * step - anchor.y) <= searchRadius) summit = Math.max(summit, sample(column, row)); return { ...anchor, coreRadius, featherRadius: coreRadius + Math.max(step, 7.5 * terrainScale), summit: summit * .985 }; });
    for (const mesa of mesas) { const left = Math.max(0, Math.floor((mesa.x - mesa.featherRadius) / step)), right = Math.min(columns - 1, Math.ceil((mesa.x + mesa.featherRadius) / step)), top = Math.max(0, Math.floor((mesa.y - mesa.featherRadius) / step)), bottom = Math.min(rows - 1, Math.ceil((mesa.y + mesa.featherRadius) / step)); for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) { const distance = Math.hypot(column * step - mesa.x, row * step - mesa.y); if (distance > mesa.featherRadius) continue; const raw = Math.max(0, Math.min(1, (mesa.featherRadius - distance) / Math.max(1, mesa.featherRadius - mesa.coreRadius))), blend = raw * raw * (3 - 2 * raw), index = row * columns + column; values[index] += Math.max(0, mesa.summit - values[index]) * blend; } }
  }
  paintDensityTerrain(ctx, width, height, colors) {
    const now = performance.now(), colorKey = `${colors.normal}|${colors.muted}`, refresh = !this.terrainCanvas || this.terrainCanvas.width !== Math.ceil(width) || this.terrainCanvas.height !== Math.ceil(height) || this.terrainColorKey !== colorKey || now - Number(this.lastTerrainAt || 0) >= 32; if (refresh) { const field = this.semanticDensityField(width, height), maximum = Math.max(0, ...field.values); if (!this.terrainCanvas) this.terrainCanvas = document.createElement('canvas'); if (!this.terrainMask) this.terrainMask = document.createElement('canvas'); const terrain = this.terrainCanvas, mask = this.terrainMask; terrain.width = Math.ceil(width); terrain.height = Math.ceil(height); mask.width = field.columns; mask.height = field.rows; const terrainContext = terrain.getContext('2d'), maskContext = mask.getContext('2d'), image = maskContext.createImageData(field.columns, field.rows); maskContext.fillStyle = colors.normal; maskContext.fillRect(0, 0, 1, 1); const sample = maskContext.getImageData(0, 0, 1, 1).data; for (let index = 0; index < field.values.length; index++) { const alpha = Math.round(Math.max(0, Math.min(.055, (field.values[index] - .14) / 3 * .055)) * 255), offset = index * 4; image.data[offset] = sample[0]; image.data[offset + 1] = sample[1]; image.data[offset + 2] = sample[2]; image.data[offset + 3] = alpha; } maskContext.putImageData(image, 0, 0); terrainContext.clearRect(0, 0, terrain.width, terrain.height); if (maximum >= .16) { terrainContext.imageSmoothingEnabled = true; terrainContext.drawImage(mask, 0, 0, field.columns, field.rows, 0, 0, field.columns * field.step, field.rows * field.step); const levels = [.35, .62, .95, 1.35, 1.9, 2.6]; terrainContext.lineCap = 'round'; terrainContext.lineJoin = 'round'; levels.forEach((level, index) => { if (maximum < level) return; this.traceDensityLevel(terrainContext, field, level); terrainContext.strokeStyle = colors.muted; terrainContext.globalAlpha = .14 + index * .035; terrainContext.lineWidth = index === levels.length - 1 ? 1.05 : .72; terrainContext.stroke(); }); terrainContext.globalAlpha = 1; } this.lastTerrainAt = now; this.terrainColorKey = colorKey; }
    if (this.terrainCanvas) ctx.drawImage(this.terrainCanvas, 0, 0, width, height);
  }
  traceDensityLevel(ctx, field, level) {
    const { values, columns, rows, step } = field, interpolate = (first, second) => Math.max(0, Math.min(1, Math.abs(second - first) < 1e-6 ? .5 : (level - first) / (second - first))); ctx.beginPath(); for (let row = 0; row < rows - 1; row++) for (let column = 0; column < columns - 1; column++) { const topLeft = values[row * columns + column], topRight = values[row * columns + column + 1], bottomRight = values[(row + 1) * columns + column + 1], bottomLeft = values[(row + 1) * columns + column], mask = (topLeft >= level ? 1 : 0) | (topRight >= level ? 2 : 0) | (bottomRight >= level ? 4 : 0) | (bottomLeft >= level ? 8 : 0); if (mask === 0 || mask === 15) continue; const x = column * step, y = row * step, points = { top: [x + interpolate(topLeft, topRight) * step, y], right: [x + step, y + interpolate(topRight, bottomRight) * step], bottom: [x + interpolate(bottomLeft, bottomRight) * step, y + step], left: [x, y + interpolate(topLeft, bottomLeft) * step] }, centerHigh = (topLeft + topRight + bottomRight + bottomLeft) / 4 >= level, pairs = mask === 1 || mask === 14 ? [['left', 'top']] : mask === 2 || mask === 13 ? [['top', 'right']] : mask === 3 || mask === 12 ? [['left', 'right']] : mask === 4 || mask === 11 ? [['right', 'bottom']] : mask === 6 || mask === 9 ? [['top', 'bottom']] : mask === 7 || mask === 8 ? [['left', 'bottom']] : mask === 5 ? centerHigh ? [['top', 'right'], ['bottom', 'left']] : [['left', 'top'], ['right', 'bottom']] : centerHigh ? [['left', 'top'], ['right', 'bottom']] : [['top', 'right'], ['bottom', 'left']]; for (const [first, second] of pairs) { ctx.moveTo(...points[first]); ctx.lineTo(...points[second]); } }
  }
  draw() {
    const rect = this.canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; const dpr = window.devicePixelRatio || 1, pixelWidth = Math.round(rect.width * dpr), pixelHeight = Math.round(rect.height * dpr); if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth; if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight; const ctx = this.canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height); const colors = this.colors(), focused = this.hovered || this.selected, queryFocused = focused === '__query__', labelNodes = new Set(); this.hit = []; this.paintDensityTerrain(ctx, rect.width, rect.height, colors);
    if (focused && !queryFocused) labelNodes.add(focused);
    const labels = [], ordered = this.hasQuery && !this.pendingQuery ? [...this.nodes.filter(node => !node.matched), ...this.nodes.filter(node => node.matched)] : this.nodes; for (const node of ordered) { if (node.visibility < .012) continue; const [x, y] = this.coordinates(node, rect.width, rect.height), active = node.id === focused, relationship = focused && !queryFocused ? this.relationships.get(mapEdgeKey(node.id, focused)) : null, related = Number(relationship?.overall || 0), generationScale = node.generation === 1 ? 1 : node.generation === 2 ? .86 : .74, radius = Math.max(1.1, (2 + node.fileScale * 4.4 + (active ? 1.5 : 0)) * generationScale), focusAlpha = !focused ? 1 : active ? 1 : queryFocused ? .38 + node.relevance * .62 : .18 + related * .76, opacity = Math.max(.01, node.visibility * focusAlpha), semanticColor = this.options.semanticColors !== false && Number.isFinite(node.topicHue) ? `hsl(${node.topicHue} 54% 64%)` : colors.normal; ctx.globalAlpha = opacity; ctx.fillStyle = node.matched || !this.hasQuery || this.pendingQuery ? semanticColor : colors.faint; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); if (labelNodes.has(node.id) && (node.matched || !this.hasQuery || this.pendingQuery)) labels.push({ node, x, y, radius, active, opacity }); if (node.matched || !this.hasQuery || this.pendingQuery) this.hit.push({ node, x, y, radius: radius + 9 }); }
    if (this.queryPresence > .02) { const [queryX, queryY] = this.coordinates(this.queryNode, rect.width, rect.height), active = queryFocused, marker = 4.5 + this.queryMarkerFocus * 1.2, tickInner = marker + 3.5, tickOuter = tickInner + 3 + this.queryMarkerFocus * 1.5; ctx.globalAlpha = this.queryPresence * .42; ctx.strokeStyle = colors.muted; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(queryX - tickOuter, queryY); ctx.lineTo(queryX - tickInner, queryY); ctx.moveTo(queryX + tickInner, queryY); ctx.lineTo(queryX + tickOuter, queryY); ctx.moveTo(queryX, queryY - tickOuter); ctx.lineTo(queryX, queryY - tickInner); ctx.moveTo(queryX, queryY + tickInner); ctx.lineTo(queryX, queryY + tickOuter); ctx.stroke(); ctx.globalAlpha = this.queryPresence; ctx.fillStyle = colors.accent; ctx.beginPath(); ctx.moveTo(queryX, queryY - marker); ctx.lineTo(queryX + marker * .72, queryY); ctx.lineTo(queryX, queryY + marker); ctx.lineTo(queryX - marker * .72, queryY); ctx.closePath(); ctx.fill(); labels.push({ node: this.queryNode, x: queryX, y: queryY, radius: tickOuter, active, opacity: this.queryPresence, query: true }); this.hit.push({ node: this.queryNode, x: queryX, y: queryY, radius: 16 }); }
    this.drawLabels(ctx, labels, colors, rect.width, rect.height); ctx.globalAlpha = 1;
  }
  drawLabels(ctx, labels, colors, width, height) {
    const occupied = [], clip = (value, length) => { const text = String(value || ''); return text.length > length ? `${text.slice(0, length - 1)}…` : text; };
    for (const item of labels.sort((a, b) => Number(b.query) - Number(a.query) || Number(b.active) - Number(a.active) || Number(b.node.relevance || 0) - Number(a.node.relevance || 0))) {
      const title = clip(item.node.label, item.query ? 34 : 30), folder = !item.query && item.active ? (item.node.id.includes('/') ? item.node.id.slice(0, item.node.id.lastIndexOf('/')) : 'Vault') : '', subtitle = item.query && item.active ? (this.center?.id ? 'Local note' : 'Search origin') : folder ? clip(folder, 38) : '';
      ctx.font = `${item.query || item.active ? 600 : 500} 11px -apple-system, BlinkMacSystemFont, sans-serif`; const titleWidth = ctx.measureText(title).width; ctx.font = `500 9px -apple-system, BlinkMacSystemFont, sans-serif`; const subtitleWidth = subtitle ? ctx.measureText(subtitle).width : 0, textWidth = Math.max(titleWidth, subtitleWidth), textHeight = subtitle ? 26 : 15, near = item.radius + 6, far = item.radius + 17, candidates = [[item.x + near, item.y + 4, 'left', false], [item.x - near, item.y + 4, 'right', false], [item.x, item.y - near - 3, 'center', false], [item.x, item.y + near + 11, 'center', false], [item.x + far, item.y - 8, 'left', true], [item.x - far, item.y - 8, 'right', true]]; let chosen = null;
      for (const [x, y, align, leader] of candidates) { const left = align === 'left' ? x : align === 'right' ? x - textWidth : x - textWidth / 2, box = { left: left - 3, right: left + textWidth + 3, top: y - 12, bottom: y - 12 + textHeight }; if (box.left < 5 || box.right > width - 5 || box.top < 5 || box.bottom > height - 5 || occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue; chosen = { x, y, align, box, leader }; break; }
      if (!chosen) continue; occupied.push(chosen.box); if (chosen.leader) { const anchorX = chosen.align === 'left' ? chosen.box.left : chosen.box.right, anchorY = Math.max(chosen.box.top + 4, Math.min(chosen.box.bottom - 4, item.y)), dx = anchorX - item.x, dy = anchorY - item.y, distance = Math.max(1, Math.hypot(dx, dy)); ctx.globalAlpha = Math.max(.16, item.opacity * .3); ctx.strokeStyle = colors.muted; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(item.x + dx / distance * (item.radius + 2), item.y + dy / distance * (item.radius + 2)); ctx.lineTo(anchorX - dx / distance * 3, anchorY - dy / distance * 3); ctx.stroke(); }
      ctx.globalAlpha = Math.max(.38, item.opacity); ctx.fillStyle = item.query || item.active ? colors.normal : colors.muted; ctx.textAlign = chosen.align; ctx.font = `${item.query || item.active ? 600 : 500} 11px -apple-system, BlinkMacSystemFont, sans-serif`; ctx.fillText(title, chosen.x, chosen.y); if (subtitle) { ctx.globalAlpha = Math.max(.28, item.opacity * .72); ctx.fillStyle = colors.muted; ctx.font = `500 9px -apple-system, BlinkMacSystemFont, sans-serif`; ctx.fillText(subtitle, chosen.x, chosen.y + 12); }
    }
  }
  setHover(id, notify = false) { const queryChanged = (this.hovered === '__query__') !== (id === '__query__'); super.setHover(id, notify); if (queryChanged) this.startSimulation(.18); }
  pointerDown(event) { if (event.pointerType === 'mouse' && event.button !== 0) return; event.preventDefault(); this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); this.canvas.setPointerCapture?.(event.pointerId); if (this.pointers.size > 1) { const points = [...this.pointers.values()].slice(0, 2), centerX = (points[0].x + points[1].x) / 2, centerY = (points[0].y + points[1].y) / 2; this.pinch = { distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)), centerX, centerY, zoom: this.userZoom, panX: this.panX, panY: this.panY }; this.dragging = null; this.panning = null; this.suppressClick = true; return; } const node = this.hitAt(event); this.canvas.style.cursor = 'grabbing'; if (node) { this.dragging = node; this.draggingPointer = event.pointerId; if (!node.isQuery) this.setSelected(node.id); this.startSimulation(.45); } else this.panning = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; }
  pointerMove(event) { const rect = this.canvas.getBoundingClientRect(); if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (this.pinch && this.pointers.size > 1) { const points = [...this.pointers.values()].slice(0, 2), distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)), centerX = (points[0].x + points[1].x) / 2, centerY = (points[0].y + points[1].y) / 2, next = Math.max(.45, Math.min(4.5, this.pinch.zoom * distance / this.pinch.distance)), factor = next / this.pinch.zoom, startX = this.pinch.centerX - rect.left - rect.width / 2, startY = this.pinch.centerY - rect.top - rect.height / 2, currentX = centerX - rect.left - rect.width / 2, currentY = centerY - rect.top - rect.height / 2; this.userZoom = next; this.panX = currentX - (startX - this.pinch.panX) * factor; this.panY = currentY - (startY - this.pinch.panY) * factor; this.draw(); return; } if (this.panning?.pointerId === event.pointerId) { const dx = event.clientX - this.panning.x, dy = event.clientY - this.panning.y; this.panX += dx; this.panY += dy; this.panning.x = event.clientX; this.panning.y = event.clientY; if (Math.abs(dx) + Math.abs(dy) > 1) { this.panning.moved = true; this.suppressClick = true; } this.draw(); return; } if (this.dragging && this.draggingPointer === event.pointerId) { const scale = Math.max(20, Math.min(rect.width, rect.height) / 2 - 68) * this.cameraZoom * this.userZoom; this.dragging.x = (event.clientX - rect.left - rect.width / 2 - this.panX) / scale + this.cameraX; this.dragging.y = (event.clientY - rect.top - rect.height / 2 - this.panY) / scale + this.cameraY; this.dragging.vx = this.dragging.vy = 0; this.startSimulation(.38); return; } const node = this.hitAt(event); this.canvas.style.cursor = 'grab'; this.setHover(node?.id || null, true); }
  pointerUp(event) { this.pointers.delete(event.pointerId); if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.canvas.releasePointerCapture?.(event.pointerId); this.canvas.style.cursor = 'grab'; return; } if (this.panning?.pointerId === event.pointerId) { this.suppressClick ||= this.panning.moved; this.panning = null; this.canvas.releasePointerCapture?.(event.pointerId); this.canvas.style.cursor = 'grab'; return; } if (!this.dragging || this.draggingPointer !== event.pointerId) return; this.dragging = null; this.draggingPointer = null; this.canvas.style.cursor = 'grab'; this.canvas.releasePointerCapture?.(event.pointerId); this.startSimulation(.62); }
  click(event) { if (this.suppressClick) { this.suppressClick = false; return; } const node = this.hitAt(event); if (node?.isQuery) return; super.click(event); }
  open(event) { const node = this.hitAt(event); if (!node) { this.resetViewport(); return; } if (node.isQuery) return; super.open(event); }
  destroy() { cancelAnimationFrame(this.simulationFrame); cancelAnimationFrame(this.animationFrame); this.resizeObserver?.disconnect(); }
}

class SemanticSearchModal extends SuggestModal {
  constructor(app, plugin, filePath = null) {
    super(app); this.plugin = plugin; this.filePath = filePath; this.debounceTimer = null; this.searchVersion = 0; this.lastResults = []; this.mapResults = []; this.lastQuery = ''; this.visibleLimit = 0; this.canLoadMore = false; this.navigationHandler = null; this.map = null; this.mapVersion = 0; this.lensVersion = 0; this.lens = validSearchLens(plugin.settings.defaultSearchLens); this.lensRelationships = new Map(); this.lensRelationshipEdges = []; this.mapGenerations = Math.max(1, Math.min(3, Number(plugin.settings.searchMapGenerations) || 1));
    const fileName = filePath ? filePath.split('/').pop().replace(/\.md$/i, '') : '';
    this.setPlaceholder(filePath ? `Search within ${fileName}…` : 'Search vault by meaning…');
    this.setInstructions([{ command: 'Type', purpose: 'to search' }, { command: '↑↓', purpose: 'to navigate' }, { command: '↵', purpose: 'to open' }, { command: 'esc', purpose: 'to dismiss' }]);
  }
  getSuggestions(query) {
    if (!query || query.trim().length < 2) { clearTimeout(this.debounceTimer); this.searchVersion++; this.lensVersion++; const changed = Boolean(this.lastQuery); this.lastQuery = ''; this.lastResults = []; this.mapResults = []; this.lensRelationships = new Map(); this.lensRelationshipEdges = []; if (changed) { this.map?.endQuery(); window.setTimeout(() => this.updateMap(), 0); } return []; }
    const trimmed = query.trim();
    if (trimmed !== this.lastQuery) { const entering = !this.lastQuery; this.lastQuery = trimmed; if (entering) this.map?.beginQuery(trimmed); this.visibleLimit = activeTweaks(this.plugin).topK; this.triggerSearch(trimmed); }
    return this.lastResults;
  }
  triggerSearch(query, immediate = false) {
    clearTimeout(this.debounceTimer); const version = ++this.searchVersion;
    this.debounceTimer = setTimeout(async () => {
      try {
        const tweaks = activeTweaks(this.plugin);
        const requested = Math.max(this.visibleLimit || tweaks.topK, tweaks.topK);
        const rawLimit = this.filePath ? Math.min(1000, requested + 10) : Math.min(1000, Math.max(requested * 4, 40));
        const options = { scoreWindow: tweaks.scoreWindow, folderPathBoost: !this.filePath && this.plugin.settings.folderPathBoostEnabled ? tweaks.folderPathBoost : 0, semanticHighlights: tweaks.semanticHighlights, resultMinScore: tweaks.highlightResultMinScore, singleWordMinScore: tweaks.highlightSingleWordMinScore, phraseMinScore: tweaks.highlightPhraseMinScore, maxPhrases: tweaks.highlightMaxPhrases, highlightLimit: 15, file: this.filePath };
        const runSearch = this.plugin.search.searchLive?.bind(this.plugin.search) || this.plugin.search.search.bind(this.plugin.search);
        const results = await runSearch(query, rawLimit, tweaks.minScore, options);
        if (version === this.searchVersion && query === this.lastQuery) {
          const all = this.filePath ? passageSearchResults(results, query, results.length) : groupSearchResults(results, query, Number.MAX_SAFE_INTEGER);
          this.lastResults = all.slice(0, requested); this.mapResults = all;
          this.canLoadMore = all.length > requested || (results.length === rawLimit && rawLimit < 1000);
          this.updateSuggestions();
          window.setTimeout(() => { this.renderShowMore(); this.updateMap(); }, 0); this.applyLens();
        }
      } catch (error) { if (error?.name !== 'AbortError') this.plugin.reportOnce(error.message); }
    }, immediate ? 0 : 75);
  }
  commitLensResults(results, version) {
    if (version !== this.lensVersion || !this.lastQuery) return; const requested = Math.max(this.visibleLimit || activeTweaks(this.plugin).topK, activeTweaks(this.plugin).topK); this.lastResults = results.slice(0, requested); this.updateSuggestions(); window.setTimeout(() => { this.renderShowMore(); this.updateMap(); }, 0);
  }
  async applyLens() {
    const version = ++this.lensVersion, lens = this.lens, query = this.lastQuery, source = this.mapResults.map(result => ({ ...result, lensLabel: '', lensScore: Number(result.score || 0), facet: undefined, contextScore: undefined })); this.lensRelationships = new Map(); this.lensRelationshipEdges = []; if (!query || !source.length) return;
    this.lensSelect?.toggleClass('is-working', true);
    try {
      const files = source.map(result => result.file);
      if (lens === 'relevance') {
        const facets = await this.plugin.search.conceptFacets(query, files); if (version !== this.lensVersion) return; for (const result of source) { const info = facets.get(result.file); result.facet = info?.facet; result.conceptAffinities = info?.affinities; result.lensLabel = info?.confidence >= .44 ? info.label : ''; } return this.commitLensResults(source, version);
      }
      if (lens === 'context') {
        const context = this.plugin.search.contextScores(files); for (const result of source) { result.contextScore = Number(context.get(result.file) || 0); result.lensScore = Number(result.score || 0) * .62 + result.contextScore * .38; result.lensLabel = 'Vault context'; } source.sort((a, b) => b.lensScore - a.lensScore || b.score - a.score); return this.commitLensResults(source, version);
      }
      for (const result of source) result.lensLabel = 'Position'; this.commitLensResults(source, version); if (!this.plugin.settings.graphRelationshipIntelligence || source.length < 2) return;
      await new Promise(resolve => window.setTimeout(resolve, 180)); if (version !== this.lensVersion) return; const candidates = source.slice(0, Math.min(source.length, Math.max(this.visibleLimit || 10, 10))), candidateByFile = new Map(candidates.map(result => [result.file, result])), edges = this.plugin.search.argumentCandidateEdges(candidates.map(result => result.file)).map(edge => ({ ...edge, sourceEvidence: argumentEvidenceText(candidateByFile.get(edge.source)), targetEvidence: argumentEvidenceText(candidateByFile.get(edge.target)) })), budget = this.plugin.isMobile ? this.plugin.settings.graphRelationshipBudgetMobile : this.plugin.settings.graphRelationshipBudgetDesktop; this.map?.setIntelligenceStatus('Comparing positions…'); const details = await this.plugin.search.graphRelationships(edges, budget); if (version !== this.lensVersion) return; this.lensRelationships = details; this.lensRelationshipEdges = edges; const counts = new Map(candidates.map(result => [result.file, { support: 0, contrast: 0 }])), strongest = new Map(); for (const edge of edges) { const relation = details.get(mapEdgeKey(edge.source, edge.target)); if (!relation || relation.type === 'related') continue; const key = relation.type === 'contrast' ? 'contrast' : 'support'; counts.get(edge.source)[key]++; counts.get(edge.target)[key]++; for (const [file, counterpart] of [[edge.source, edge.target], [edge.target, edge.source]]) { const score = Number(relation.confidence || 0) + (relation.type === 'contrast' ? .025 : 0), previous = strongest.get(file); if (previous && previous.score >= score) continue; const ownResult = candidateByFile.get(file), counterpartResult = candidateByFile.get(counterpart); strongest.set(file, { score, type: relation.type, counterpart, counterpartName: counterpart.replace(/\.md$/i, '').split('/').pop(), ownText: relation.evidence?.[file] || argumentEvidenceText(ownResult), counterpartText: relation.evidence?.[counterpart] || argumentEvidenceText(counterpartResult), ownHighlights: ownResult?.snippets?.[0]?.semanticHighlights || [], counterpartHighlights: counterpartResult?.snippets?.[0]?.semanticHighlights || [] }); } } for (const result of source) { const count = counts.get(result.file), evidence = strongest.get(result.file); result.lensLabel = !count ? 'Position' : count.contrast && count.support ? 'Mixed position' : count.contrast ? `${count.contrast} tension${count.contrast === 1 ? '' : 's'}` : count.support ? `${count.support} alignment${count.support === 1 ? '' : 's'}` : 'Position'; result.argumentEvidence = evidence; } this.commitLensResults(source, version); this.map?.setIntelligenceStatus('');
    } catch (error) { if (version === this.lensVersion) { this.plugin.logDiagnostic(`Search lens failed: ${error.message}`, true); this.commitLensResults(source, version); this.map?.setIntelligenceStatus(''); } }
    finally { if (version === this.lensVersion) this.lensSelect?.removeClass('is-working'); }
  }
  renderShowMore() {
    this.modalEl.querySelector('.gib-show-more')?.remove();
    if (!this.canLoadMore || !this.lastQuery) return;
    const resultsEl = this.resultContainerEl || this.modalEl.querySelector('.prompt-results');
    if (!resultsEl) return;
    const footer = resultsEl.createDiv({ cls: 'gib-show-more' });
    const button = footer.createEl('button', { text: 'Show 10 more results' });
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); button.disabled = true; button.textContent = 'Loading…'; this.visibleLimit += 10; this.triggerSearch(this.lastQuery, true); });
  }
  resolveSnippetImage(references, sourcePath) {
    for (const reference of references || []) {
      let target = String(reference.target || '').trim(); if (!target) continue;
      if (/^\/\//.test(target)) target = `https:${target}`;
      if (/^https?:\/\//i.test(target)) {
        if (this.plugin.settings.allowExternalImageThumbnails) return { src: target, alt: reference.alt || 'External image', external: true };
        continue;
      }
      if (/^(?:data|javascript):/i.test(target)) continue;
      target = target.split('#')[0].split('?')[0]; try { target = decodeURIComponent(target); } catch {}
      const file = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
      if (!(file instanceof TFile) || !IMAGE_EXTENSION.test(file.path)) continue;
      return { src: this.app.vault.getResourcePath(file), alt: reference.alt || file.basename, file, external: false };
    }
    return null;
  }
  renderSuggestion(result, el) {
    el.dataset.gibFile = result.file; el.addEventListener('pointerenter', () => this.map?.setHover(result.file)); el.addEventListener('pointerleave', () => this.map?.setHover(null));
    const pathParts = result.file.replace(/\.md$/i, '').split('/'); const fileName = pathParts.pop() || result.file.replace(/\.md$/i, '');
    const container = el.createDiv({ cls: 'gib-semantic-result' });
    const meta = container.createDiv({ cls: 'gib-semantic-result-meta' }); const folder = meta.createDiv({ cls: 'gib-semantic-result-folder' });
    (pathParts.length ? pathParts : ['Vault']).forEach((part, index) => { if (index) folder.createSpan({ cls: 'gib-semantic-result-folder-separator', text: '/' }); folder.createSpan({ text: part }); });
    if (result.lensLabel) meta.createSpan({ cls: 'gib-semantic-result-lens', text: result.lensLabel });
    const header = container.createDiv({ cls: 'gib-semantic-result-header' });
    const icon = header.createSpan({ cls: 'gib-semantic-result-icon' }); setIcon(icon, 'sticky-note');
    const fileTitle = header.createSpan({ cls: 'gib-semantic-result-file' }); renderHighlighted(fileTitle, fileName, this.lastQuery, result.filenameHighlights);
    const displayedScore = Number(result.lensScore ?? result.score ?? 0), score = header.createSpan({ cls: 'gib-semantic-result-score', text: `${(displayedScore * 100).toFixed(0)}%` });
    const semantic = Math.round(Number(result.semanticScore || 0) * 100), filename = Math.round(Number(result.filenameBoost || 0) * 100), folderBoost = Math.round(Number(result.folderPathBoost || 0) * 100);
    score.setAttribute('title', `${SEARCH_LENSES[this.lens].label} score: ${(displayedScore * 100).toFixed(0)}% · Semantic: ${semantic}% · Filename: +${filename} · Folder: +${folderBoost}`);
    const snippets = container.createDiv({ cls: 'gib-semantic-snippets' });
    if (this.lens === 'arguments' && result.argumentEvidence) {
      const evidence = result.argumentEvidence, block = snippets.createDiv({ cls: `gib-semantic-snippet gib-semantic-argument-evidence is-${evidence.type}` }), heading = block.createDiv({ cls: 'gib-semantic-result-heading gib-semantic-argument-heading' }); heading.createSpan({ text: evidence.type === 'contrast' ? 'Tension with ' : 'Aligns with ' }); heading.createSpan({ cls: 'gib-semantic-argument-note', text: evidence.counterpartName }); const own = block.createDiv({ cls: 'gib-semantic-result-preview gib-semantic-argument-own' }); renderHighlighted(own, evidence.ownText, this.lastQuery, evidence.ownHighlights); const compared = block.createDiv({ cls: 'gib-semantic-argument-compared' }); compared.createDiv({ cls: 'gib-semantic-argument-compared-label', text: 'Compared passage' }); const counterpart = compared.createDiv({ cls: 'gib-semantic-result-preview' }); renderHighlighted(counterpart, evidence.counterpartText, this.lastQuery, evidence.counterpartHighlights); return;
    }
    result.snippets.forEach((snippet, index) => {
      const block = snippets.createDiv({ cls: 'gib-semantic-snippet' });
      if (snippet.heading) { const heading = block.createDiv({ cls: 'gib-semantic-result-heading' }); renderHighlighted(heading, snippet.heading, this.lastQuery, snippet.headingHighlights); }
      const content = block.createDiv({ cls: 'gib-semantic-snippet-content' });
      const image = this.resolveSnippetImage(snippet.imageReferences, result.file);
      if (image) {
        const thumbnail = content.createEl('img', { cls: 'gib-semantic-snippet-thumbnail', attr: { src: image.src, alt: image.alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' } });
        thumbnail.addEventListener('error', () => thumbnail.remove());
        thumbnail.addEventListener('mousedown', event => event.stopPropagation());
        thumbnail.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (image.external) window.open(image.src, '_blank', 'noopener,noreferrer'); else this.app.workspace.getLeaf('tab').openFile(image.file); });
      }
      const preview = content.createDiv({ cls: 'gib-semantic-result-preview' }); renderHighlighted(preview, snippet.text, this.lastQuery, snippet.semanticHighlights);
      if (index < result.snippets.length - 1) snippets.createDiv({ cls: 'gib-semantic-snippet-divider' });
    });
  }
  async onChooseSuggestion(result) {
    const file = this.app.vault.getAbstractFileByPath(result.file);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(); await leaf.openFile(file);
    const best = result.snippets[0];
    if (Number(best?.lineStart) > 0) setTimeout(() => { const editor = leaf.view?.editor; if (!editor?.setCursor) return; editor.setCursor({ line: best.lineStart, ch: 0 }); editor.scrollIntoView({ from: { line: best.lineStart, ch: 0 }, to: { line: best.lineEnd || best.lineStart, ch: 0 } }, true); }, 100);
  }
  onOpen() {
    super.onOpen();
    this.setupMap();
    this.navigationHandler = event => {
      if (event.key === 'Tab') {
        event.preventDefault(); event.stopImmediatePropagation();
        this.inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: event.shiftKey ? 'ArrowUp' : 'ArrowDown', code: event.shiftKey ? 'ArrowUp' : 'ArrowDown', bubbles: true }));
      }
    };
    this.modalEl.addEventListener('keydown', this.navigationHandler, true);
  }
  onClose() {
    clearTimeout(this.debounceTimer); this.searchVersion++; this.lensVersion++;
    if (this.navigationHandler) this.modalEl.removeEventListener('keydown', this.navigationHandler, true);
    this.map?.destroy(); this.map = null; this.selectionObserver?.disconnect();
    super.onClose();
  }
  setupMap() {
    if (this.filePath) return; this.modalEl.addClass('gib-search-modal'); const suggestions = this.resultContainerEl || this.modalEl.querySelector('.prompt-results'); if (!suggestions?.parentElement) return;
    const shell = document.createElement('div'); shell.className = 'gib-search-results-shell'; suggestions.parentElement.insertBefore(shell, suggestions); shell.appendChild(suggestions); const panel = shell.createDiv({ cls: 'gib-search-map-panel' });
    const inputContainer = this.modalEl.querySelector('.prompt-input-container') || this.inputEl.parentElement; this.lensSelect = inputContainer?.createEl('select', { cls: 'dropdown gib-search-lens-select', attr: { 'aria-label': 'Search lens', title: SEARCH_LENSES[this.lens].description } }); if (this.lensSelect) { for (const [value, lens] of Object.entries(SEARCH_LENSES)) this.lensSelect.createEl('option', { text: lens.label, attr: { value } }); this.lensSelect.value = this.lens; this.lensSelect.addEventListener('change', () => { this.lens = validSearchLens(this.lensSelect.value); this.lensSelect.title = SEARCH_LENSES[this.lens].description; this.applyLens(); }); }
    this.mapToggle = inputContainer?.createEl('button', { cls: 'gib-search-map-toggle', attr: { type: 'button', 'aria-label': 'Toggle semantic map', title: 'Toggle semantic map' } }); if (this.mapToggle) { const mapIcon = this.mapToggle.createSpan({ cls: 'gib-search-map-toggle-icon' }); setIcon(mapIcon, 'map'); this.mapToggle.createSpan({ text: 'Map' }); this.mapToggle.addEventListener('mousedown', event => event.preventDefault()); this.mapToggle.addEventListener('click', async event => { event.preventDefault(); event.stopPropagation(); this.plugin.settings.searchMapEnabled = !this.plugin.settings.searchMapEnabled; await this.plugin.save(); this.applyMapState(); }); }
    this.map = new LivingSemanticMapCanvas(panel, this.app, { title: 'Search map', generations: this.mapGenerations, magicGraph: this.plugin.settings.magicGraphEnabled, semanticColors: this.plugin.settings.graphSemanticColors, onGenerations: async value => { this.mapGenerations = value; this.plugin.settings.searchMapGenerations = value; await this.plugin.save(); this.updateMap(); }, onHover: file => this.hoverResult(file), onSelect: file => this.focusResult(file), onOpen: file => this.openFile(file), onExplore: file => { this.close(); this.plugin.openNeighborhood(file, true); } });
    this.selectionObserver = new MutationObserver(mutations => { const selectionChanged = mutations.some(mutation => { const wasSelected = String(mutation.oldValue || '').split(/\s+/).includes('is-selected'), isSelected = mutation.target.classList?.contains('is-selected'); return wasSelected !== isSelected; }); if (!selectionChanged) return; const selected = suggestions.querySelector('.suggestion-item.is-selected')?.dataset.gibFile; this.map?.setHover(selected || null); }); this.selectionObserver.observe(suggestions, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] }); this.applyMapState();
  }
  applyMapState() { const enabled = Boolean(this.plugin.settings.searchMapEnabled); this.modalEl.toggleClass('is-map-visible', enabled); this.mapToggle?.toggleClass('is-active', enabled); this.mapToggle?.setAttribute('aria-pressed', String(enabled)); this.mapToggle?.setAttribute('title', enabled ? 'Hide semantic map' : 'Show semantic map'); if (enabled) this.updateMap(); }
  async updateMap() {
    if (!this.map || !this.plugin.settings.searchMapEnabled) return; const version = ++this.mapVersion, query = this.lastQuery, results = this.lastResults.slice(0, 80); this.map.setTitle(`${SEARCH_LENSES[this.lens].label} map`);
    const indexable = this.app.vault.getFiles().filter(file => /\.(?:md|txt|markdown)$/i.test(file.path)), paths = indexable.map(file => file.path), sizes = indexable.map(file => Math.log1p(Number(file.stat?.size || 0))), sizeLow = sizes.length ? Math.min(...sizes) : 0, sizeHigh = sizes.length ? Math.max(...sizes) : 1, sizeSpread = Math.max(.001, sizeHigh - sizeLow), fileScale = new Map(indexable.map(file => [file.path, (Math.log1p(Number(file.stat?.size || 0)) - sizeLow) / sizeSpread]));
    const roots = results.map(result => result.file), generations = query ? this.plugin.search.semanticGenerations(roots, this.mapGenerations, 5) : { nodes: [], edges: [] }, generationByFile = new Map(generations.nodes.map(node => [node.id, node])), activeFiles = generations.nodes.map(node => node.id), graph = await this.plugin.search.semanticStarfield(query, query ? activeFiles : paths, activeFiles); if (version !== this.mapVersion) return; const byFile = new Map(results.map(result => [result.file, result])), rankingScores = results.map(result => Number(result.lensScore ?? result.score ?? 0)), rankingLow = rankingScores.length ? Math.min(...rankingScores) : 0, rankingHigh = rankingScores.length ? Math.max(...rankingScores) : 1, rankingSpread = Math.max(.001, rankingHigh - rankingLow), semanticScores = graph.nodes.map(node => Number(node.semanticScore || 0)), semanticLow = semanticScores.length ? Math.min(...semanticScores) : 0, semanticHigh = semanticScores.length ? Math.max(...semanticScores) : 1, semanticSpread = Math.max(.001, semanticHigh - semanticLow), expansionEdges = generations.edges.map(edge => ({ ...edge, residualScore: 0 })), edgeKeys = new Set((graph.edges || []).map(edge => mapEdgeKey(edge.source, edge.target))), combinedEdges = [...(graph.edges || []), ...expansionEdges.filter(edge => !edgeKeys.has(mapEdgeKey(edge.source, edge.target)))];
    const graphNodes = graph.nodes.map(node => { const result = byFile.get(node.id), generation = generationByFile.get(node.id), semanticRelevance = (Number(node.semanticScore || 0) - semanticLow) / semanticSpread, rankedRelevance = result ? (Number(result.lensScore ?? result.score ?? 0) - rankingLow) / rankingSpread : 0, expandedRelevance = generation && generation.generation > 1 ? Math.max(.22, Math.min(.62, Number(generation.relationScore || 0))) : semanticRelevance; return { ...node, generation: generation?.generation || 1, parent: generation?.parent || null, matched: Boolean(generation), relevance: query ? (result ? .08 + rankedRelevance * .92 : expandedRelevance) : semanticRelevance, fileScale: fileScale.get(node.id) ?? .35, facet: result?.facet, conceptAffinities: result?.conceptAffinities, contextScore: result?.contextScore }; }), layoutOptions = { magic: this.plugin.settings.magicGraphEnabled, lens: this.lens }, initialLayout = await this.plugin.search.multiRelationalLayout(query, graphNodes, this.lens === 'arguments' ? this.lensRelationships : new Map(), layoutOptions); if (version !== this.mapVersion) return; for (const node of graphNodes) { const target = initialLayout.get(node.id); if (target) { node.layoutX = target.x; node.layoutY = target.y; } }
    const displayEdges = this.lens === 'arguments' ? [...combinedEdges.map(edge => ({ ...edge, relation: this.lensRelationships.get(mapEdgeKey(edge.source, edge.target)) })), ...this.lensRelationshipEdges.filter(edge => !edgeKeys.has(mapEdgeKey(edge.source, edge.target))).map(edge => ({ ...edge, relation: this.lensRelationships.get(mapEdgeKey(edge.source, edge.target)) }))] : combinedEdges; this.map.setGraph({ label: query || 'Search', hasQuery: Boolean(query), resultCount: results.length }, graphNodes, displayEdges);
  }
  hoverResult(file) { for (const item of this.modalEl.querySelectorAll('.suggestion-item.is-map-hovered')) item.removeClass('is-map-hovered'); if (!file) return; const escaped = globalThis.CSS?.escape ? CSS.escape(file) : file.replace(/["\\]/g, '\\$&'); const item = this.modalEl.querySelector(`.suggestion-item[data-gib-file="${escaped}"]`); item?.addClass('is-map-hovered'); item?.scrollIntoView({ block: 'nearest' }); }
  focusResult(file) { const index = this.lastResults.findIndex(result => result.file === file); if (index < 0) return; if (this.chooser?.setSelectedItem) this.chooser.setSelectedItem(index, true); else { const items = [...this.modalEl.querySelectorAll('.suggestion-item')]; items.forEach(item => item.removeClass('is-selected')); items[index]?.addClass('is-selected'); items[index]?.scrollIntoView({ block: 'nearest' }); } }
  async openFile(filePath) { const file = this.app.vault.getAbstractFileByPath(filePath); if (file instanceof TFile) { this.close(); await this.app.workspace.getLeaf(false).openFile(file); } }
}

class SemanticInNoteSearch {
  constructor(app, plugin, activeEditor) {
    this.app = app; this.plugin = plugin; this.view = activeEditor; this.editor = activeEditor.editor; this.file = activeEditor.file; this.matches = []; this.current = -1; this.timer = null; this.queryVersion = 0; this.highlightName = 'gib-search-semantic-find';
  }
  open() {
    this.plugin.activeInNoteSearch?.close(); this.plugin.activeInNoteSearch = this;
    const container = this.view.containerEl || this.app.workspace.activeLeaf?.view?.containerEl;
    const host = container?.querySelector('.markdown-source-view') || this.view.contentEl || container?.querySelector('.view-content') || container;
    if (!host) { this.plugin.activeInNoteSearch = null; new Notice('Gib Search could not attach to the active editor'); return; }
    this.host = host; this.host.addClass('gib-in-note-find-host'); this.isButter = this.host.matches('.butter-editor-view') || Boolean(this.host.querySelector('.ProseMirror'));
    this.el = this.host.createDiv({ cls: 'gib-in-note-find' });
    this.input = this.el.createEl('input', { type: 'search', placeholder: 'Find by meaning…', attr: { 'aria-label': 'Semantic search in note' } });
    this.count = this.el.createSpan({ cls: 'gib-in-note-find-count', text: '0/0' });
    const previous = this.el.createEl('button', { attr: { type: 'button', 'aria-label': 'Previous match', title: 'Previous match (Shift+Enter)' } }); setIcon(previous, 'chevron-up');
    const next = this.el.createEl('button', { attr: { type: 'button', 'aria-label': 'Next match', title: 'Next match (Enter)' } }); setIcon(next, 'chevron-down');
    const close = this.el.createEl('button', { attr: { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' } }); setIcon(close, 'x');
    previous.addEventListener('click', () => this.move(-1)); next.addEventListener('click', () => this.move(1)); close.addEventListener('click', () => this.close());
    this.input.addEventListener('input', () => { this.queryVersion++; clearTimeout(this.timer); this.timer = window.setTimeout(() => this.search(this.input.value.trim()), 250); });
    this.input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); this.move(event.shiftKey ? -1 : 1); } else if (event.key === 'Escape') { event.preventDefault(); this.close(); } });
    this.leafChangeRef = this.app.workspace.on('active-leaf-change', () => { if (this.app.workspace.activeEditor?.editor !== this.editor) this.close(); });
    this.editorChangeRef = this.app.workspace.on('editor-change', editor => { if (editor !== this.editor || !this.input.value.trim()) return; clearTimeout(this.timer); this.timer = window.setTimeout(() => this.search(this.input.value.trim()), 350); });
    this.observer = new MutationObserver(() => { clearTimeout(this.paintTimer); this.paintTimer = window.setTimeout(() => this.paintHighlights(), 40); });
    const content = this.host.querySelector('.cm-content, .ProseMirror'); if (content) this.observer.observe(content, { childList: true, subtree: true, characterData: true });
    this.input.focus();
  }
  compactPhrases(results, query, source) {
    const candidates = [query, ...queryTerms(query), ...semanticPhrasePool(results)].map(cleanSourceText).filter(Boolean).filter(phrase => phrase.length >= 3 && phrase.length <= 60 && phrase.split(/\s+/).length <= 3);
    const unique = [...new Set(candidates.map(phrase => phrase.toLowerCase()))].sort((a, b) => b.length - a.length); this.highlightPhrases = unique;
    const occupied = []; const matches = [];
    for (const phrase of unique) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
      for (const match of source.matchAll(regex)) { const from = match.index, to = from + match[0].length; if (occupied.some(range => from < range.to && to > range.from)) continue; occupied.push({ from, to }); matches.push({ from, to, text: match[0] }); }
    }
    return matches.sort((a, b) => a.from - b.from);
  }
  async search(query) {
    const version = ++this.queryVersion;
    if (query.length < 2) { this.matches = []; this.current = -1; this.updateCount(); this.clearHighlights(); return; }
    try {
      const tweaks = activeTweaks(this.plugin);
      const options = { scoreWindow: 1, semanticHighlights: true, resultMinScore: tweaks.highlightResultMinScore, singleWordMinScore: tweaks.highlightSingleWordMinScore, phraseMinScore: tweaks.highlightPhraseMinScore, maxPhrases: 5, file: this.file.path };
      const results = await this.plugin.search.search(query, 250, 0, options);
      if (version !== this.queryVersion || !this.el?.isConnected) return;
      const source = this.isButter || typeof this.editor?.getValue !== 'function' ? await this.app.vault.cachedRead(this.file) : this.editor.getValue();
      if (version !== this.queryVersion || !this.el?.isConnected) return;
      this.matches = this.compactPhrases(results, query, source); this.current = this.matches.length ? 0 : -1; this.paintHighlights(); this.updateCount();
      if (this.current >= 0) this.revealCurrent();
    } catch (error) { if (version === this.queryVersion) { this.matches = []; this.current = -1; this.updateCount(); this.plugin.reportOnce(error.message); } }
  }
  offsetToPos(offset) {
    if (typeof this.editor?.offsetToPos === 'function') return this.editor.offsetToPos(offset);
    const value = typeof this.editor?.getValue === 'function' ? this.editor.getValue() : ''; const before = value.slice(0, offset).split('\n'); return { line: before.length - 1, ch: before[before.length - 1].length };
  }
  move(delta) {
    if (!this.matches.length) return;
    this.current = (this.current + delta + this.matches.length) % this.matches.length; this.updateCount(); this.revealCurrent();
  }
  revealCurrent() {
    const match = this.matches[this.current]; if (!match) return;
    if (match.range) {
      const element = match.range.startContainer.parentElement; element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (globalThis.CSS?.highlights && typeof globalThis.Highlight === 'function') CSS.highlights.set(`${this.highlightName}-current`, new Highlight(match.range));
      return;
    }
    const from = this.offsetToPos(match.from), to = this.offsetToPos(match.to);
    if (typeof this.editor?.setSelection === 'function') this.editor.setSelection(from, to);
    if (typeof this.editor?.scrollIntoView === 'function') this.editor.scrollIntoView({ from, to }, true);
    window.setTimeout(() => this.paintHighlights(), 60);
  }
  updateCount() { if (this.count) this.count.setText(this.matches.length ? `${this.current + 1}/${this.matches.length}` : '0/0'); }
  paintHighlights() {
    if (!globalThis.CSS?.highlights || typeof globalThis.Highlight !== 'function' || !this.el?.isConnected) return;
    const root = this.host?.querySelector('.cm-content, .ProseMirror'); if (!root) return;
    const phrases = this.highlightPhrases || []; const ranges = [], domMatches = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || ''; if (!value.trim()) continue;
      const nodeMatches = [];
      for (const phrase of phrases) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
        for (const match of value.matchAll(regex)) { const from = match.index, to = from + match[0].length; if (!nodeMatches.some(item => from < item.to && to > item.from)) nodeMatches.push({ from, to, text: match[0] }); }
      }
      nodeMatches.sort((a, b) => a.from - b.from);
      for (const match of nodeMatches) { const range = new Range(); range.setStart(node, match.from); range.setEnd(node, match.to); ranges.push(range); domMatches.push({ range, text: match.text }); }
    }
    CSS.highlights.set(this.highlightName, new Highlight(...ranges));
    if (this.isButter) { const previous = this.current; this.matches = domMatches; this.current = domMatches.length ? Math.max(0, Math.min(previous < 0 ? 0 : previous, domMatches.length - 1)) : -1; this.updateCount(); const current = this.matches[this.current]; if (current?.range) CSS.highlights.set(`${this.highlightName}-current`, new Highlight(current.range)); }
  }
  clearHighlights() { globalThis.CSS?.highlights?.delete(this.highlightName); globalThis.CSS?.highlights?.delete(`${this.highlightName}-current`); }
  close() {
    clearTimeout(this.timer); clearTimeout(this.paintTimer); this.queryVersion++; this.observer?.disconnect(); if (this.leafChangeRef) this.app.workspace.offref(this.leafChangeRef); if (this.editorChangeRef) this.app.workspace.offref(this.editorChangeRef); this.clearHighlights(); this.el?.remove(); this.host?.removeClass('gib-in-note-find-host'); if (this.plugin.activeInNoteSearch === this) this.plugin.activeInNoteSearch = null; if (typeof this.editor?.focus === 'function') this.editor.focus();
  }
}

class NeighborhoodView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.filePath = null; this.pinned = false; this.loadVersion = 0; this.lens = validSearchLens(plugin.settings.defaultSearchLens); }
  getViewType() { return NEIGHBORHOOD_VIEW; }
  getDisplayText() { return 'Note neighborhood'; }
  getIcon() { return 'orbit'; }
  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass('gib-neighborhood-view'); const toolbar = this.contentEl.createDiv({ cls: 'gib-neighborhood-toolbar' }); const heading = toolbar.createDiv({ cls: 'gib-neighborhood-heading' }); heading.createDiv({ cls: 'gib-neighborhood-kicker', text: 'Gib Search' }); this.noteTitle = heading.createDiv({ cls: 'gib-neighborhood-note', text: 'Note neighborhood' }); this.lensSelect = toolbar.createEl('select', { cls: 'dropdown gib-neighborhood-lens', attr: { 'aria-label': 'Local note lens', title: 'Local note lens' } }); for (const [value, lens] of Object.entries(SEARCH_LENSES)) this.lensSelect.createEl('option', { text: lens.label, attr: { value } }); this.lensSelect.value = this.lens; this.lensSelect.addEventListener('change', () => { this.lens = validSearchLens(this.lensSelect.value); if (this.filePath) this.centerOn(this.filePath); });
    this.pinButton = toolbar.createEl('button', { cls: 'gib-neighborhood-pin', attr: { type: 'button', 'aria-label': 'Pin current note', title: 'Pin current note' } }); setIcon(this.pinButton, 'pin'); this.pinButton.addEventListener('click', () => { this.pinned = !this.pinned; this.pinButton.toggleClass('is-active', this.pinned); this.pinButton.setAttribute('aria-pressed', String(this.pinned)); this.pinButton.setAttribute('title', this.pinned ? 'Follow active note' : 'Pin current note'); });
    const mapHost = this.contentEl.createDiv({ cls: 'gib-neighborhood-map' }); this.map = new LivingSemanticMapCanvas(mapHost, this.app, { title: 'Closest notes', onSelect: file => this.openFile(file), onOpen: file => this.openFile(file) });
    this.fileOpenRef = this.app.workspace.on('file-open', file => { if (!this.pinned && file instanceof TFile) this.centerOn(file.path); }); const active = this.app.workspace.getActiveFile(); if (active) await this.centerOn(active.path); else this.empty('Open a note to see its semantic neighborhood');
  }
  async centerOn(filePath, pin = this.pinned) {
    const file = this.app.vault.getAbstractFileByPath(filePath); if (!(file instanceof TFile)) return; this.filePath = file.path; this.pinned = Boolean(pin); this.pinButton?.toggleClass('is-active', this.pinned); this.pinButton?.setAttribute('aria-pressed', String(this.pinned)); this.pinButton?.setAttribute('title', this.pinned ? 'Follow active note' : 'Pin current note'); this.noteTitle.textContent = file.basename; const version = ++this.loadVersion;
    try { const graph = this.plugin.search.semanticNeighbors(file.path, 18); if (version !== this.loadVersion) return; let nodes = graph.nodes.map(node => ({ ...node, semanticScore: Number(node.score || 0) })), relationships = new Map(), edges = graph.edges, intelligenceMessage = '';
      if (this.lens === 'relevance') { const facets = this.plugin.search.conceptFacetsFromFile(file.path, nodes.map(node => node.id)); nodes = nodes.map(node => ({ ...node, facet: facets.get(node.id)?.facet, conceptAffinities: facets.get(node.id)?.affinities })); }
      if (this.lens === 'context') { const context = this.plugin.search.contextScores(nodes.map(node => node.id)); nodes = nodes.map(node => ({ ...node, contextScore: Number(context.get(node.id) || 0), score: Number(node.score || 0) * .62 + Number(context.get(node.id) || 0) * .38 })).sort((a, b) => b.score - a.score); }
      if (this.lens === 'arguments' && this.plugin.settings.graphRelationshipIntelligence) { const candidates = this.plugin.search.argumentCandidateEdges(nodes.map(node => node.id)), budget = this.plugin.isMobile ? this.plugin.settings.graphRelationshipBudgetMobile : this.plugin.settings.graphRelationshipBudgetDesktop; this.map.setIntelligenceStatus('Comparing positions…'); try { relationships = await this.plugin.search.graphRelationships(candidates, budget); if (version !== this.loadVersion) return; edges = candidates.map(edge => ({ ...edge, relation: relationships.get(mapEdgeKey(edge.source, edge.target)) })); } catch (error) { this.plugin.logDiagnostic(`Local position comparison failed: ${error.message}`, true); intelligenceMessage = 'Relationship model unavailable'; } }
      const scores = nodes.map(node => Number(node.score || 0)), low = scores.length ? Math.min(...scores) : 0, high = scores.length ? Math.max(...scores) : 1, spread = Math.max(.001, high - low); nodes = nodes.map(node => ({ ...node, relevance: (Number(node.score || 0) - low) / spread, matched: true, generation: 1 })); const layout = await this.plugin.search.multiRelationalLayout(file.basename, nodes, relationships, { lens: this.lens, magic: this.plugin.settings.magicGraphEnabled, centerFile: file.path }); if (version !== this.loadVersion) return; nodes = nodes.map(node => ({ ...node, layoutX: layout.get(node.id)?.x, layoutY: layout.get(node.id)?.y })); this.map.setTitle(`${SEARCH_LENSES[this.lens].label} · ${file.basename}`); this.map.setGraph({ id: file.path, label: file.basename, hasQuery: true, resultCount: nodes.length }, nodes, edges); this.map.setIntelligenceStatus(intelligenceMessage); }
    catch (error) { if (version === this.loadVersion) this.empty(error.message); }
  }
  empty(message) { this.map?.setTitle(message); this.map?.setGraph({ label: 'Note' }, [], []); }
  async openFile(filePath) { const file = this.app.vault.getAbstractFileByPath(filePath); if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file); }
  async onClose() { this.loadVersion++; if (this.fileOpenRef) this.app.workspace.offref(this.fileOpenRef); this.map?.destroy(); }
}

class GraphView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.nodes = []; this.edges = []; this.scores = null; this.resize = () => this.draw(); }
  getViewType() { return GRAPH_VIEW; }
  getDisplayText() { return 'Gib Search graph'; }
  getIcon() { return 'waypoints'; }
  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass('gib-graph-view');
    const toolbar = this.contentEl.createDiv({ cls: 'gib-graph-toolbar' });
    const input = toolbar.createEl('input', { type: 'search', placeholder: 'Highlight by meaning…' });
    const reset = toolbar.createEl('button', { text: 'Reset' });
    const status = toolbar.createSpan({ cls: 'gib-graph-status', text: 'Loading…' });
    this.canvas = this.contentEl.createEl('canvas', { cls: 'gib-graph-canvas' });
    this.canvas.addEventListener('click', event => this.openAt(event));
    let timer;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => { this.scores = input.value.trim() ? await this.plugin.search.scores(input.value.trim()) : null; this.draw(); }, 250); });
    reset.addEventListener('click', () => { input.value = ''; this.scores = null; this.draw(); });
    window.addEventListener('resize', this.resize);
    try { await this.loadGraph(); status.textContent = `${this.nodes.length} notes · ${this.edges.length} connections`; this.draw(); }
    catch (error) { status.textContent = error.message; }
  }
  async loadGraph() {
    const nodeMap = new Map(); const edges = []; const hard = new Set();
    const add = id => { if (!nodeMap.has(id)) nodeMap.set(id, { id, label: id.replace(/\.md$/i, '').split('/').pop() }); };
    if (this.plugin.settings.showWikilinks) for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks || {})) for (const [target, count] of Object.entries(targets)) if (count) { add(source); add(target); const key = [source, target].sort().join('\0'); hard.add(key); edges.push({ source, target, hard: true, score: 1 }); }
    const semantic = await this.plugin.search.graph(this.plugin.settings.graphK, this.plugin.settings.graphMaxEdges);
    for (const edge of semantic.edges || []) { const key = [edge.source, edge.target].sort().join('\0'); if (hard.has(key)) continue; add(edge.source); add(edge.target); edges.push({ source: edge.source, target: edge.target, score: edge.score, hard: false }); }
    this.nodes = [...nodeMap.values()]; this.edges = edges; this.layout(semantic.pcaPositions || {});
  }
  layout(pca) {
    const count = Math.max(this.nodes.length, 1);
    this.nodes.forEach((node, index) => {
      const pos = pca[node.id];
      if (Array.isArray(pos)) { node.x = (Number(pos[0]) + 1) / 2; node.y = (Number(pos[1]) + 1) / 2; }
      else { const angle = index * Math.PI * (3 - Math.sqrt(5)); const radius = Math.sqrt(index / count) * .46; node.x = .5 + Math.cos(angle) * radius; node.y = .5 + Math.sin(angle) * radius; }
    });
    this.byId = new Map(this.nodes.map(node => [node.id, node]));
  }
  draw() {
    if (!this.canvas) return; const rect = this.canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, rect.width * dpr); this.canvas.height = Math.max(1, rect.height * dpr);
    const ctx = this.canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);
    const pad = 45, w = Math.max(1, rect.width - pad * 2), h = Math.max(1, rect.height - pad * 2); const xy = n => [pad + n.x * w, pad + n.y * h];
    ctx.lineWidth = 1;
    for (const edge of this.edges) { const a = this.byId.get(edge.source), b = this.byId.get(edge.target); if (!a || !b) continue; const [ax, ay] = xy(a), [bx, by] = xy(b); ctx.beginPath(); if (!edge.hard) ctx.setLineDash([3, 4]); else ctx.setLineDash([]); ctx.strokeStyle = edge.hard ? 'rgba(140,150,170,.38)' : `rgba(123,97,255,${Math.max(.08, edge.score * .45)})`; ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    ctx.setLineDash([]); this.hit = [];
    for (const node of this.nodes) { const [x, y] = xy(node); const score = this.scores ? Number(this.scores[node.id] || 0) : 1; const alpha = this.scores ? Math.max(.08, score) : 1; const radius = 4 + Math.min(7, this.edges.filter(e => e.source === node.id || e.target === node.id).length / 3); ctx.globalAlpha = alpha; ctx.fillStyle = score > .55 && this.scores ? '#ffb347' : '#7b61ff'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); if (!this.scores || score > .2) { ctx.fillStyle = getComputedStyle(this.contentEl).color; ctx.font = '11px sans-serif'; ctx.fillText(node.label, x + radius + 3, y + 4); } this.hit.push({ node, x, y, radius: radius + 8 }); }
    ctx.globalAlpha = 1;
  }
  openAt(event) { const r = this.canvas.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top; const hit = this.hit?.find(h => Math.hypot(h.x - x, h.y - y) <= h.radius); if (hit) { const file = this.app.vault.getAbstractFileByPath(hit.node.id); if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file); } }
  async onClose() { window.removeEventListener('resize', this.resize); }
}

class SearchSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.timer = null; this.unsubscribe = null; this.busy = false; }
  display() {
    this.containerEl.empty(); this.containerEl.createEl('h2', { text: 'Gib Search' });
    new Setting(this.containerEl).setName('Status').setHeading();
    this.renderHealth();
    new Setting(this.containerEl).setName('Indexer').setHeading();
    new Setting(this.containerEl).setName('Semantic index').setDesc('Run the local embedding indexer and continuously watch the vault for note changes.').addToggle(t => t.setValue(this.plugin.settings.enabled).onChange(async value => { this.plugin.settings.enabled = value; await this.plugin.save(); value ? this.plugin.indexer.start() : this.plugin.indexer.stop(); this.refreshHealth(); }));
    new Setting(this.containerEl).setName('Index actions').setDesc('Start, pause, or restart local indexing. Pausing stops the current run without deleting completed work.').addButton(b => b.setButtonText('Start').onClick(() => this.retry(false))).addButton(b => b.setButtonText('Pause').onClick(() => { const stopped = this.plugin.indexer.stop(); new Notice(stopped ? 'Gib Search indexing paused' : this.plugin.indexer.lastEvent); this.refreshHealth(); })).addButton(b => b.setButtonText('Restart').setCta().onClick(() => this.retry(true)));
    new Setting(this.containerEl).setName('Diagnostics').setHeading();
    new Setting(this.containerEl).setName('Health check').setDesc('Refresh live health data or run a real semantic query against the index.').addButton(b => b.setButtonText('Refresh').onClick(() => this.refreshHealth(true))).addButton(b => b.setButtonText('Test search').onClick(async () => { if (this.busy) return; this.busy = true; b.setButtonText('Testing…').setDisabled(true); try { const results = await this.plugin.search.search('test', 1, 0); new Notice(`Semantic search is working (${results.length} result${results.length === 1 ? '' : 's'} returned)`); } catch (error) { new Notice(`Semantic search test failed: ${error.message}`, 8000); } finally { this.busy = false; b.setButtonText('Test search').setDisabled(false); this.refreshHealth(); } }));
    new Setting(this.containerEl).setName('Verbose diagnostic logging').setDesc('Record indexing lifecycle, every indexed note path, byte and chunk counts, embedding time, and errors. Note contents are not logged.').addToggle(t => t.setValue(this.plugin.settings.verboseLogging).onChange(async value => { this.plugin.settings.verboseLogging = value; await this.plugin.save(); await this.plugin.logDiagnostic(`Verbose logging ${value ? 'enabled' : 'disabled'}`, true); if (this.plugin.settings.enabled) this.plugin.indexer.restart(); new Notice(`Verbose logging ${value ? 'enabled; indexer restarting' : 'disabled'}`); }));
    new Setting(this.containerEl).setName('Diagnostic log').setDesc(this.plugin.diagnosticLogPath()).addButton(b => b.setButtonText('Copy path').onClick(async () => { await navigator.clipboard.writeText(this.plugin.diagnosticLogPath()); new Notice('Diagnostic log path copied'); })).addButton(b => b.setButtonText('Clear').setWarning().onClick(async () => { await this.plugin.clearDiagnosticLog(); new Notice('Diagnostic log cleared'); }));
    new Setting(this.containerEl).setName('Maintenance').setHeading();
    new Setting(this.containerEl).setName('Rebuild semantic index').setDesc('Clear generated vectors and metadata, then re-index every note. Vault notes and the local model are untouched.').addButton(b => b.setButtonText('Rebuild').setWarning().onClick(() => { if (!window.confirm('Rebuild the entire semantic index? Generated vectors will be replaced; vault notes are not changed.')) return; this.plugin.indexer.rebuild(); new Notice('Gib Search started a full index rebuild'); this.refreshHealth(); }));
    const tweaks = activeTweaks(this.plugin);
    new Setting(this.containerEl).setName('Tweaks').setHeading();
    new Setting(this.containerEl).setName('Minimum score').setDesc('Hide weak semantic matches (0–1).').addSlider(s => s.setLimits(0, 1, .01).setValue(tweaks.minScore).setDynamicTooltip().onChange(async value => { tweaks.minScore = value; await this.plugin.save(); }));
    new Setting(this.containerEl).setName('Score window').setDesc('Keep results within this distance of the strongest match. Smaller values filter ambiguous lower-ranked results.').addSlider(s => s.setLimits(.05, 1, .01).setValue(tweaks.scoreWindow).setDynamicTooltip().onChange(async value => { tweaks.scoreWindow = value; await this.plugin.save(); }));
    new Setting(this.containerEl).setName('Results').addSlider(s => s.setLimits(5, 50, 5).setValue(tweaks.topK).setDynamicTooltip().onChange(async value => { tweaks.topK = value; await this.plugin.save(); }));
    new Setting(this.containerEl).setName('Boost folder path matches').setDesc('Give notes a modest ranking boost when the query matches words in their folder path.').addToggle(t => t.setValue(this.plugin.settings.folderPathBoostEnabled).onChange(async value => { this.plugin.settings.folderPathBoostEnabled = value; await this.plugin.save(); }));
    new Setting(this.containerEl).setName('Load external image thumbnails').setDesc('Allow search results to request images from web URLs found in notes. Local vault images are always available. Disabled by default for privacy and performance.').addToggle(t => t.setValue(this.plugin.settings.allowExternalImageThumbnails).onChange(async value => { this.plugin.settings.allowExternalImageThumbnails = value; await this.plugin.save(); }));
    new Setting(this.containerEl).setName('Enable semantic highlighting').setDesc('Color compact concepts that the local model identifies as related to the query.').addToggle(t => t.setValue(tweaks.semanticHighlights).onChange(async value => { tweaks.semanticHighlights = value; await this.plugin.save(); this.display(); }));
    if (tweaks.semanticHighlights) {
      new Setting(this.containerEl).setName('Result confidence').setDesc('Only attribute phrases inside results at or above this similarity. Higher values reduce misleading highlights.').addSlider(s => s.setLimits(.4, .9, .01).setValue(tweaks.highlightResultMinScore).setDynamicTooltip().onChange(async value => { tweaks.highlightResultMinScore = value; await this.plugin.save(); }));
      new Setting(this.containerEl).setName('Single-word sensitivity').setDesc('Minimum similarity for a single highlighted concept. Higher is more conservative.').addSlider(s => s.setLimits(.4, .9, .01).setValue(tweaks.highlightSingleWordMinScore).setDynamicTooltip().onChange(async value => { tweaks.highlightSingleWordMinScore = value; await this.plugin.save(); }));
      new Setting(this.containerEl).setName('Phrase sensitivity').setDesc('Minimum similarity for highlighted two- or three-word phrases. Higher is more conservative.').addSlider(s => s.setLimits(.2, .8, .01).setValue(tweaks.highlightPhraseMinScore).setDynamicTooltip().onChange(async value => { tweaks.highlightPhraseMinScore = value; await this.plugin.save(); }));
      new Setting(this.containerEl).setName('Concepts per passage').setDesc('Maximum semantic concepts colored in each passage.').addSlider(s => s.setLimits(1, 5, 1).setValue(tweaks.highlightMaxPhrases).setDynamicTooltip().onChange(async value => { tweaks.highlightMaxPhrases = value; await this.plugin.save(); }));
    }
    new Setting(this.containerEl).setName('Graph').setHeading();
    new Setting(this.containerEl).setName('Default search lens').setDesc('Choose how new searches rank results and arrange the semantic map. You can switch lenses inside the search popup.').addDropdown(d => { for (const [value, lens] of Object.entries(SEARCH_LENSES)) d.addOption(value, lens.label); d.setValue(validSearchLens(this.plugin.settings.defaultSearchLens)).onChange(async value => { this.plugin.settings.defaultSearchLens = validSearchLens(value); await this.plugin.save(); }); });
    new Setting(this.containerEl).setName('Magic graph intelligence').setDesc('Combine topic direction, entities, communities, residual meaning, and relationships into a query-conditioned dimensional layout.').addToggle(t => t.setValue(this.plugin.settings.magicGraphEnabled).onChange(async value => { this.plugin.settings.magicGraphEnabled = value; await this.plugin.save(); }));
    new Setting(this.containerEl).setName('Semantic color compass').setDesc('Color notes by their direction on the vault-wide semantic compass. Similar directions share a hue.').addToggle(t => t.setValue(this.plugin.settings.graphSemanticColors).onChange(async value => { this.plugin.settings.graphSemanticColors = value; await this.plugin.save(); }));
    new Setting(this.containerEl).setName('Relationship intelligence').setDesc('Use a small local NLI model on only the strongest visible graph connections. The first use downloads it; results are cached locally.').addToggle(t => t.setValue(this.plugin.settings.graphRelationshipIntelligence).onChange(async value => { this.plugin.settings.graphRelationshipIntelligence = value; await this.plugin.save(); this.display(); }));
    if (this.plugin.settings.graphRelationshipIntelligence) new Setting(this.containerEl).setName(this.plugin.isMobile ? 'Mobile relationship budget' : 'Desktop relationship budget').setDesc('Maximum uncached visible connections classified per graph update. Cached connections are free.').addSlider(s => { const key = this.plugin.isMobile ? 'graphRelationshipBudgetMobile' : 'graphRelationshipBudgetDesktop'; s.setLimits(0, this.plugin.isMobile ? 12 : 30, 1).setValue(this.plugin.settings[key]).setDynamicTooltip().onChange(async value => { this.plugin.settings[key] = value; await this.plugin.save(); }); });
    new Setting(this.containerEl).setName('Include wikilinks in graph').addToggle(t => t.setValue(this.plugin.settings.showWikilinks).onChange(async value => { this.plugin.settings.showWikilinks = value; await this.plugin.save(); }));
    this.unsubscribe?.(); this.unsubscribe = this.plugin.indexer.onChange(() => this.refreshHealth());
    clearInterval(this.timer); this.timer = window.setInterval(() => this.refreshHealth(), 2000); this.refreshHealth();
  }
  renderHealth() {
    const status = new Setting(this.containerEl).setName('Indexer status');
    this.healthEl = status.settingEl; this.healthEl.addClass('gib-health-status-row');
    this.healthMessage = status.descEl.createDiv({ text: 'Reading index status' });
    this.healthGrid = status.descEl.createDiv({ cls: 'gib-health-inline' });
    this.healthProgress = status.descEl.createEl('progress', { cls: 'gib-health-progress' }); this.healthProgress.max = 100; this.healthProgress.value = 0;
    this.healthProgress.style.display = 'none'; this.healthEvent = status.descEl.createDiv({ cls: 'gib-health-event' });
    this.healthDot = status.controlEl.createSpan({ cls: 'gib-health-dot' }); this.healthTitle = status.controlEl.createSpan({ cls: 'gib-health-label', text: 'Checking…' });
    status.addButton(button => { this.retryButton = button; button.setButtonText('Retry').setCta().onClick(() => this.retry(true)); button.buttonEl.addClass('gib-health-retry'); button.buttonEl.style.display = 'none'; });
  }
  field(label, value) { this.healthFields.push(`${label}: ${value ?? '—'}`); }
  async refreshHealth(showNotice = false) {
    if (!this.healthEl?.isConnected) return;
    const local = this.plugin.search.workerStatus(); let remote = null; let error = '';
    try { remote = await this.plugin.search.health(); } catch (e) { error = e.message; }
    if (!this.healthEl?.isConnected) return;
    const phase = String(local.phase || 'offline'); const updatedAt = Number(local.updatedAt || 0); const statusAge = updatedAt ? Date.now() - updatedAt : Infinity;
    const stale = Number(remote?.staleFiles || 0); const healthy = phase === 'ready' && !remote?.isIndexing && stale === 0; const working = Boolean(remote?.isIndexing) || ['starting', 'loading_model', 'downloading_model', 'indexing'].includes(phase);
    const stoppedResponding = !remote && working && statusAge > 15000; const activelyWorking = working && !stoppedResponding;
    const state = healthy ? 'healthy' : activelyWorking ? 'working' : this.plugin.settings.enabled ? 'error' : 'disabled'; this.healthEl.dataset.state = state;
    this.healthTitle.textContent = healthy ? 'Healthy and watching your vault' : activelyWorking ? 'Indexing in progress' : this.plugin.settings.enabled ? 'Indexer needs attention' : 'Indexer disabled';
    this.healthMessage.textContent = healthy ? `The semantic index is current and note changes are being watched.${remote?.modelLoaded ? '' : ' The model will load when it is needed.'}` : stoppedResponding ? `The indexer stopped responding ${formatElapsed(statusAge)} ago. Retry will resume from the latest checkpoint.` : activelyWorking ? (local.message || this.plugin.indexer.lastEvent) : (this.plugin.indexer.lastError || error || local.message || 'The semantic index is unavailable');
    const total = Number(local.totalFiles || local.vaultFiles || remote?.vaultFiles || 0), done = Number(local.processedFiles ?? local.fileCount ?? local.indexedFiles ?? remote?.indexedFiles ?? 0);
    const elapsedFrom = Number(local.phaseStartedAt || local.startedAt || 0); const indexBytes = this.plugin.search.storageBytes?.() || 0; const modelBytes = this.plugin.runtime.storageBytes?.() || 0;
    this.healthFields = []; this.field('Phase', stoppedResponding ? 'stopped' : phase.replaceAll('_', ' ')); this.field('Progress', total ? `${done}/${total}` : 'Waiting'); this.field('Indexed', remote?.indexedFiles ?? local.indexedFiles ?? 0); this.field('Chunks', remote?.totalChunks ?? local.totalChunks ?? 0); this.field('Highlight phrases', remote?.highlightPhrases ?? local.highlightPhrases ?? 0); this.field('Graph entities', remote?.graphEntities ?? 0); this.field('Cached relationships', remote?.cachedRelationships ?? 0); const modelLabel = MODEL_PROFILES[remote?.modelProfile]?.label || remote?.modelId || 'Loaded'; this.field('Model', remote?.modelLoaded ? `${modelLabel} (${String(remote.modelBackend || 'WASM').toUpperCase()})` : healthy ? 'Loads on demand' : 'Not ready'); this.field('Relationship model', remote?.relationModelLoaded ? 'Loaded' : this.plugin.settings.graphRelationshipIntelligence ? 'Loads on demand' : 'Disabled'); this.field('Index size', formatBytes(indexBytes)); if (!this.plugin.isMobile) this.field('Model cache', formatBytes(modelBytes)); this.field('Last success', formatWhen(local.lastSuccessfulIndexAt)); if (activelyWorking && elapsedFrom) this.field('Elapsed', formatElapsed(Date.now() - elapsedFrom)); this.healthGrid.textContent = this.healthFields.join(' · ');
    if (activelyWorking && total > 0) { this.healthProgress.style.display = ''; this.healthProgress.value = Math.min(100, done / total * 100); } else this.healthProgress.style.display = 'none';
    this.healthEvent.textContent = local.currentFile ? `Current file: ${local.currentFile}` : local.relationMessage ? `Graph intelligence: ${local.relationMessage}` : `Latest activity: ${this.plugin.indexer.lastEvent}`;
    if (this.retryButton?.buttonEl) this.retryButton.buttonEl.style.display = state === 'error' ? '' : 'none';
    if (showNotice) new Notice(healthy ? 'Gib Search is healthy' : activelyWorking ? 'Gib Search is currently indexing' : `Gib Search health check failed: ${stoppedResponding ? 'indexer stopped responding' : error || local.message || 'index unavailable'}`);
  }
  async retry(restart) {
    if (this.busy) return; this.busy = true;
    try {
      if (!this.plugin.settings.enabled) { this.plugin.settings.enabled = true; await this.plugin.save(); }
      if (!this.plugin.isMobile && !this.plugin.runtime.ready()) await this.plugin.runtime.install();
      restart ? this.plugin.indexer.restart() : this.plugin.indexer.start();
      new Notice(restart ? 'Gib Search is restarting' : 'Gib Search is starting');
    } catch (error) {
      this.plugin.indexer.lastError = error.message; this.plugin.indexer.lastEvent = 'Could not start indexing'; this.plugin.indexer.changed();
      new Notice(`Gib Search could not start: ${error.message}`, 8000);
    } finally { this.busy = false; this.refreshHealth(); }
  }
  hide() { clearInterval(this.timer); this.timer = null; this.unsubscribe?.(); this.unsubscribe = null; }
}

module.exports = class GibSearch extends Plugin {
  async onload() {
    const loaded = await this.loadData() || {};
    this.settings = Object.assign({}, DEFAULTS, loaded); this.isMobile = Platform.isMobileApp;
    const legacyTweaks = Object.fromEntries(Object.keys(MODEL_TWEAK_DEFAULTS.bge).map(key => [key, loaded[key] ?? MODEL_TWEAK_DEFAULTS.bge[key]]));
    this.settings.modelTweaks = {
      bge: Object.assign({}, MODEL_TWEAK_DEFAULTS.bge, legacyTweaks, loaded.modelTweaks?.mobile || {}, loaded.modelTweaks?.bge || {}),
    };
    this.legacyModelsPath = loaded.modelsPath || ''; delete this.settings.embeddingModel; delete this.settings.modelsPath;
    delete this.settings.nodePath;
    if (!loaded.folderPathBoostSettingsMigrated) {
      this.settings.folderPathBoostEnabled = true;
      this.settings.folderPathBoostSettingsMigrated = true;
      await this.save();
    }
    if (!loaded.bgeOnlySettingsMigrated) {
      this.settings.bgeOnlySettingsMigrated = true;
      await this.save();
    }
    if (!loaded.topographicMapIntroduced) {
      this.settings.searchMapEnabled = !this.isMobile;
      this.settings.topographicMapIntroduced = true;
      await this.save();
    }
    this.lastError = '';
    this.embeddedWasmGzip = EMBEDDED_WASM_GZIP;
    this.embeddedWasmModuleGzip = EMBEDDED_WASM_MODULE_GZIP;
    if (!this.isMobile) {
      loadDesktopModules(); this.vaultPath = this.app.vault.adapter.basePath; this.pluginDir = path.join(this.vaultPath, this.app.vault.configDir, 'plugins', this.manifest.id); this.cacheRoot = desktopCacheRoot(); this.vaultCacheKey = vaultCacheKey(this.vaultPath); restoreDesktopData(this);
      this.modelDir = path.join(this.pluginDir, 'models'); this.modelCache = new FileModelCache(this.modelDir); this.desktopIndexStore = new DesktopIndexStore(activeIndexDir(this)); this.desktopEmbedder = new DesktopEmbedder(this);
    }
    this.search = this.indexer = new MobileSearchRuntime(this); this.runtime = { ready: () => true, install: async () => true, stop: () => this.desktopEmbedder?.stop(), storageBytes: () => this.isMobile ? 0 : directorySize(this.modelDir) }; this.indexer.watch();
    this.registerView(GRAPH_VIEW, leaf => new GraphView(leaf, this)); this.registerView(NEIGHBORHOOD_VIEW, leaf => new NeighborhoodView(leaf, this));
    this.addRibbonIcon('search', 'Gib Search', () => new SemanticSearchModal(this.app, this).open());
    this.addCommand({ id: 'semantic-search', name: 'Semantic search', callback: () => new SemanticSearchModal(this.app, this).open() });
    this.addCommand({ id: 'note-neighborhood', name: 'Open note neighborhood', callback: () => this.openNeighborhood(this.app.workspace.getActiveFile()?.path) });
    this.addCommand({ id: 'semantic-graph', name: 'Open semantic graph', callback: () => this.openGraph() });
    this.addSettingTab(new SearchSettings(this.app, this));
    this.logDiagnostic(`Gib Search ${this.manifest.version} loaded on ${this.isMobile ? 'mobile' : process.platform}`);
    this.indexer.start();
  }
  async save() { await this.saveData(this.settings); }
  diagnosticLogPath() { return this.isMobile ? `gib-search-diagnostics:${this.app.vault.getName()}` : path.join(this.pluginDir, 'logs', 'gib-search.log'); }
  async logDiagnostic(message, force = false) {
    if (!force && !this.settings.verboseLogging) return;
    const line = `[${new Date().toISOString()}] ${String(message).replace(/\r?\n/g, '\n')}\n`;
    try {
      if (this.isMobile) { const key = this.diagnosticLogPath(); localStorage.setItem(key, `${localStorage.getItem(key) || ''}${line}`.slice(-200000)); }
      else { fs.mkdirSync(path.dirname(this.diagnosticLogPath()), { recursive: true }); fs.appendFileSync(this.diagnosticLogPath(), line); }
    } catch {}
  }
  async clearDiagnosticLog() { try { if (this.isMobile) localStorage.removeItem(this.diagnosticLogPath()); else { fs.mkdirSync(path.dirname(this.diagnosticLogPath()), { recursive: true }); fs.writeFileSync(this.diagnosticLogPath(), ''); } } catch {} }
  reportOnce(message) { this.logDiagnostic(`Error: ${message}`, true); if (message !== this.lastError) { this.lastError = message; new Notice(`Gib Search: ${message}`); } }
  async openGraph() { let leaf = this.app.workspace.getLeavesOfType(GRAPH_VIEW)[0]; if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: GRAPH_VIEW, active: true }); } this.app.workspace.revealLeaf(leaf); }
  async openNeighborhood(filePath, pin = false) { let leaf = this.app.workspace.getLeavesOfType(NEIGHBORHOOD_VIEW)[0]; if (!leaf) { leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: NEIGHBORHOOD_VIEW, active: true }); } this.app.workspace.revealLeaf(leaf); if (filePath && leaf.view instanceof NeighborhoodView) await leaf.view.centerOn(filePath, pin); }
  onunload() { this.runtime?.stop(); this.indexer?.stop(); }
};
