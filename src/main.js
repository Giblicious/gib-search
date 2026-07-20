const { Plugin, PluginSettingTab, Setting, SuggestModal, ItemView, Notice, TFile, setIcon, Platform } = require('obsidian');
const { MobileSearchRuntime } = require('./mobile-runtime');
const EMBEDDED_WASM_GZIP = null;
const EMBEDDED_WASM_MODULE_GZIP = null;
let fs, path, os, crypto;
function loadDesktopModules() {
  if (fs) return;
  fs = require('fs'); path = require('path'); os = require('os'); crypto = require('crypto');
}

const GRAPH_VIEW = 'gib-search-graph';
const MODEL_PROFILES = {
  bge: { label: 'BGE Small English v1.5', indexFolder: 'bge-small-en-v1.5' },
};
const MODEL_TWEAK_DEFAULTS = {
  bge: { topK: 10, minScore: 0.5, scoreWindow: 0.14, folderPathBoost: 0.06, semanticHighlights: true, highlightResultMinScore: 0.55, highlightSingleWordMinScore: 0.62, highlightPhraseMinScore: 0.56, highlightMaxPhrases: 3 },
};
const DEFAULTS = { enabled: true, verboseLogging: false, allowExternalImageThumbnails: false, folderPathBoostEnabled: true, topK: 10, minScore: 0.5, semanticHighlights: true, highlightResultMinScore: 0.55, highlightSingleWordMinScore: 0.62, highlightPhraseMinScore: 0.56, highlightMaxPhrases: 3, graphK: 5, graphMaxEdges: 2000, showWikilinks: true };
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
    try { const meta = JSON.parse(await fs.promises.readFile(path.join(this.directory, 'index.meta.json'), 'utf8')); const data = await fs.promises.readFile(path.join(this.directory, 'index.vectors.bin')); let state = {}; try { state = JSON.parse(await fs.promises.readFile(path.join(this.directory, 'index.state.json'), 'utf8')); } catch {} return { meta, vectors: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), ...state }; } catch { return undefined; }
  }
  async put(value) {
    fs.mkdirSync(this.directory, { recursive: true });
    await fs.promises.writeFile(path.join(this.directory, 'index.meta.json'), JSON.stringify(value.meta)); await fs.promises.writeFile(path.join(this.directory, 'index.vectors.bin'), Buffer.from(value.vectors));
    await fs.promises.writeFile(path.join(this.directory, 'index.state.json'), JSON.stringify({ lastSuccessfulIndexAt: value.lastSuccessfulIndexAt || null }));
  }
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
function matchingSemanticPhrases(source, phrases) {
  const lower = String(source || '').toLowerCase();
  return phrases.filter(phrase => lower.includes(phrase.toLowerCase()));
}
function mergeSemanticPhrases(...lists) {
  const merged = [];
  for (const phrase of lists.flat()) if (phrase && !merged.some(existing => existing.toLowerCase() === phrase.toLowerCase())) merged.push(phrase);
  return merged;
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
  const sharedPhrases = semanticPhrasePool(results);
  const files = new Map();
  for (const hit of results) {
    let group = files.get(hit.file);
    const rankingScore = Number(hit.rankingScore ?? hit.score ?? 0);
    if (!group) { group = { file: hit.file, score: rankingScore, semanticScore: Number(hit.score || 0), filenameBoost: Number(hit.filenameBoost || 0), folderPathBoost: Number(hit.folderPathBoost || 0), snippets: [], filenameHighlights: [] }; files.set(hit.file, group); }
    if (rankingScore > group.score) { group.score = rankingScore; group.semanticScore = Number(hit.score || 0); group.filenameBoost = Number(hit.filenameBoost || 0); group.folderPathBoost = Number(hit.folderPathBoost || 0); }
    const semanticHighlights = mergeSemanticPhrases(matchingSemanticPhrases(hit.text, sharedPhrases), (hit.semanticHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean));
    const filenameHighlights = mergeSemanticPhrases(matchingSemanticPhrases(hit.file.replace(/\.md$/i, '').split('/').pop(), sharedPhrases), (hit.filenameHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean));
    const headingHighlights = mergeSemanticPhrases(matchingSemanticPhrases(hit.heading, sharedPhrases), (hit.headingHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean));
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
  const sharedPhrases = semanticPhrasePool(results);
  return results.slice(0, maximum).map(hit => { const semanticHighlights = mergeSemanticPhrases(matchingSemanticPhrases(hit.text, sharedPhrases), (hit.semanticHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean)); const filename = hit.file.replace(/\.md$/i, '').split('/').pop(); const filenameHighlights = mergeSemanticPhrases(matchingSemanticPhrases(filename, sharedPhrases), (hit.filenameHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean)); const headingHighlights = mergeSemanticPhrases(matchingSemanticPhrases(hit.heading, sharedPhrases), (hit.headingHighlights || []).map(item => cleanSourceText(item.phrase)).filter(Boolean)); return { file: hit.file, score: Number(hit.rankingScore ?? hit.score ?? 0), semanticScore: Number(hit.score || 0), filenameBoost: Number(hit.filenameBoost || 0), folderPathBoost: Number(hit.folderPathBoost || 0), filenameHighlights, snippets: [{ text: distillSnippet(hit.text, query, semanticHighlights), heading: hit.heading, score: Number(hit.score || 0), lineStart: hit.lineStart, lineEnd: hit.lineEnd, semanticHighlights, headingHighlights, imageReferences: extractImageReferences(hit.text, [query, ...semanticHighlights]) }] }; }).filter(result => result.snippets[0].text);
}
function highlightForms(value) {
  const word = String(value || '').trim();
  if (!/^[\p{L}\p{N}'’.-]+$/u.test(word) || word.includes(' ')) return [word];
  const forms = new Set([word]);
  const lower = word.toLowerCase();
  const irregular = { child: 'children', person: 'people', man: 'men', woman: 'women' };
  if (irregular[lower]) forms.add(irregular[lower]);
  if (lower.endsWith('ies') && lower.length > 4) forms.add(`${word.slice(0, -3)}y`);
  else if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 3) forms.add(word.slice(0, -1));
  else if (/[^aeiou]y$/i.test(word)) forms.add(`${word.slice(0, -1)}ies`);
  else if (/(?:s|x|z|ch|sh)$/i.test(word)) forms.add(`${word}es`);
  else forms.add(`${word}s`);
  if (/e$/i.test(word)) { forms.add(`${word.slice(0, -1)}ing`); forms.add(`${word}d`); }
  else { forms.add(`${word}ing`); forms.add(`${word}ed`); }
  return [...forms];
}
function renderHighlighted(parent, text, query, semanticPhrases = []) {
  const phrases = semanticPhrases.filter(phrase => { const words = phrase.trim().split(/\s+/).length; return phrase.length >= 4 && phrase.length <= 60 && words >= 1 && words <= 3 && text.toLowerCase().includes(phrase.toLowerCase()); }).slice(0, 3);
  const exactQuery = String(query || '').trim().replace(/\s+/g, ' ');
  const queryWords = exactQuery.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  const queryPhrases = [];
  for (let size = Math.min(3, queryWords.length); size >= 2; size--) for (let i = 0; i + size <= queryWords.length; i++) {
    const candidate = queryWords.slice(i, i + size).join(' ');
    if (text.toLowerCase().includes(candidate.toLowerCase())) queryPhrases.push(candidate);
  }
  const terms = queryTerms(query).sort((a, b) => b.length - a.length);
  const semanticForms = new Set(phrases.flatMap(highlightForms).map(form => form.toLowerCase()));
  const matches = [...new Set([...queryPhrases, ...phrases.flatMap(highlightForms), ...terms.flatMap(highlightForms)])].sort((a, b) => b.length - a.length);
  if (!matches.length) { parent.setText(text); return; }
  const escaped = matches.map(match => match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); const regex = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu'); const normalized = new Set(matches.map(match => match.toLowerCase()));
  for (const part of text.split(regex)) { if (!part) continue; if (normalized.has(part.toLowerCase())) parent.createEl('mark', { cls: semanticForms.has(part.toLowerCase()) ? 'gib-semantic-highlight gib-semantic-highlight-phrase' : 'gib-semantic-highlight', text: part }); else parent.appendText(part); }
}

class SemanticSearchModal extends SuggestModal {
  constructor(app, plugin, filePath = null) {
    super(app); this.plugin = plugin; this.filePath = filePath; this.debounceTimer = null; this.highlightTimer = null; this.searchVersion = 0; this.lastResults = []; this.lastQuery = ''; this.visibleLimit = 0; this.canLoadMore = false; this.navigationHandler = null;
    const fileName = filePath ? filePath.split('/').pop().replace(/\.md$/i, '') : '';
    this.setPlaceholder(filePath ? `Search within ${fileName}…` : 'Search vault by meaning…');
    this.setInstructions([{ command: 'Type', purpose: 'to search' }, { command: '↑↓', purpose: 'to navigate' }, { command: '↵', purpose: 'to open' }, { command: 'esc', purpose: 'to dismiss' }]);
  }
  getSuggestions(query) {
    if (!query || query.trim().length < 2) { clearTimeout(this.debounceTimer); clearTimeout(this.highlightTimer); this.searchVersion++; this.lastQuery = ''; this.lastResults = []; return []; }
    const trimmed = query.trim();
    if (trimmed !== this.lastQuery) { this.lastQuery = trimmed; this.visibleLimit = activeTweaks(this.plugin).topK; this.triggerSearch(trimmed); }
    return this.lastResults;
  }
  triggerSearch(query, immediate = false) {
    clearTimeout(this.debounceTimer); clearTimeout(this.highlightTimer); const version = ++this.searchVersion;
    this.debounceTimer = setTimeout(async () => {
      try {
        const tweaks = activeTweaks(this.plugin);
        const requested = Math.max(this.visibleLimit || tweaks.topK, tweaks.topK);
        const rawLimit = this.filePath ? Math.min(1000, requested + 10) : Math.min(1000, Math.max(requested * 4, 40));
        const options = { scoreWindow: tweaks.scoreWindow, folderPathBoost: !this.filePath && this.plugin.settings.folderPathBoostEnabled ? tweaks.folderPathBoost : 0, semanticHighlights: false, resultMinScore: tweaks.highlightResultMinScore, singleWordMinScore: tweaks.highlightSingleWordMinScore, phraseMinScore: tweaks.highlightPhraseMinScore, maxPhrases: tweaks.highlightMaxPhrases, file: this.filePath };
        const runSearch = this.plugin.search.searchLive?.bind(this.plugin.search) || this.plugin.search.search.bind(this.plugin.search);
        const results = await runSearch(query, rawLimit, tweaks.minScore, options);
        if (version === this.searchVersion && query === this.lastQuery) {
          const all = this.filePath ? passageSearchResults(results, query, results.length) : groupSearchResults(results, query, Number.MAX_SAFE_INTEGER);
          this.lastResults = all.slice(0, requested);
          this.canLoadMore = all.length > requested || (results.length === rawLimit && rawLimit < 1000);
          this.updateSuggestions();
          window.setTimeout(() => this.renderShowMore(), 0);
          if (tweaks.semanticHighlights) this.highlightTimer = window.setTimeout(async () => {
            try {
              const enriched = await runSearch(query, rawLimit, tweaks.minScore, { ...options, semanticHighlights: true });
              if (version !== this.searchVersion || query !== this.lastQuery) return;
              const enrichedAll = this.filePath ? passageSearchResults(enriched, query, enriched.length) : groupSearchResults(enriched, query, Number.MAX_SAFE_INTEGER);
              this.lastResults = enrichedAll.slice(0, requested); this.updateSuggestions(); window.setTimeout(() => this.renderShowMore(), 0);
            } catch (error) { if (error?.name !== 'AbortError') this.plugin.reportOnce(error.message); }
          }, 160);
        }
      } catch (error) { if (error?.name !== 'AbortError') this.plugin.reportOnce(error.message); }
    }, immediate ? 0 : 75);
  }
  renderShowMore() {
    this.modalEl.querySelector('.gib-show-more')?.remove();
    if (!this.canLoadMore || !this.lastQuery) return;
    const resultsEl = this.modalEl.querySelector('.suggestion-container');
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
    const pathParts = result.file.replace(/\.md$/i, '').split('/'); const fileName = pathParts.pop() || result.file.replace(/\.md$/i, '');
    const container = el.createDiv({ cls: 'gib-semantic-result' });
    const folder = container.createDiv({ cls: 'gib-semantic-result-folder' });
    (pathParts.length ? pathParts : ['Vault']).forEach((part, index) => { if (index) folder.createSpan({ cls: 'gib-semantic-result-folder-separator', text: '/' }); folder.createSpan({ text: part }); });
    const header = container.createDiv({ cls: 'gib-semantic-result-header' });
    const icon = header.createSpan({ cls: 'gib-semantic-result-icon' }); setIcon(icon, 'sticky-note');
    const fileTitle = header.createSpan({ cls: 'gib-semantic-result-file' }); renderHighlighted(fileTitle, fileName, this.lastQuery, result.filenameHighlights);
    const score = header.createSpan({ cls: 'gib-semantic-result-score', text: `${(Number(result.score || 0) * 100).toFixed(0)}%` });
    const semantic = Math.round(Number(result.semanticScore || 0) * 100), filename = Math.round(Number(result.filenameBoost || 0) * 100), folderBoost = Math.round(Number(result.folderPathBoost || 0) * 100);
    score.setAttribute('title', `Total relevance: ${(Number(result.score || 0) * 100).toFixed(0)}% · Semantic: ${semantic}% · Filename: +${filename} · Folder: +${folderBoost}`);
    const snippets = container.createDiv({ cls: 'gib-semantic-snippets' });
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
    this.navigationHandler = event => {
      if (event.key === 'Tab') {
        event.preventDefault(); event.stopImmediatePropagation();
        this.inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: event.shiftKey ? 'ArrowUp' : 'ArrowDown', code: event.shiftKey ? 'ArrowUp' : 'ArrowDown', bubbles: true }));
      }
    };
    this.modalEl.addEventListener('keydown', this.navigationHandler, true);
  }
  onClose() {
    clearTimeout(this.debounceTimer); clearTimeout(this.highlightTimer); this.searchVersion++;
    if (this.navigationHandler) this.modalEl.removeEventListener('keydown', this.navigationHandler, true);
    super.onClose();
  }
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
    const stale = Number(remote?.staleFiles || 0); const healthy = Boolean(remote?.modelLoaded) && !remote?.isIndexing && stale === 0; const working = Boolean(remote?.isIndexing) || ['starting', 'loading_model', 'downloading_model', 'indexing'].includes(phase);
    const stoppedResponding = !remote && working && statusAge > 15000; const activelyWorking = working && !stoppedResponding;
    const state = healthy ? 'healthy' : activelyWorking ? 'working' : this.plugin.settings.enabled ? 'error' : 'disabled'; this.healthEl.dataset.state = state;
    this.healthTitle.textContent = healthy ? 'Healthy and watching your vault' : activelyWorking ? 'Indexing in progress' : this.plugin.settings.enabled ? 'Indexer needs attention' : 'Indexer disabled';
    this.healthMessage.textContent = healthy ? 'The model is loaded, semantic queries are responding, and note changes are being watched.' : stoppedResponding ? `The indexer stopped responding ${formatElapsed(statusAge)} ago. Retry will resume from the latest checkpoint.` : activelyWorking ? (local.message || this.plugin.indexer.lastEvent) : (this.plugin.indexer.lastError || error || local.message || 'The semantic index is unavailable');
    const total = Number(local.totalFiles || local.vaultFiles || remote?.vaultFiles || 0), done = Number(local.processedFiles ?? local.fileCount ?? local.indexedFiles ?? remote?.indexedFiles ?? 0);
    const elapsedFrom = Number(local.phaseStartedAt || local.startedAt || 0); const indexBytes = this.plugin.search.storageBytes?.() || 0; const modelBytes = this.plugin.runtime.storageBytes?.() || 0;
    this.healthFields = []; this.field('Phase', stoppedResponding ? 'stopped' : phase.replaceAll('_', ' ')); this.field('Progress', total ? `${done}/${total}` : 'Waiting'); this.field('Indexed', remote?.indexedFiles ?? local.indexedFiles ?? 0); this.field('Chunks', remote?.totalChunks ?? local.totalChunks ?? 0); const modelLabel = MODEL_PROFILES[remote?.modelProfile]?.label || remote?.modelId || 'Loaded'; this.field('Model', remote?.modelLoaded ? `${modelLabel} (${String(remote.modelBackend || 'WASM').toUpperCase()})` : 'Not ready'); this.field('Index size', formatBytes(indexBytes)); if (!this.plugin.isMobile) this.field('Model cache', formatBytes(modelBytes)); this.field('Last success', formatWhen(local.lastSuccessfulIndexAt)); if (activelyWorking && elapsedFrom) this.field('Elapsed', formatElapsed(Date.now() - elapsedFrom)); this.healthGrid.textContent = this.healthFields.join(' · ');
    if (activelyWorking && total > 0) { this.healthProgress.style.display = ''; this.healthProgress.value = Math.min(100, done / total * 100); } else this.healthProgress.style.display = 'none';
    this.healthEvent.textContent = local.currentFile ? `Current file: ${local.currentFile}` : `Latest activity: ${this.plugin.indexer.lastEvent}`;
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
    this.lastError = '';
    this.embeddedWasmGzip = EMBEDDED_WASM_GZIP;
    this.embeddedWasmModuleGzip = EMBEDDED_WASM_MODULE_GZIP;
    if (!this.isMobile) {
      loadDesktopModules(); this.vaultPath = this.app.vault.adapter.basePath; this.pluginDir = path.join(this.vaultPath, this.app.vault.configDir, 'plugins', this.manifest.id); this.cacheRoot = desktopCacheRoot(); this.vaultCacheKey = vaultCacheKey(this.vaultPath); restoreDesktopData(this);
      this.modelDir = path.join(this.pluginDir, 'models'); this.modelCache = new FileModelCache(this.modelDir); this.desktopIndexStore = new DesktopIndexStore(activeIndexDir(this));
    }
    this.search = this.indexer = new MobileSearchRuntime(this); this.runtime = { ready: () => true, install: async () => true, stop() {}, storageBytes: () => this.isMobile ? 0 : directorySize(this.modelDir) }; this.indexer.watch();
    this.registerView(GRAPH_VIEW, leaf => new GraphView(leaf, this));
    this.addRibbonIcon('search', 'Gib Search', () => new SemanticSearchModal(this.app, this).open());
    this.addCommand({ id: 'semantic-search', name: 'Semantic search', callback: () => new SemanticSearchModal(this.app, this).open() });
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
  reportOnce(message) { if (message !== this.lastError) { this.lastError = message; new Notice(`Gib Search: ${message}`); } }
  async openGraph() { let leaf = this.app.workspace.getLeavesOfType(GRAPH_VIEW)[0]; if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: GRAPH_VIEW, active: true }); } this.app.workspace.revealLeaf(leaf); }
  onunload() { this.runtime?.stop(); this.indexer?.stop(); }
};
