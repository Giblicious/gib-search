import { pipeline, env } from '@huggingface/transformers';
import nlp from 'compromise';

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const DIMENSION = 384;
const HIGHLIGHT_INDEX_VERSION = 1;
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const INDEXABLE = new Set(['md', 'txt', 'markdown']);
const STOP_WORDS = new Set(['a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'been', 'being', 'between', 'but', 'by', 'can', 'could', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'in', 'into', 'is', 'it', 'its', 'may', 'might', 'more', 'my', 'not', 'of', 'on', 'or', 'our', 'out', 'over', 'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'they', 'this', 'those', 'through', 'to', 'under', 'up', 'vs', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'with', 'without', 'would', 'you', 'your']);
const GENERIC_CONCEPTS = new Set(['answer', 'concept', 'example', 'fact', 'idea', 'kind', 'part', 'point', 'question', 'section', 'thing', 'thought', 'type', 'way']);

function basename(file) { return String(file).split('/').pop().replace(/\.(?:md|txt|markdown)$/i, ''); }
function dirname(file) { const parts = String(file).split('/'); parts.pop(); return parts.join('/'); }
function tokens(source) {
  return (String(source || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(token => token.length > 2)
    .map(token => token.replace(/ies$/, 'y').replace(/ing$/, '').replace(/s$/, ''));
}
function lexicalCoverage(queryTokens, sourceTokens) {
  if (!queryTokens.length) return 0;
  return queryTokens.filter(token => sourceTokens.has(token)).length / queryTokens.length;
}
function dot(a, b) {
  if (!a || !b) throw new Error(`Missing semantic vector (query: ${Boolean(a)}, candidate: ${Boolean(b)})`);
  let score = 0; for (let i = 0; i < a.length; i++) score += a[i] * b[i]; return score;
}
function dotPacked(query, packed, offset) { let score = 0; for (let i = 0; i < DIMENSION; i += 4) score += query[i] * packed[offset + i] + query[i + 1] * packed[offset + i + 1] + query[i + 2] * packed[offset + i + 2] + query[i + 3] * packed[offset + i + 3]; return score; }
function contentFingerprint(source) {
  const value = String(source || ''); let first = 2166136261, second = 2246822507;
  for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second ^ code, 3266489909); }
  return `${value.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}
function sameChunks(items, chunks) {
  return items.length === chunks.length && items.every((item, index) => item.text === chunks[index].text && item.heading === chunks[index].heading && item.lineStart === chunks[index].lineStart && item.lineEnd === chunks[index].lineEnd);
}
function staleSearchError() { const error = new Error('Superseded by a newer semantic query'); error.name = 'AbortError'; return error; }
function yieldToUi() { return new Promise(resolve => setTimeout(resolve, 0)); }
function sampleEvenly(items, maximum) { if (items.length <= maximum) return items; return Array.from({ length: maximum }, (_, index) => items[Math.round(index * (items.length - 1) / (maximum - 1))]); }

function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  return end === -1 ? content : content.slice(end + 4).trim();
}
function parseSections(content) {
  const lines = content.split('\n'); const sections = []; const stack = []; let current = []; let start = 0;
  const flush = end => { const text = current.join('\n').trim(); if (text) sections.push({ heading: stack.join(' > '), text, lineStart: start, lineEnd: end }); current = []; };
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,3})\s+(.+)/);
    if (!match) { current.push(lines[i]); continue; }
    flush(i - 1); start = i; const level = match[1].length; while (stack.length >= level) stack.pop(); stack.push(match[2].trim());
  }
  flush(lines.length - 1); return sections;
}
function chunkMarkdown(content) {
  const cleaned = stripFrontmatter(String(content || '')).trim(); if (!cleaned) return [];
  const max = 2400; if (cleaned.length <= 1600) return [{ text: cleaned, heading: '', lineStart: 0, lineEnd: cleaned.split('\n').length - 1 }];
  const split = [];
  for (const section of parseSections(cleaned)) {
    if (section.text.length <= max) { split.push(section); continue; }
    const paragraphs = section.text.split(/\n\n+/); let current = []; let length = 0; let start = section.lineStart;
    const flush = end => { if (!current.length) return; const text = current.join('\n\n').trim(); split.push({ heading: section.heading, text, lineStart: start, lineEnd: end }); start = end + 1; current = []; length = 0; };
    for (const paragraph of paragraphs) { if (length + paragraph.length > max && current.length) flush(start + current.join('\n\n').split('\n').length - 1); current.push(paragraph); length += paragraph.length + 2; }
    flush(section.lineEnd);
  }
  return split.filter(chunk => chunk.text.trim());
}
function embeddingText(file, chunk) { return `${basename(file)}${chunk.heading ? `\n${chunk.heading}` : ''}\n\n${chunk.text}`; }

function cleanText(source) {
  return String(source || '').replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1')
    .replace(/!?(?:\[\[|\[)([^\]|]+)(?:\|[^\]]+)?(?:\]\]|\](?:\([^)]*\))?)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )\s*/gm, '').replace(/[*_~=#|<>]/g, ' ').replace(/\s+/g, ' ').trim();
}
const IRREGULAR_LEMMAS = new Map([['felt', 'feel'], ['feels', 'feel'], ['feelings', 'feel'], ['children', 'child'], ['people', 'person'], ['men', 'man'], ['women', 'woman']]);
function lemma(source) {
  const word = String(source || '').toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (IRREGULAR_LEMMAS.has(word)) return IRREGULAR_LEMMAS.get(word);
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3).replace(/(.)\1$/, '$1');
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2).replace(/(.)\1$/, '$1');
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
function queryAnchors(query) {
  return new Set((String(query || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).map(lemma).filter(word => word.length > 2 && !STOP_WORDS.has(word)));
}
function contextualSentences(source, maximum = 12) {
  const clean = cleanText(source); if (!clean) return [];
  const split = clean.match(/[^.!?\n]+[.!?]?/g)?.map(value => value.trim()).filter(Boolean) || [clean];
  return split.length <= maximum ? split : sampleEvenly(split, maximum);
}
function sentenceWords(sentence) {
  return (String(sentence).match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).map((text, index) => ({ text: text.replace(/[.,!?]+$/, ''), index, lemma: lemma(text), stop: STOP_WORDS.has(lemma(text)) }));
}
function indexedHighlightCandidates(field, source, maximum) {
  const sentences = contextualSentences(source, field === 'body' ? 24 : 4); const groups = [];
  sentences.forEach((sentence, sentenceId) => {
    const words = sentenceWords(sentence); const tagged = nlp(sentence).terms().json().flatMap(item => item.terms || []);
    words.forEach((word, index) => { word.tags = new Set(tagged[index]?.tags || []); });
    const candidates = [];
    for (let start = 0; start < words.length; start++) for (let size = 1; size <= 3 && start + size <= words.length; size++) {
      const slice = words.slice(start, start + size); const leadingArticle = size > 1 && ['a', 'an', 'the'].includes(slice[0].lemma);
      if ((slice[0].stop && !leadingArticle) || slice.at(-1).stop || !slice.some(word => !word.stop)) continue;
      const tags = new Set(slice.flatMap(word => [...word.tags])); const hasNoun = tags.has('Noun') || tags.has('ProperNoun'); const hasVerb = tags.has('Verb'); const hasExpression = tags.has('Expression'); const hasAdjective = tags.has('Adjective'); const nounIndex = slice.findIndex(word => word.tags.has('Noun') || word.tags.has('ProperNoun')); const verbIndex = slice.findIndex(word => word.tags.has('Verb')); const verbBeforeNoun = verbIndex >= 0 && nounIndex >= 0 && verbIndex < nounIndex;
      if (size === 1 && (!hasNoun && !hasVerb && !hasExpression || GENERIC_CONCEPTS.has(slice[0].lemma))) continue;
      if (size > 1 && !hasNoun && !hasExpression) continue;
      const phrase = slice.map(word => word.text).join(' '); if (phrase.length < 3 || phrase.length > 60) continue;
      const quality = (hasNoun ? .04 : 0) + (verbBeforeNoun ? .08 : 0) + (hasNoun && hasAdjective ? .06 : 0) + (hasExpression ? .07 : 0) + (size === 2 ? .05 : size === 3 ? .03 : 0);
      candidates.push({ phrase, field, sentenceId, start, end: start + size - 1, words: size, hasNoun, hasVerb, hasExpression, adjectiveOnly: hasAdjective && !hasNoun && !hasVerb, quality });
    }
    const ranked = candidates.sort((a, b) => b.quality - a.quality || b.words - a.words); groups.push([...ranked.filter(item => item.words > 1).slice(0, 3), ...ranked.filter(item => item.words === 1).slice(0, 5)]);
  });
  const results = []; let level = 0;
  while (results.length < maximum && groups.some(group => level < group.length)) { for (const group of groups) { if (group[level]) results.push(group[level]); if (results.length === maximum) break; } level++; }
  return results;
}
function quantizeHighlightVector(vector) { return Int16Array.from(vector, value => Math.max(-32767, Math.min(32767, Math.round(value * 32767)))); }
function dotHighlight(query, vector) { let score = 0; for (let index = 0; index < query.length; index++) score += query[index] * vector[index] / 32767; return score; }
export function buildHighlightCandidates(file, chunk) {
  const candidates = [...indexedHighlightCandidates('filename', basename(file), 8), ...indexedHighlightCandidates('heading', chunk.heading, 8), ...indexedHighlightCandidates('body', chunk.text, 24)];
  const seen = new Set(); return candidates.filter(item => { const key = `${item.field}:${item.phrase.toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export class MobileSearchRuntime {
  constructor(plugin) {
    this.plugin = plugin; this.adapter = plugin.app.vault.adapter; this.isMobile = plugin.isMobile; this.meta = []; this.vectors = []; this.highlightVectors = []; this.highlightPhraseVectors = new Map(); this.packedVectors = new Float32Array(); this.packedHighlightVectors = new Int16Array(); this.lexical = [];
    this.pipe = null; this.modelPromise = null; this.startPromise = null; this.enabled = false; this.cancelRequested = false; this.phase = 'offline'; this.message = 'Semantic search is not started'; this.lastEvent = this.message; this.lastError = ''; this.process = null;
    this.listeners = new Set(); this.updateTimer = null; this.indexRun = null; this.indexAgain = false; this.indexForce = false; this.startedAt = Date.now(); this.phaseStartedAt = this.startedAt;
    this.processedFiles = 0; this.totalFiles = 0; this.currentFile = ''; this.lastSuccessfulIndexAt = null;
    this.legacyIndexDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/embeddings/bge-small-en-v1.5-mobile`;
    this.indexKey = `${plugin.manifest.id}:${plugin.app.vault.adapter.getBasePath?.() || plugin.app.vault.getName()}:bge-small-en-v1.5`;
    this.database = null; this.queryCache = new Map(); this.resultCache = new Map(); this.livePending = null; this.liveRunning = false; this.modelBackend = 'wasm';
  }
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed() { for (const listener of this.listeners) listener(); }
  setState(phase, message) { if (phase !== this.phase) this.phaseStartedAt = Date.now(); this.phase = phase; this.message = message; this.lastEvent = message; this.lastError = phase === 'error' ? message : ''; this.changed(); }
  highlightPhraseCount() { return this.meta.reduce((total, item) => total + (item.highlightCandidates?.length || 0), 0); }
  workerStatus() { return { phase: this.phase, message: this.message, pid: 'mobile', startedAt: this.startedAt, phaseStartedAt: this.phaseStartedAt, updatedAt: Date.now(), indexedFiles: new Set(this.meta.map(item => item.file)).size, totalChunks: this.meta.length, highlightPhrases: this.highlightPhraseCount(), processedFiles: this.processedFiles, totalFiles: this.totalFiles || this.vaultFiles || 0, currentFile: this.currentFile, lastSuccessfulIndexAt: this.lastSuccessfulIndexAt }; }
  async health() { return { indexedFiles: new Set(this.meta.map(item => item.file)).size, totalChunks: this.meta.length, highlightPhrases: this.highlightPhraseCount(), vaultFiles: this.vaultFiles || 0, staleFiles: this.staleFiles || 0, isIndexing: this.phase === 'indexing', modelLoaded: Boolean(this.pipe || this.plugin.desktopEmbedder?.ready), modelProfile: 'bge', modelId: MODEL_ID, modelBackend: this.isMobile ? this.modelBackend : 'web-worker-wasm' }; }
  async openDatabase() {
    if (this.database) return this.database;
    this.database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('gib-search', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('indexes')) request.result.createObjectStore('indexes'); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('Could not open local search storage'));
    });
    return this.database;
  }
  async databaseGet() {
    if (!this.isMobile) return this.plugin.desktopIndexStore.get();
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => { const request = database.transaction('indexes', 'readonly').objectStore('indexes').get(this.indexKey); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  async databasePut(value) {
    if (!this.isMobile) return this.plugin.desktopIndexStore.put(value);
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => { const request = database.transaction('indexes', 'readwrite').objectStore('indexes').put(value, this.indexKey); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  }
  async migrateLegacyIndex() {
    if (!this.isMobile) return;
    const metaPath = `${this.legacyIndexDir}/index.meta.json`, vectorsPath = `${this.legacyIndexDir}/index.vectors.bin`;
    if (!await this.adapter.exists(metaPath) || !await this.adapter.exists(vectorsPath)) return;
    const meta = JSON.parse(await this.adapter.read(metaPath)); const vectors = await this.adapter.readBinary(vectorsPath);
    await this.databasePut({ meta, vectors, migratedAt: Date.now() });
    try { await this.adapter.rmdir(this.legacyIndexDir, true); const parent = this.legacyIndexDir.slice(0, this.legacyIndexDir.lastIndexOf('/')); if (await this.adapter.exists(parent)) await this.adapter.rmdir(parent, false); } catch {}
  }
  async cleanupLegacyGeneratedData() {
    if (!this.isMobile) return;
    const pluginDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
    for (const name of ['logs']) { const target = `${pluginDir}/${name}`; try { if (await this.adapter.exists(target)) await this.adapter.rmdir(target, true); } catch {} }
  }
  async initializeModel() {
    if (this.pipe) return;
    if (this.modelPromise) return this.modelPromise;
    this.modelPromise = this.loadModel();
    try { return await this.modelPromise; } finally { this.modelPromise = null; }
  }
  async loadModel() {
    this.setState('loading_model', 'Loading BGE. The first run downloads the model into Gib Search.');
    env.allowRemoteModels = true; env.allowLocalModels = false; env.useCustomCache = !this.isMobile; env.customCache = this.isMobile ? null : this.plugin.modelCache; env.useBrowserCache = this.isMobile; env.useFSCache = false;
    const progress_callback = progress => { if (progress.status !== 'progress') return; const percent = Number(progress.progress); if (Number.isFinite(percent)) this.setState('loading_model', `Downloading ${progress.file || 'BGE'}: ${Math.round(percent)}%`); };
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
      if (!this.plugin.embeddedWasmModuleUrl) {
        const encodedModule = this.plugin.embeddedWasmModuleGzip; const compressedModule = Uint8Array.from(atob(encodedModule), character => character.charCodeAt(0));
        const moduleStream = new Blob([compressedModule]).stream().pipeThrough(new DecompressionStream('gzip')); const moduleSource = await new Response(moduleStream).text();
        this.plugin.embeddedWasmModuleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
      }
      env.backends.onnx.wasm.wasmPaths = { mjs: this.plugin.embeddedWasmModuleUrl };
      if (!this.plugin.embeddedWasmBinary) {
        const encoded = this.plugin.embeddedWasmGzip; const compressed = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
        this.plugin.embeddedWasmBinary = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      env.backends.onnx.wasm.wasmBinary = this.plugin.embeddedWasmBinary;
    }
    try {
      this.pipe = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8', progress_callback });
      await this.pipe([`${QUERY_PREFIX}warm semantic search`], { pooling: 'mean', normalize: true }); this.plugin.logDiagnostic(`Bundled semantic engine warmed with ${this.modelBackend.toUpperCase()}`);
    } finally {
      if (this.plugin.embeddedWasmModuleUrl) { URL.revokeObjectURL(this.plugin.embeddedWasmModuleUrl); this.plugin.embeddedWasmModuleUrl = null; }
    }
  }
  async embedBatch(texts, query = false, preferredBatchSize = null) {
    if (!texts.length) return [];
    const batchSize = preferredBatchSize || (query ? 8 : 2);
    if (!this.isMobile && this.plugin.desktopEmbedder) {
      const results = [];
      for (let i = 0; i < texts.length; i += batchSize) results.push(...await this.plugin.desktopEmbedder.embedBatch(texts.slice(i, i + batchSize), query));
      return results;
    }
    await this.initializeModel(); const results = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map(text => query ? `${QUERY_PREFIX}${text}` : text);
      const output = await this.pipe(batch, { pooling: 'mean', normalize: true }); const dim = output.dims.at(-1);
      for (let j = 0; j < batch.length; j++) results.push(new Float32Array(output.data.slice(j * dim, (j + 1) * dim)));
      await yieldToUi();
    }
    return results;
  }
  async embed(text, query = false) { return (await this.embedBatch([text], query))[0]; }
  refreshLexical() { this.lexical = this.meta.map(item => ({ filename: new Set(tokens(basename(item.file))), folder: new Set(tokens(dirname(item.file))) })); }
  refreshHighlightPhraseCache() { this.highlightPhraseVectors.clear(); this.meta.forEach((item, passageIndex) => (item.highlightCandidates || []).forEach((candidate, candidateIndex) => this.highlightPhraseVectors.set(candidate.phrase.trim().toLowerCase(), this.highlightVectors[passageIndex]?.[candidateIndex]))); }
  async loadIndex() {
    try {
      let stored = await this.databaseGet(); if (!stored) { await this.migrateLegacyIndex(); stored = await this.databaseGet(); } if (!stored) return;
      this.meta = stored.meta || []; this.lastSuccessfulIndexAt = stored.lastSuccessfulIndexAt || null; const all = new Float32Array(stored.vectors); const highlights = new Int16Array(stored.highlightVectors || new ArrayBuffer(0));
      if (all.length !== this.meta.length * DIMENSION) throw new Error('Index dimensions do not match BGE');
      const highlightCount = this.meta.reduce((total, item) => total + (item.highlightCandidates?.length || 0), 0); if (highlights.length !== highlightCount * DIMENSION) throw new Error('Highlight index dimensions do not match BGE');
      let highlightOffset = 0; this.highlightVectors = this.meta.map(item => (item.highlightCandidates || []).map(() => { const vector = highlights.subarray(highlightOffset, highlightOffset + DIMENSION); highlightOffset += DIMENSION; return vector; }));
      this.packedVectors = all; this.packedHighlightVectors = highlights; this.vectors = this.meta.map((_, index) => all.subarray(index * DIMENSION, (index + 1) * DIMENSION)); this.refreshLexical(); this.refreshHighlightPhraseCache();
    } catch (error) { this.plugin.logDiagnostic(`Index load failed: ${error?.message || String(error)}`, true); if (!this.isMobile) throw error; this.meta = []; this.vectors = []; this.highlightVectors = []; this.highlightPhraseVectors.clear(); this.packedVectors = new Float32Array(); this.packedHighlightVectors = new Int16Array(); this.refreshLexical(); }
  }
  async saveIndex() {
    const packed = new Float32Array(this.vectors.length * DIMENSION);
    this.vectors.forEach((vector, index) => packed.set(vector, index * DIMENSION));
    const highlightCount = this.highlightVectors.reduce((total, vectors) => total + vectors.length, 0); const packedHighlights = new Int16Array(highlightCount * DIMENSION); let highlightOffset = 0;
    this.highlightVectors.forEach(vectors => vectors.forEach(vector => { packedHighlights.set(vector, highlightOffset); highlightOffset += DIMENSION; }));
    this.packedVectors = packed; this.packedHighlightVectors = packedHighlights; this.vectors = this.meta.map((_, index) => packed.subarray(index * DIMENSION, (index + 1) * DIMENSION)); highlightOffset = 0; this.highlightVectors = this.meta.map(item => (item.highlightCandidates || []).map(() => { const vector = packedHighlights.subarray(highlightOffset, highlightOffset + DIMENSION); highlightOffset += DIMENSION; return vector; })); this.queryCache.clear(); this.resultCache.clear();
    await this.databasePut({ meta: this.meta, vectors: packed.buffer, highlightVectors: packedHighlights.buffer, lastSuccessfulIndexAt: this.lastSuccessfulIndexAt }); this.refreshLexical(); this.refreshHighlightPhraseCache();
  }
  storageBytes() { return this.vectors.length * DIMENSION * 4 + this.highlightVectors.reduce((total, vectors) => total + vectors.length, 0) * DIMENSION * 2 + new TextEncoder().encode(JSON.stringify(this.meta)).length; }
  files() { return this.plugin.app.vault.getFiles().filter(file => INDEXABLE.has(file.extension.toLowerCase())); }
  async waitForVaultSettled() {
    const minimumUntil = Date.now() + 4000; let previous = -1; let stable = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
      const count = this.files().length; stable = count === previous ? stable + 1 : 0; previous = count;
      if (Date.now() >= minimumUntil && stable >= 3) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  async updateIndex(force = false) {
    if (this.indexRun) { this.indexAgain = true; this.indexForce ||= force; return this.indexRun; }
    this.indexRun = (async () => {
      let nextForce = force;
      do { this.indexAgain = false; this.indexForce = false; await this.performIndexUpdate(nextForce); nextForce = this.indexForce; } while (this.indexAgain && this.enabled && !this.cancelRequested);
    })();
    try { return await this.indexRun; } finally { this.indexRun = null; }
  }
  async embedHighlightCandidates(groups) {
    const unique = []; const missing = new Set();
    groups.flat().forEach(candidate => { const phrase = candidate.phrase.trim(), key = phrase.toLowerCase(); if (!this.highlightPhraseVectors.has(key) && !missing.has(key)) { missing.add(key); unique.push(phrase); } });
    const embedded = await this.embedBatch(unique, false, this.isMobile ? 8 : 24); if (embedded.length !== unique.length) throw new Error(`Highlight embedding returned ${embedded.length} of ${unique.length} vectors`);
    unique.forEach((phrase, index) => this.highlightPhraseVectors.set(phrase.toLowerCase(), quantizeHighlightVector(embedded[index])));
    return groups.map(candidates => candidates.map(candidate => this.highlightPhraseVectors.get(candidate.phrase.trim().toLowerCase())));
  }
  async performIndexUpdate(force = false) {
    this.setState('indexing', 'Checking the semantic index…'); const files = this.files(); this.vaultFiles = files.length; this.totalFiles = files.length; this.currentFile = '';
    const indexed = new Map(); this.meta.forEach(item => { const group = indexed.get(item.file) || []; group.push(item); indexed.set(item.file, group); });
    const changed = []; const contentByPath = new Map(); let metadataChanged = false;
    for (const file of files) {
      const previous = indexed.get(file.path); const currentHighlights = previous?.every(item => item.highlightVersion === HIGHLIGHT_INDEX_VERSION && Array.isArray(item.highlightCandidates)); if (!force && currentHighlights && previous?.every(item => item.mtime === file.stat.mtime && item.contentHash)) continue;
      const content = await this.plugin.app.vault.read(file); const fingerprint = contentFingerprint(content); const previousFingerprint = previous?.find(item => item.contentHash)?.contentHash;
      const unchanged = !force && currentHighlights && previous && (previousFingerprint === fingerprint || (!previousFingerprint && sameChunks(previous, chunkMarkdown(content))));
      if (unchanged) { previous.forEach(item => { item.mtime = file.stat.mtime; item.contentHash = fingerprint; }); metadataChanged = true; }
      else { changed.push(file); contentByPath.set(file.path, content); }
      await yieldToUi();
    }
    const present = new Set(files.map(file => file.path));
    const deleted = new Set(this.meta.filter(item => !present.has(item.file)).map(item => item.file)); this.staleFiles = changed.length;
    this.plugin.logDiagnostic(`Scan complete: ${files.length} files; ${changed.length} need indexing`);
    this.processedFiles = Math.max(0, files.length - changed.length);
    if (!changed.length && !deleted.size) { this.staleFiles = 0; this.processedFiles = files.length; this.lastSuccessfulIndexAt = Date.now(); if (metadataChanged) await this.saveIndex(); this.setState('ready', `Ready (${files.length} files, ${this.meta.length} passages)`); return; }
    let meta = []; let vectors = []; let highlightVectors = []; let checkpointAt = Date.now(); for (let i = 0; i < this.meta.length; i++) if (!deleted.has(this.meta[i].file)) { meta.push(this.meta[i]); vectors.push(this.vectors[i]); highlightVectors.push(this.highlightVectors[i] || []); }
    for (let fileIndex = 0; fileIndex < changed.length; fileIndex++) {
      if (this.cancelRequested || !this.enabled) return;
      const file = changed[fileIndex]; const fileStartedAt = Date.now(); this.currentFile = file.path; this.setState('indexing', `Indexing ${this.processedFiles + 1} of ${files.length}: ${file.path}`);
      try {
        const content = contentByPath.get(file.path) ?? await this.plugin.app.vault.read(file); const fingerprint = contentFingerprint(content); const chunks = chunkMarkdown(content); const embedded = await this.embedBatch(chunks.map(chunk => embeddingText(file.path, chunk))); const highlightCandidates = chunks.map(chunk => buildHighlightCandidates(file.path, chunk)); const embeddedHighlights = await this.embedHighlightCandidates(highlightCandidates);
        const retainedMeta = []; const retainedVectors = []; const retainedHighlights = []; for (let i = 0; i < meta.length; i++) if (meta[i].file !== file.path) { retainedMeta.push(meta[i]); retainedVectors.push(vectors[i]); retainedHighlights.push(highlightVectors[i] || []); }
        meta = retainedMeta; vectors = retainedVectors; highlightVectors = retainedHighlights; chunks.forEach((chunk, index) => { meta.push({ file: file.path, heading: chunk.heading, text: chunk.text, lineStart: chunk.lineStart, lineEnd: chunk.lineEnd, mtime: file.stat.mtime, contentHash: fingerprint, highlightVersion: HIGHLIGHT_INDEX_VERSION, highlightCandidates: highlightCandidates[index] }); vectors.push(embedded[index]); highlightVectors.push(embeddedHighlights[index]); });
        this.plugin.logDiagnostic(`Indexed ${file.path}: ${new TextEncoder().encode(content).length} bytes, ${chunks.length} chunks, ${highlightCandidates.flat().length} highlight phrases in ${Date.now() - fileStartedAt} ms`);
      } catch (error) { this.plugin.reportOnce(`Could not index ${file.path}: ${error.message}`); }
      this.processedFiles++;
      if (Date.now() - checkpointAt >= 30000) { this.meta = meta; this.vectors = vectors; this.highlightVectors = highlightVectors; await this.saveIndex(); checkpointAt = Date.now(); this.plugin.logDiagnostic(`Saved index checkpoint: ${this.processedFiles}/${files.length} files`); }
      await yieldToUi();
    }
    if (this.cancelRequested || !this.enabled) return;
    this.meta = meta; this.vectors = vectors; this.highlightVectors = highlightVectors; this.lastSuccessfulIndexAt = Date.now(); await this.saveIndex(); this.staleFiles = 0; this.currentFile = ''; this.processedFiles = files.length; this.setState('ready', `Ready (${files.length} files, ${this.meta.length} passages)`);
  }
  start() {
    if (!this.plugin.settings.enabled) { this.setState('offline', 'Semantic index is disabled'); return false; }
    if (this.startPromise) return false; this.enabled = true; this.cancelRequested = false;
    this.startPromise = (async () => { try { await this.loadIndex(); await this.cleanupLegacyGeneratedData(); this.setState('starting', 'Waiting for the vault to finish loading…'); await this.waitForVaultSettled(); await this.updateIndex(); } catch (error) { this.setState('error', error.message); this.plugin.reportOnce(error.message); } finally { this.startPromise = null; } })();
    return true;
  }
  stop() { this.cancelRequested = true; this.enabled = false; clearTimeout(this.updateTimer); this.updateTimer = null; if (this.livePending) { this.livePending.reject(staleSearchError()); this.livePending = null; } this.setState('offline', 'Semantic search is paused'); return true; }
  restart() { this.stop(); const resume = () => this.startPromise ? setTimeout(resume, 100) : this.start(); resume(); return true; }
  rebuild() { this.stop(); const rebuild = () => { if (this.startPromise) return setTimeout(rebuild, 100); this.meta = []; this.vectors = []; this.highlightVectors = []; this.highlightPhraseVectors.clear(); this.packedVectors = new Float32Array(); this.packedHighlightVectors = new Int16Array(); this.queryCache.clear(); this.resultCache.clear(); this.refreshLexical(); this.enabled = true; this.cancelRequested = false; this.startPromise = (async () => { try { await this.updateIndex(true); } catch (error) { this.setState('error', error.message); } finally { this.startPromise = null; } })(); }; rebuild(); return true; }
  watch() {
    const schedule = file => { if (!this.enabled || !file?.path || !INDEXABLE.has(String(file.extension || '').toLowerCase())) return; clearTimeout(this.updateTimer); this.updateTimer = setTimeout(() => { this.updateTimer = null; this.updateIndex(); }, 1800); };
    this.plugin.registerEvent(this.plugin.app.vault.on('create', schedule)); this.plugin.registerEvent(this.plugin.app.vault.on('modify', schedule)); this.plugin.registerEvent(this.plugin.app.vault.on('delete', schedule)); this.plugin.registerEvent(this.plugin.app.vault.on('rename', schedule));
  }
  async semanticHighlights(results, queryVector, options) {
    const limit = Math.max(1, Math.min(15, Number(options.highlightLimit) || 15));
    const anchors = queryAnchors(options.query);
    for (const result of results.slice(0, limit)) {
      if (result.semanticScore < options.resultMinScore) continue;
      const candidates = result.highlightCandidates || []; const vectors = this.highlightVectors[result.passageIndex] || [];
      if (vectors.length !== candidates.length) throw new Error(`Highlight vectors are incomplete for ${result.file}`);
      const scored = candidates.map((candidate, index) => {
        const anchorCount = new Set(sentenceWords(candidate.phrase).filter(word => anchors.has(word.lemma)).map(word => word.lemma)).size; const directScore = dotHighlight(queryVector, vectors[index]); const confidence = directScore + anchorCount * .025;
        return { ...candidate, anchorCount, directScore, confidence, rankScore: confidence + anchorCount * .05 + (candidate.words > 1 ? .02 : 0) + candidate.words * .012 + candidate.quality };
      });
      const choose = (field, maximum) => { const chosen = []; for (const item of scored.filter(value => value.field === field).sort((a, b) => b.rankScore - a.rankScore)) {
        const threshold = item.words === 1 ? options.singleWordMinScore : options.phraseMinScore; const contextualAnchor = item.anchorCount > 0 && item.directScore >= threshold - .1; const contextualExpression = item.words > 1 && (item.hasNoun || item.hasExpression) && item.directScore >= threshold - .05;
        if (item.adjectiveOnly && !item.anchorCount && item.directScore < threshold + .06) continue;
        if (item.confidence < threshold && !contextualAnchor && !contextualExpression) continue;
        if (chosen.some(value => value.sentenceId === item.sentenceId && !(item.end < value.start || item.start > value.end))) continue;
        chosen.push(item); if (chosen.length === maximum) break;
      } return chosen.map(({ phrase, confidence }) => ({ phrase, score: confidence })); };
      result.filenameHighlights = choose('filename', 2); result.headingHighlights = choose('heading', 2); result.semanticHighlights = choose('body', options.maxPhrases);
    }
  }
  cacheResult(cache, key, value, maximum) { cache.delete(key); cache.set(key, value); while (cache.size > maximum) cache.delete(cache.keys().next().value); return value; }
  async queryVector(query) {
    const key = String(query || '').trim().replace(/\s+/g, ' ').toLowerCase(); const cached = this.queryCache.get(key); if (cached) return await cached;
    const pending = this.embed(query, true); this.cacheResult(this.queryCache, key, pending, 48);
    try { const vector = await pending; this.cacheResult(this.queryCache, key, vector, 48); return vector; } catch (error) { this.queryCache.delete(key); throw error; }
  }
  searchLive(query, topK, minScore, options = {}) {
    return new Promise((resolve, reject) => {
      if (this.livePending) this.livePending.reject(staleSearchError());
      this.livePending = { query, topK, minScore, options, resolve, reject }; this.pumpLiveSearch();
    });
  }
  async pumpLiveSearch() {
    if (this.liveRunning || !this.livePending) return; const request = this.livePending; this.livePending = null; this.liveRunning = true;
    try { const results = await this.search(request.query, request.topK, request.minScore, request.options); if (this.livePending) request.reject(staleSearchError()); else request.resolve(results); }
    catch (error) { request.reject(error); }
    finally { this.liveRunning = false; if (this.livePending) this.pumpLiveSearch(); }
  }
  async search(query, topK, minScore, options = {}) {
    if (!this.vectors.length) throw new Error(this.message || 'The semantic index is not ready');
    const cacheKey = JSON.stringify([String(query).trim().toLowerCase(), topK, minScore, options.scoreWindow, options.folderPathBoost, Boolean(options.semanticHighlights), options.resultMinScore, options.singleWordMinScore, options.phraseMinScore, options.maxPhrases, options.highlightLimit || 15, options.file || '']);
    const cached = this.resultCache.get(cacheKey); if (cached) { this.cacheResult(this.resultCache, cacheKey, cached, 80); return cached; }
    const queryVector = await this.queryVector(query); const queryTokens = [...new Set(tokens(query))]; const scores = [];
    for (let i = 0; i < this.vectors.length; i++) {
      if (options.file && this.meta[i].file !== options.file) continue; const semantic = dotPacked(queryVector, this.packedVectors, i * DIMENSION); if (semantic < minScore) continue;
      const filenameBoost = lexicalCoverage(queryTokens, this.lexical[i].filename) * .05; const folderPathBoost = (options.folderPathBoost || 0) * lexicalCoverage(queryTokens, this.lexical[i].folder);
      scores.push({ index: i, score: semantic, rankingScore: semantic + filenameBoost + folderPathBoost, filenameBoost, folderPathBoost });
    }
    scores.sort((a, b) => b.rankingScore - a.rankingScore); const floor = (scores[0]?.score || 0) - Math.max(0, Math.min(1, options.scoreWindow ?? 1)); const top = scores.filter(item => item.score >= floor).slice(0, topK);
    const results = top.map(item => ({ ...this.meta[item.index], passageIndex: item.index, score: Math.min(1, item.rankingScore), semanticScore: item.score, rankingScore: Math.min(1, item.rankingScore), filenameBoost: item.filenameBoost, folderPathBoost: item.folderPathBoost }));
    if (options.semanticHighlights && results.length) await this.semanticHighlights(results, queryVector, { ...options, query }); return this.cacheResult(this.resultCache, cacheKey, results, 80);
  }
  async scores(query) { const vector = await this.queryVector(query); const scores = {}; this.meta.forEach((item, index) => { const score = dotPacked(vector, this.packedVectors, index * DIMENSION); scores[item.file] = Math.max(scores[item.file] || -1, score); }); return scores; }
  async graph(k = 5, maxEdges = 2000) {
    const groups = new Map(); this.meta.forEach((item, index) => { const group = groups.get(item.file) || []; group.push(this.vectors[index]); groups.set(item.file, group); });
    const nodes = [...groups].map(([id, vectors]) => { const vector = new Float32Array(DIMENSION); vectors.forEach(value => value.forEach((number, index) => vector[index] += number)); let norm = Math.sqrt(dot(vector, vector)) || 1; vector.forEach((_, index) => vector[index] /= norm); return { id, label: basename(id), vector }; });
    const edges = []; for (let i = 0; i < nodes.length; i++) { const near = []; for (let j = 0; j < nodes.length; j++) if (i !== j) near.push({ source: nodes[i].id, target: nodes[j].id, score: dot(nodes[i].vector, nodes[j].vector), hard: false }); near.sort((a, b) => b.score - a.score); edges.push(...near.slice(0, k)); }
    return { nodes: nodes.map(({ id, label }) => ({ id, label })), edges: edges.slice(0, maxEdges) };
  }
}
