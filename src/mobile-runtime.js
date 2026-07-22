import { pipeline, env } from '@huggingface/transformers';
import nlp from 'compromise';

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const DIMENSION = 384;
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const INDEXABLE = new Set(['md', 'txt', 'markdown']);
const STOP_WORDS = new Set(['a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'been', 'being', 'between', 'but', 'by', 'can', 'could', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'in', 'into', 'is', 'it', 'its', 'may', 'might', 'more', 'my', 'not', 'of', 'on', 'or', 'our', 'out', 'over', 'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'they', 'this', 'those', 'through', 'to', 'under', 'up', 'vs', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'with', 'without', 'would', 'you', 'your']);

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
function dot(a, b) { let score = 0; for (let i = 0; i < a.length; i++) score += a[i] * b[i]; return score; }
function dotPacked(query, packed, offset) { let score = 0; for (let i = 0; i < DIMENSION; i += 4) score += query[i] * packed[offset + i] + query[i + 1] * packed[offset + i + 1] + query[i + 2] * packed[offset + i + 2] + query[i + 3] * packed[offset + i + 3]; return score; }
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
function spanCandidates(sentenceRecord, wordScores, anchors, maximum = 32) {
  const words = sentenceRecord.words; const seeded = new Set(words.filter(word => anchors.has(word.lemma)).map(word => word.index));
  words.filter(word => !word.stop && word.text.length >= 3).sort((a, b) => (wordScores.get(b.text.toLowerCase()) || 0) - (wordScores.get(a.text.toLowerCase()) || 0)).slice(0, 8).forEach(word => seeded.add(word.index));
  const found = [];
  for (let start = 0; start < words.length; start++) for (let size = 1; size <= 3 && start + size <= words.length; size++) {
    const slice = words.slice(start, start + size); if (slice[0].stop || slice.at(-1).stop || !slice.some(word => seeded.has(word.index))) continue;
    if (size === 1 && slice[0].text.length < 3) continue;
    const anchorCount = new Set(slice.filter(word => anchors.has(word.lemma)).map(word => word.lemma)).size;
    const seedScore = Math.max(...slice.map(word => wordScores.get(word.text.toLowerCase()) || 0));
    const phrase = slice.map(word => word.text).join(' '); const key = phrase.toLowerCase(); if (found.some(item => item.key === key)) continue;
    found.push({ key, phrase, sentence: sentenceRecord.sentence, sentenceScore: sentenceRecord.score, field: sentenceRecord.field, resultIndex: sentenceRecord.resultIndex, start, end: start + size - 1, words: size, anchorCount, seedScore, priority: anchorCount * .12 + seedScore + (size > 1 ? .025 : 0) });
  }
  return found.sort((a, b) => b.priority - a.priority).slice(0, maximum);
}
function removePhrase(sentence, phrase) {
  const index = sentence.toLowerCase().indexOf(phrase.toLowerCase());
  return index < 0 ? sentence : `${sentence.slice(0, index)} ${sentence.slice(index + phrase.length)}`.replace(/\s+/g, ' ').trim();
}
function phraseStructure(phrase) {
  const terms = nlp(phrase).terms().json().flatMap(item => item.terms || []); const tags = new Set(terms.flatMap(term => term.tags || []));
  const hasNoun = tags.has('Noun') || tags.has('ProperNoun'); const hasVerb = tags.has('Verb'); const hasExpression = tags.has('Expression'); const adjectiveOnly = tags.has('Adjective') && !hasNoun && !hasVerb;
  return { hasNoun, hasVerb, hasExpression, adjectiveOnly, quality: (hasNoun ? .018 : 0) + (hasNoun && hasVerb ? .025 : 0) + (hasExpression ? .03 : 0) };
}

export class MobileSearchRuntime {
  constructor(plugin) {
    this.plugin = plugin; this.adapter = plugin.app.vault.adapter; this.isMobile = plugin.isMobile; this.meta = []; this.vectors = []; this.packedVectors = new Float32Array(); this.lexical = [];
    this.pipe = null; this.modelPromise = null; this.startPromise = null; this.enabled = false; this.cancelRequested = false; this.phase = 'offline'; this.message = 'Semantic search is not started'; this.lastEvent = this.message; this.lastError = ''; this.process = null;
    this.listeners = new Set(); this.phraseCache = new Map(); this.updateTimer = null; this.indexRun = null; this.indexAgain = false; this.indexForce = false; this.startedAt = Date.now(); this.phaseStartedAt = this.startedAt;
    this.processedFiles = 0; this.totalFiles = 0; this.currentFile = ''; this.lastSuccessfulIndexAt = null;
    this.legacyIndexDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/embeddings/bge-small-en-v1.5-mobile`;
    this.indexKey = `${plugin.manifest.id}:${plugin.app.vault.adapter.getBasePath?.() || plugin.app.vault.getName()}:bge-small-en-v1.5`;
    this.database = null; this.queryCache = new Map(); this.resultCache = new Map(); this.livePending = null; this.liveRunning = false; this.modelBackend = 'wasm';
  }
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed() { for (const listener of this.listeners) listener(); }
  setState(phase, message) { if (phase !== this.phase) this.phaseStartedAt = Date.now(); this.phase = phase; this.message = message; this.lastEvent = message; this.lastError = phase === 'error' ? message : ''; this.changed(); }
  workerStatus() { return { phase: this.phase, message: this.message, pid: 'mobile', startedAt: this.startedAt, phaseStartedAt: this.phaseStartedAt, updatedAt: Date.now(), indexedFiles: new Set(this.meta.map(item => item.file)).size, totalChunks: this.meta.length, processedFiles: this.processedFiles, totalFiles: this.totalFiles || this.vaultFiles || 0, currentFile: this.currentFile, lastSuccessfulIndexAt: this.lastSuccessfulIndexAt }; }
  async health() { return { indexedFiles: new Set(this.meta.map(item => item.file)).size, totalChunks: this.meta.length, vaultFiles: this.vaultFiles || 0, staleFiles: this.staleFiles || 0, isIndexing: this.phase === 'indexing', modelLoaded: Boolean(this.pipe || this.plugin.desktopEmbedder?.ready), modelProfile: 'bge', modelId: MODEL_ID, modelBackend: this.isMobile ? this.modelBackend : 'worker-wasm' }; }
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
    if (!this.isMobile && this.plugin.desktopEmbedder) return this.plugin.desktopEmbedder.embedBatch(texts, query);
    await this.initializeModel(); const results = [];
    const batchSize = preferredBatchSize || (query ? 8 : 2);
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
  async loadIndex() {
    try {
      let stored = await this.databaseGet(); if (!stored) { await this.migrateLegacyIndex(); stored = await this.databaseGet(); } if (!stored) return;
      this.meta = stored.meta || []; this.lastSuccessfulIndexAt = stored.lastSuccessfulIndexAt || null; const all = new Float32Array(stored.vectors);
      if (all.length !== this.meta.length * DIMENSION) throw new Error('Index dimensions do not match BGE');
      this.packedVectors = all; this.vectors = this.meta.map((_, index) => all.subarray(index * DIMENSION, (index + 1) * DIMENSION)); this.refreshLexical();
    } catch { this.meta = []; this.vectors = []; this.packedVectors = new Float32Array(); this.refreshLexical(); }
  }
  async saveIndex() {
    const packed = new Float32Array(this.vectors.length * DIMENSION);
    this.vectors.forEach((vector, index) => packed.set(vector, index * DIMENSION));
    this.packedVectors = packed; this.vectors = this.meta.map((_, index) => packed.subarray(index * DIMENSION, (index + 1) * DIMENSION)); this.queryCache.clear(); this.resultCache.clear();
    await this.databasePut({ meta: this.meta, vectors: packed.buffer, lastSuccessfulIndexAt: this.lastSuccessfulIndexAt }); this.refreshLexical();
  }
  storageBytes() { return this.vectors.length * DIMENSION * 4 + new TextEncoder().encode(JSON.stringify(this.meta)).length; }
  files() { return this.plugin.app.vault.getFiles().filter(file => INDEXABLE.has(file.extension.toLowerCase())); }
  async updateIndex(force = false) {
    if (this.indexRun) { this.indexAgain = true; this.indexForce ||= force; return this.indexRun; }
    this.indexRun = (async () => {
      let nextForce = force;
      do { this.indexAgain = false; this.indexForce = false; await this.performIndexUpdate(nextForce); nextForce = this.indexForce; } while (this.indexAgain && this.enabled && !this.cancelRequested);
    })();
    try { return await this.indexRun; } finally { this.indexRun = null; }
  }
  async performIndexUpdate(force = false) {
    this.setState('indexing', 'Checking the semantic index…'); const files = this.files(); this.vaultFiles = files.length; this.totalFiles = files.length; this.currentFile = '';
    const indexed = new Map(this.meta.map(item => [item.file, item.mtime]));
    const changed = files.filter(file => force || indexed.get(file.path) !== file.stat.mtime); const present = new Set(files.map(file => file.path));
    const remove = new Set([...changed.map(file => file.path), ...this.meta.filter(item => !present.has(item.file)).map(item => item.file)]); this.staleFiles = changed.length;
    this.plugin.logDiagnostic(`Scan complete: ${files.length} files; ${changed.length} need indexing`);
    this.processedFiles = Math.max(0, files.length - changed.length);
    if (!remove.size) { this.staleFiles = 0; this.processedFiles = files.length; this.lastSuccessfulIndexAt = Date.now(); this.setState('ready', `Ready (${files.length} files, ${this.meta.length} passages)`); return; }
    const meta = []; const vectors = []; let checkpointAt = Date.now(); for (let i = 0; i < this.meta.length; i++) if (!remove.has(this.meta[i].file)) { meta.push(this.meta[i]); vectors.push(this.vectors[i]); }
    for (let fileIndex = 0; fileIndex < changed.length; fileIndex++) {
      if (this.cancelRequested || !this.enabled) return;
      const file = changed[fileIndex]; const fileStartedAt = Date.now(); this.currentFile = file.path; this.setState('indexing', `Indexing ${this.processedFiles + 1} of ${files.length}: ${file.path}`);
      try {
        const content = await this.plugin.app.vault.cachedRead(file); const chunks = chunkMarkdown(content); const embedded = await this.embedBatch(chunks.map(chunk => embeddingText(file.path, chunk)));
        chunks.forEach((chunk, index) => { meta.push({ file: file.path, heading: chunk.heading, text: chunk.text, lineStart: chunk.lineStart, lineEnd: chunk.lineEnd, mtime: file.stat.mtime }); vectors.push(embedded[index]); });
        this.plugin.logDiagnostic(`Indexed ${file.path}: ${new TextEncoder().encode(content).length} bytes, ${chunks.length} chunks in ${Date.now() - fileStartedAt} ms`);
      } catch (error) { this.plugin.reportOnce(`Could not index ${file.path}: ${error.message}`); }
      this.processedFiles++;
      if (Date.now() - checkpointAt >= 30000) { this.meta = meta; this.vectors = vectors; await this.saveIndex(); checkpointAt = Date.now(); this.plugin.logDiagnostic(`Saved index checkpoint: ${this.processedFiles}/${files.length} files`); }
      await yieldToUi();
    }
    if (this.cancelRequested || !this.enabled) return;
    this.meta = meta; this.vectors = vectors; this.lastSuccessfulIndexAt = Date.now(); await this.saveIndex(); this.staleFiles = 0; this.currentFile = ''; this.processedFiles = files.length; this.setState('ready', `Ready (${files.length} files, ${this.meta.length} passages)`);
  }
  start() {
    if (!this.plugin.settings.enabled) { this.setState('offline', 'Semantic index is disabled'); return false; }
    if (this.startPromise) return false; this.enabled = true; this.cancelRequested = false;
    this.startPromise = (async () => { try { await this.loadIndex(); await this.cleanupLegacyGeneratedData(); await this.updateIndex(); } catch (error) { this.setState('error', error.message); this.plugin.reportOnce(error.message); } finally { this.startPromise = null; } })();
    return true;
  }
  stop() { this.cancelRequested = true; this.enabled = false; clearTimeout(this.updateTimer); this.updateTimer = null; if (this.livePending) { this.livePending.reject(staleSearchError()); this.livePending = null; } this.setState('offline', 'Semantic search is paused'); return true; }
  restart() { this.stop(); const resume = () => this.startPromise ? setTimeout(resume, 100) : this.start(); resume(); return true; }
  rebuild() { this.stop(); const rebuild = () => { if (this.startPromise) return setTimeout(rebuild, 100); this.meta = []; this.vectors = []; this.packedVectors = new Float32Array(); this.queryCache.clear(); this.resultCache.clear(); this.refreshLexical(); this.enabled = true; this.cancelRequested = false; this.startPromise = (async () => { try { await this.updateIndex(true); } catch (error) { this.setState('error', error.message); } finally { this.startPromise = null; } })(); }; rebuild(); return true; }
  watch() {
    const schedule = file => { if (!this.enabled || !file?.path || !INDEXABLE.has(String(file.extension || '').toLowerCase())) return; clearTimeout(this.updateTimer); this.updateTimer = setTimeout(() => { this.updateTimer = null; this.updateIndex(); }, 1800); };
    this.plugin.registerEvent(this.plugin.app.vault.on('create', schedule)); this.plugin.registerEvent(this.plugin.app.vault.on('modify', schedule)); this.plugin.registerEvent(this.plugin.app.vault.on('delete', schedule)); this.plugin.registerEvent(this.plugin.app.vault.on('rename', schedule));
  }
  async cachedPassageVectors(texts) {
    const unique = []; const seen = new Set();
    for (const text of texts) { const key = String(text || '').trim().toLowerCase(); if (key && !seen.has(key) && !this.phraseCache.has(key)) { seen.add(key); unique.push(String(text).trim()); } }
    const vectors = await this.embedBatch(unique, false, 8); unique.forEach((text, index) => this.phraseCache.set(text.toLowerCase(), vectors[index]));
    if (this.phraseCache.size > 2200) for (const key of [...this.phraseCache.keys()].slice(0, this.phraseCache.size - 1800)) this.phraseCache.delete(key);
    return text => this.phraseCache.get(String(text || '').trim().toLowerCase());
  }
  async semanticHighlights(results, queryVector, options) {
    const anchors = queryAnchors(options.query); const sentenceRecords = [];
    results.slice(0, 15).forEach((result, resultIndex) => {
      if (result.score < options.resultMinScore) return;
      const add = (field, source, maximum) => contextualSentences(source, maximum).forEach(sentence => sentenceRecords.push({ resultIndex, field, sentence, words: sentenceWords(sentence) }));
      add('filename', basename(result.file), 1); add('heading', result.heading, 2); add('body', result.text, 12);
    });
    const sentenceVector = await this.cachedPassageVectors(sentenceRecords.map(item => item.sentence));
    sentenceRecords.forEach(item => { item.score = dot(queryVector, sentenceVector(item.sentence)); item.anchorCount = new Set(item.words.filter(word => anchors.has(word.lemma)).map(word => word.lemma)).size; });
    const selectedSentences = [];
    for (let resultIndex = 0; resultIndex < Math.min(15, results.length); resultIndex++) for (const field of ['filename', 'heading', 'body']) {
      const values = sentenceRecords.filter(item => item.resultIndex === resultIndex && item.field === field).sort((a, b) => (b.score + b.anchorCount * .04) - (a.score + a.anchorCount * .04));
      selectedSentences.push(...values.slice(0, field === 'body' ? 1 : 2));
    }
    const contentWords = [...new Set(selectedSentences.flatMap(item => item.words.filter(word => !word.stop && word.text.length >= 3).map(word => word.text)))];
    const wordVector = await this.cachedPassageVectors(contentWords); const wordScores = new Map(contentWords.map(word => [word.toLowerCase(), dot(queryVector, wordVector(word))]));
    const candidates = selectedSentences.flatMap(item => spanCandidates(item, wordScores, anchors));
    const phraseVector = await this.cachedPassageVectors(candidates.map(item => item.phrase));
    candidates.forEach(item => { item.directScore = dot(queryVector, phraseVector(item.phrase)); item.structure = phraseStructure(item.phrase); item.preScore = item.directScore + item.anchorCount * .045 + (item.words > 1 ? .015 : 0) + item.structure.quality; });
    const finalists = [];
    for (let resultIndex = 0; resultIndex < Math.min(15, results.length); resultIndex++) for (const field of ['filename', 'heading', 'body']) finalists.push(...candidates.filter(item => item.resultIndex === resultIndex && item.field === field).sort((a, b) => b.preScore - a.preScore).slice(0, field === 'body' ? 10 : 5));
    finalists.forEach(item => { item.masked = removePhrase(item.sentence, item.phrase) || 'unrelated text'; });
    const maskedVector = await this.cachedPassageVectors(finalists.map(item => item.masked));
    finalists.forEach(item => {
      item.attribution = item.sentenceScore - dot(queryVector, maskedVector(item.masked));
      item.confidence = item.directScore + Math.max(-.04, Math.min(.12, item.attribution * 1.75)) + item.anchorCount * .025;
      item.rankScore = item.confidence + item.anchorCount * .05 + (item.words > 1 ? .02 : 0) + item.words * .012 + item.structure.quality;
    });
    for (let resultIndex = 0; resultIndex < Math.min(15, results.length); resultIndex++) {
      const choose = (field, maximum) => { const chosen = []; for (const item of finalists.filter(value => value.resultIndex === resultIndex && value.field === field).sort((a, b) => b.rankScore - a.rankScore)) {
        const threshold = item.words === 1 ? options.singleWordMinScore : options.phraseMinScore; const contextualAnchor = item.anchorCount > 0 && item.sentenceScore >= options.resultMinScore && item.directScore >= threshold - .08;
        const contextualExpression = item.words > 1 && item.sentenceScore >= options.resultMinScore && item.directScore >= threshold - .14;
        if (item.words === 1 && item.structure.adjectiveOnly && item.anchorCount === 0 && item.directScore < threshold + .06) continue;
        if (item.words > 1 && !item.structure.hasNoun && !item.structure.hasExpression && item.anchorCount === 0 && item.directScore < threshold + .08) continue;
        if (item.confidence < threshold && !contextualAnchor && !contextualExpression) continue;
        if (chosen.some(value => value.sentence === item.sentence && !(item.end < value.start || item.start > value.end))) continue;
        chosen.push({ phrase: item.phrase, score: item.confidence, sentence: item.sentence, start: item.start, end: item.end }); if (chosen.length === maximum) break;
      } return chosen.map(({ phrase, score }) => ({ phrase, score })); };
      results[resultIndex].filenameHighlights = choose('filename', 2); results[resultIndex].headingHighlights = choose('heading', 2); results[resultIndex].semanticHighlights = choose('body', options.maxPhrases);
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
    if (!this.vectors.length) throw new Error(this.message || 'The semantic index is not ready'); await this.initializeModel();
    const cacheKey = JSON.stringify([String(query).trim().toLowerCase(), topK, minScore, options.scoreWindow, options.folderPathBoost, Boolean(options.semanticHighlights), options.resultMinScore, options.singleWordMinScore, options.phraseMinScore, options.maxPhrases, options.file || '']);
    const cached = this.resultCache.get(cacheKey); if (cached) { this.cacheResult(this.resultCache, cacheKey, cached, 80); return cached; }
    const queryVector = await this.queryVector(query); const queryTokens = [...new Set(tokens(query))]; const scores = [];
    for (let i = 0; i < this.vectors.length; i++) {
      if (options.file && this.meta[i].file !== options.file) continue; const semantic = dotPacked(queryVector, this.packedVectors, i * DIMENSION); if (semantic < minScore) continue;
      const filenameBoost = lexicalCoverage(queryTokens, this.lexical[i].filename) * .05; const folderPathBoost = (options.folderPathBoost || 0) * lexicalCoverage(queryTokens, this.lexical[i].folder);
      scores.push({ index: i, score: semantic, rankingScore: semantic + filenameBoost + folderPathBoost, filenameBoost, folderPathBoost });
    }
    scores.sort((a, b) => b.rankingScore - a.rankingScore); const floor = (scores[0]?.score || 0) - Math.max(0, Math.min(1, options.scoreWindow ?? 1)); const top = scores.filter(item => item.score >= floor).slice(0, topK);
    const results = top.map(item => ({ ...this.meta[item.index], score: Math.min(1, item.rankingScore), semanticScore: item.score, rankingScore: Math.min(1, item.rankingScore), filenameBoost: item.filenameBoost, folderPathBoost: item.folderPathBoost }));
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
