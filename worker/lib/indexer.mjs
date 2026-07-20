/**
 * VaultIndexer — builds and queries the semantic index for a vault.
 *
 * Index is persisted as two files:
 *   - index.meta.json — chunk metadata (file, heading, text, line offsets, file mtime)
 *   - index.vectors.bin — raw Float32Array of all embeddings, contiguous
 *
 * Supports incremental updates: only re-embeds files whose mtime changed.
 */

import fs from 'fs';
import path from 'path';

import { chunkMarkdown } from './chunker.mjs';

const META_FILE = 'index.meta.json';
const VECTORS_FILE = 'index.vectors.bin';

// File extensions to index
const INDEXABLE_EXTENSIONS = new Set(['.md', '.txt', '.markdown']);

// Directories to skip
const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.gib-search']);

/**
 * @typedef {Object} ChunkMeta
 * @property {string} file - Relative path to vault root
 * @property {string} heading - Heading hierarchy
 * @property {string} text - Chunk text
 * @property {number} lineStart
 * @property {number} lineEnd
 * @property {number} mtime - File modification time (ms since epoch)
 */

/**
 * Build the text sent to the embedding model for a chunk.
 * Uses filename (not directory path) + heading for structural context.
 * Directory paths are organizational, not semantic — including them
 * inflates similarity between files in the same folder.
 * The stored chunk.text stays clean (for display in search results).
 */
function buildEmbeddingText(filePath, chunk) {
  // "notes/auth/OAuth2-setup.md" → "OAuth2-setup"
  const basename = path.basename(filePath).replace(/\.md$|\.txt$|\.markdown$/i, '');
  const heading = chunk.heading ? `\n${chunk.heading}` : '';
  return `${basename}${heading}\n\n${chunk.text}`;
}

function retrievalTokens(source) {
  return (String(source || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(token => token.length > 2)
    .map(token => token.replace(/ies$/, 'y').replace(/ing$/, '').replace(/s$/, ''));
}

function lexicalCoverage(queryTokens, sourceTokens) {
  if (queryTokens.length === 0) return 0;
  return queryTokens.filter(token => sourceTokens.has(token)).length / queryTokens.length;
}

function extractSemanticPhrases(source) {
  const plain = String(source || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?(?:\[\[|\[)([^\]|\]]+)(?:\|[^\]]+)?(?:\]\]|\](?:\([^)]*\))?)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )\s*/gm, '')
    .replace(/[*_~=#|<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return [];
  const phrases = [];
  const clauses = plain.split(/(?<=[.!?])\s+|\s*[;:—–]\s*|\s*,\s*(?=[A-Z])/).map(part => part.trim()).filter(Boolean);
  for (const clause of clauses) {
    const words = clause.split(/\s+/).filter(Boolean);
    if (words.length >= 4 && words.length <= 9 && clause.length <= 90) {
      phrases.push(clause.replace(/[.!?,]+$/, ''));
      continue;
    }
    if (words.length > 9) {
      const windowSize = 8;
      for (let start = 0; start < words.length; start += 5) {
        const window = words.slice(start, start + windowSize);
        if (window.length < 4) break;
        phrases.push(window.join(' ').replace(/[.!?,]+$/, ''));
      }
    }
  }
  return [...new Set(phrases.filter(phrase => phrase.length >= 18 && phrase.length <= 90))];
}

function sampleEvenly(items, limit) {
  if (items.length <= limit) return items;
  const sampled = [];
  for (let i = 0; i < limit; i++) sampled.push(items[Math.round(i * (items.length - 1) / (limit - 1))]);
  return sampled;
}

const HIGHLIGHT_STOP_WORDS = new Set(['a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'been', 'being', 'between', 'break', 'but', 'by', 'can', 'could', 'do', 'does', 'down', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'i', 'in', 'into', 'is', 'it', 'its', 'may', 'might', 'my', 'not', 'of', 'on', 'or', 'our', 'out', 'over', 'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'they', 'this', 'to', 'under', 'up', 'vs', 'was', 'we', 'were', 'what', 'when', 'where', 'while', 'will', 'with', 'without', 'would', 'you', 'your']);
const HIGHLIGHT_BREAK_WORDS = new Set(['and', 'because', 'break', 'but', 'or', 'that', 'then', 'vs', 'when', 'where', 'while']);
const HIGHLIGHT_GENERIC_WORDS = new Set(['define', 'defined', 'defines', 'defining']);
function extractCompactSubphrases(phrase) {
  phrase = String(phrase).replace(/[,;:!?()\[\]{}<>/\\|—–-]+|\b(?:and|because|but|or|that|then|vs\.?|when|where|while)\b/giu, ' BREAK ');
  const words = phrase.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  const candidates = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length >= 4 && !HIGHLIGHT_STOP_WORDS.has(word.toLowerCase())) candidates.push(word);
    for (let size = 2; size <= 3; size++) {
      const slice = words.slice(i, i + size);
      if (slice.length === size && slice.every(token => token.replace(/[^\p{L}\p{N}]/gu, '').length > 1) && slice.some(token => !HIGHLIGHT_STOP_WORDS.has(token.toLowerCase())) && !slice.some(token => HIGHLIGHT_BREAK_WORDS.has(token.toLowerCase()))) candidates.push(slice.join(' '));
    }
  }
  return [...new Set(candidates)];
}

function highlightTokenKey(token) {
  let value = token.toLowerCase().replace(/[’']s$/, '').replace(/[^\p{L}\p{N}]/gu, '');
  if (value.endsWith('ing') && value.length > 6) value = value.slice(0, -3);
  else if (value.endsWith('ies') && value.length > 5) value = `${value.slice(0, -3)}y`;
  else if (value.endsWith('s') && !value.endsWith('ss') && value.length > 4) value = value.slice(0, -1);
  return value;
}

function phraseRanges(source, phrase) {
  const haystack = String(source || '').toLowerCase(); const needle = String(phrase || '').toLowerCase(); const ranges = [];
  if (!needle) return ranges;
  let start = 0;
  while ((start = haystack.indexOf(needle, start)) !== -1) { ranges.push({ start, end: start + needle.length }); start += Math.max(1, needle.length); }
  return ranges;
}

/**
 * Map a normalized PCA position (pc1n, pc2n ∈ [0,1]) to an earthy HSL color.
 * Direction in PCA space → hue (full 360°, offset so warm browns sit at 0).
 * Distance from center → saturation/lightness ramp (more vivid at the edges).
 * Low saturation + medium-high lightness keeps the palette earthy and
 * dark-mode friendly: terracotta, ochre, olive, sage, teal, slate, mauve.
 */
function pcaToEarthyColor(pc1n, pc2n) {
  const dx = pc1n - 0.5;
  const dy = pc2n - 0.5;
  const angle = Math.atan2(dy, dx); // -π to π
  const radius = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);

  // Hue: full circle, +30° offset so the warm side starts at "right" of PCA
  const hueDeg = (((angle / Math.PI) * 180) + 360 + 30) % 360;
  const sat = 28 + radius * 22;   // 28-50% — earthy, never neon
  const light = 60 + radius * 8;  // 60-68% — pops on dark backgrounds
  return `hsl(${Math.round(hueDeg)}, ${Math.round(sat)}%, ${Math.round(light)}%)`;
}

export class VaultIndexer {
  constructor(engine, vaultPath, indexPath) {
    this.engine = engine;
    this.vaultPath = vaultPath;
    this.indexPath = indexPath;

    /** @type {ChunkMeta[]} */
    this.meta = [];
    /** @type {Float32Array[]} */
    this.vectors = [];

    this.isIndexing = false;
    this.vaultFileCount = 0;
    this.staleFileCount = 0;
    this.lexicalMeta = [];

    /** @type {((status: {indexedFiles: number, totalChunks: number}) => void) | null} */
    this.onIndexChanged = null;
    /** @type {((status: {processedFiles: number, totalFiles: number, currentFile: string}) => void) | null} */
    this.onIndexProgress = null;
  }

  /**
   * Initialize: load existing index from disk, then update with any changed files.
   */
  async initialize() {
    this.loadFromDisk();
    await this.updateIndex();
  }

  /**
   * Load persisted index from disk.
   */
  loadFromDisk() {
    const metaPath = path.join(this.indexPath, META_FILE);
    const vectorsPath = path.join(this.indexPath, VECTORS_FILE);

    if (!fs.existsSync(metaPath) || !fs.existsSync(vectorsPath)) {
      this.meta = [];
      this.vectors = [];
      return;
    }

    try {
      const metaJson = fs.readFileSync(metaPath, 'utf-8');
      this.meta = JSON.parse(metaJson);
      this.refreshLexicalMeta();

      const vectorsBuf = fs.readFileSync(vectorsPath);
      const dim = this.engine.getDimension();
      const allFloats = new Float32Array(vectorsBuf.buffer, vectorsBuf.byteOffset, vectorsBuf.byteLength / 4);

      this.vectors = [];
      for (let i = 0; i < this.meta.length; i++) {
        const start = i * dim;
        this.vectors.push(allFloats.slice(start, start + dim));
      }

      process.stderr.write(`[gib-search] Loaded index: ${this.meta.length} chunks\n`);
    } catch (err) {
      process.stderr.write(`[gib-search] Failed to load index: ${err.message}\n`);
      this.meta = [];
      this.vectors = [];
    }
  }

  /**
   * Save current index to disk.
   */
  saveToDisk() {
    const metaPath = path.join(this.indexPath, META_FILE);
    const vectorsPath = path.join(this.indexPath, VECTORS_FILE);

    fs.writeFileSync(metaPath, JSON.stringify(this.meta), 'utf-8');
    this.refreshLexicalMeta();

    const dim = this.engine.getDimension();
    const buf = new Float32Array(this.meta.length * dim);
    for (let i = 0; i < this.vectors.length; i++) {
      buf.set(this.vectors[i], i * dim);
    }

    fs.writeFileSync(vectorsPath, Buffer.from(buf.buffer));
    process.stderr.write(`[gib-search] Saved index: ${this.meta.length} chunks\n`);

    if (this.onIndexChanged) {
      const indexedFiles = new Set(this.meta.map((c) => c.file)).size;
      this.onIndexChanged({ indexedFiles, totalChunks: this.meta.length });
    }
  }

  /**
   * Scan vault and update index for changed/new/deleted files.
   */
  async updateIndex() {
    this.isIndexing = true;

    try {
      // Collect all indexable files with mtimes
      const vaultFiles = this.scanVault();
      this.vaultFileCount = vaultFiles.size;

      // Build a set of currently indexed files → their mtime
      const indexedFiles = new Map();
      for (const chunk of this.meta) {
        indexedFiles.set(chunk.file, chunk.mtime);
      }

      // Find files that need re-indexing
      const toReindex = [];
      for (const [filePath, mtime] of vaultFiles) {
        const existingMtime = indexedFiles.get(filePath);
        if (existingMtime === undefined || existingMtime !== mtime) {
          toReindex.push({ filePath, mtime });
        }
      }

      // Find files that were deleted
      const vaultFileSet = new Set(vaultFiles.keys());
      const deletedFiles = new Set();
      for (const chunk of this.meta) {
        if (!vaultFileSet.has(chunk.file)) {
          deletedFiles.add(chunk.file);
        }
      }

      this.staleFileCount = toReindex.length;
      let processedFiles = Math.max(0, vaultFiles.size - toReindex.length);
      if (this.onIndexProgress) this.onIndexProgress({ processedFiles, totalFiles: vaultFiles.size, currentFile: '' });

      if (toReindex.length === 0 && deletedFiles.size === 0) {
        process.stderr.write('[gib-search] Index is up to date\n');
        return;
      }

      process.stderr.write(
        `[gib-search] Updating: ${toReindex.length} changed, ${deletedFiles.size} deleted\n`
      );

      // Remove chunks for deleted and stale files
      const removeFiles = new Set([...deletedFiles, ...toReindex.map((f) => f.filePath)]);
      const newMeta = [];
      const newVectors = [];
      for (let i = 0; i < this.meta.length; i++) {
        if (!removeFiles.has(this.meta[i].file)) {
          newMeta.push(this.meta[i]);
          newVectors.push(this.vectors[i]);
        }
      }

      // Index new/changed files
      for (const { filePath, mtime } of toReindex) {
        if (this.onIndexProgress) this.onIndexProgress({ processedFiles, totalFiles: vaultFiles.size, currentFile: filePath });
        const absPath = path.join(this.vaultPath, filePath);
        let content;
        try {
          content = fs.readFileSync(absPath, 'utf-8');
        } catch {
          processedFiles++;
          if (this.onIndexProgress) this.onIndexProgress({ processedFiles, totalFiles: vaultFiles.size, currentFile: filePath });
          continue; // File may have been deleted between scan and read
        }

        const chunks = chunkMarkdown(content, filePath);
        if (chunks.length === 0) {
          processedFiles++;
          if (this.onIndexProgress) this.onIndexProgress({ processedFiles, totalFiles: vaultFiles.size, currentFile: filePath });
          continue;
        }

        const texts = chunks.map((c) => buildEmbeddingText(filePath, c));
        const embeddings = await this.engine.embedBatch(texts);

        for (let i = 0; i < chunks.length; i++) {
          newMeta.push({
            file: filePath,
            heading: chunks[i].heading,
            text: chunks[i].text,
            lineStart: chunks[i].lineStart,
            lineEnd: chunks[i].lineEnd,
            mtime,
          });
          newVectors.push(embeddings[i]);
        }
        processedFiles++;
        if (this.onIndexProgress) this.onIndexProgress({ processedFiles, totalFiles: vaultFiles.size, currentFile: filePath });
      }

      this.meta = newMeta;
      this.vectors = newVectors;
      this.saveToDisk();
      this.staleFileCount = 0;
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Re-index a single file (called by watcher on file change/create).
   * @param {string} relativePath - Path relative to vault root
   */
  async reindexFile(relativePath) {
    const absPath = path.join(this.vaultPath, relativePath);
    const ext = path.extname(relativePath).toLowerCase();

    if (!INDEXABLE_EXTENSIONS.has(ext)) return;

    // Remove old chunks for this file
    const newMeta = [];
    const newVectors = [];
    for (let i = 0; i < this.meta.length; i++) {
      if (this.meta[i].file !== relativePath) {
        newMeta.push(this.meta[i]);
        newVectors.push(this.vectors[i]);
      }
    }

    // Re-chunk and embed if file still exists
    if (fs.existsSync(absPath)) {
      try {
        const stat = fs.statSync(absPath);
        const content = fs.readFileSync(absPath, 'utf-8');
        const chunks = chunkMarkdown(content, relativePath);

        if (chunks.length > 0) {
          const texts = chunks.map((c) => buildEmbeddingText(relativePath, c));
          const embeddings = await this.engine.embedBatch(texts);

          for (let i = 0; i < chunks.length; i++) {
            newMeta.push({
              file: relativePath,
              heading: chunks[i].heading,
              text: chunks[i].text,
              lineStart: chunks[i].lineStart,
              lineEnd: chunks[i].lineEnd,
              mtime: stat.mtimeMs,
            });
            newVectors.push(embeddings[i]);
          }
        }
      } catch (err) {
        process.stderr.write(`[gib-search] Error indexing ${relativePath}: ${err.message}\n`);
      }
    }

    this.meta = newMeta;
    this.vectors = newVectors;
    this.saveToDisk();
  }

  /**
   * Remove a file from the index (called by watcher on file delete).
   * @param {string} relativePath
   */
  removeFile(relativePath) {
    const newMeta = [];
    const newVectors = [];
    for (let i = 0; i < this.meta.length; i++) {
      if (this.meta[i].file !== relativePath) {
        newMeta.push(this.meta[i]);
        newVectors.push(this.vectors[i]);
      }
    }
    this.meta = newMeta;
    this.vectors = newVectors;
    this.saveToDisk();
  }

  /**
   * Search the index by cosine similarity.
   * @param {string} query
   * @param {number} topK
   * @param {number} minScore
   * @returns {Promise<Array<{file: string, heading: string, text: string, score: number, lineStart: number, lineEnd: number}>>}
   */
  async search(query, topK, minScore, highlightOptions = null, fileFilter = null, scoreWindow = 1, folderBoost = 0) {
    if (this.vectors.length === 0) return [];

    const queryVec = await this.engine.embed(query);

    // Compute cosine similarity with all chunks
    // (vectors are pre-normalized, so dot product = cosine similarity)
    const scores = [];
    const queryTokens = [...new Set(retrievalTokens(query))];
    const tuneBge = this.engine.getProfileName?.() === 'bge';
    for (let i = 0; i < this.vectors.length; i++) {
      if (fileFilter && this.meta[i].file !== fileFilter) continue;
      let dot = 0;
      for (let j = 0; j < queryVec.length; j++) {
        dot += queryVec[j] * this.vectors[i][j];
      }
      if (dot >= minScore) {
        let rankScore = dot;
        let filenameBoost = 0;
        let folderPathBoost = 0;
        if (tuneBge) {
          const lexical = this.lexicalMeta[i];
          // A restrained title signal improves intent without turning search
          // into literal keyword matching. Body meaning remains BGE-driven.
          filenameBoost = lexicalCoverage(queryTokens, lexical.filename) * 0.05;
          rankScore += filenameBoost;
        }
        if (folderBoost > 0) {
          folderPathBoost = lexicalCoverage(queryTokens, this.lexicalMeta[i].folder) * folderBoost;
          rankScore += folderPathBoost;
        }
        scores.push({ index: i, score: dot, rankScore, filenameBoost, folderPathBoost });
      }
    }

    // Sort by score descending, take top K
    scores.sort((a, b) => b.rankScore - a.rankScore);
    const bestScore = scores[0]?.score ?? 0;
    const relativeFloor = bestScore - Math.max(0, Math.min(1, scoreWindow));
    const topResults = scores.filter(item => item.score >= relativeFloor).slice(0, topK);

    const results = topResults.map((s) => ({
      file: this.meta[s.index].file,
      heading: this.meta[s.index].heading,
      text: this.meta[s.index].text,
      score: s.score,
      rankingScore: Math.min(1, Math.max(0, s.rankScore)),
      filenameBoost: s.filenameBoost,
      folderPathBoost: s.folderPathBoost,
      lineStart: this.meta[s.index].lineStart,
      lineEnd: this.meta[s.index].lineEnd,
    }));

    if (highlightOptions && results.length > 0) {
      await this.addSemanticHighlights(results, topResults, queryVec, highlightOptions, query);
    }
    return results;
  }

  refreshLexicalMeta() {
    this.lexicalMeta = this.meta.map(meta => ({
      filename: new Set(retrievalTokens(path.basename(meta.file).replace(/\.(?:md|txt|markdown)$/i, ''))),
      folder: new Set(retrievalTokens(path.dirname(meta.file))),
      heading: new Set(retrievalTokens(meta.heading)),
      body: new Set(retrievalTokens(meta.text)),
    }));
  }

  /**
   * Attribute a chunk match to short phrases using the same embedding model.
   * Work is deliberately capped so highlighting does not dominate search latency.
   */
  async addSemanticHighlights(results, topResults, queryVec, options, query = '') {
    const queryTokenList = retrievalTokens(query);
    const queryTokenSet = new Set(queryTokenList);
    const queryPhraseKeys = new Set();
    for (let size = 1; size <= Math.min(3, queryTokenList.length); size++) for (let i = 0; i + size <= queryTokenList.length; i++) queryPhraseKeys.add(queryTokenList.slice(i, i + size).join(' '));
    const candidates = [];
    const resultLimit = Math.min(results.length, 100);
    const candidateLimit = Math.min(600, Math.max(90, resultLimit * 8));
    for (let resultIndex = 0; resultIndex < resultLimit && candidates.length < candidateLimit; resultIndex++) {
      if (results[resultIndex].score < options.resultMinScore) continue;
      const meta = this.meta[topResults[resultIndex].index];
      const source = meta.text;
      const filename = path.basename(meta.file).replace(/\.(?:md|txt|markdown)$/i, '').trim();
      const headings = String(meta.heading || '').split(/\s*>\s*/).map(item => item.trim()).filter(Boolean);
      const attributedRegions = [
        ...filename.length >= 4 ? [{ phrase: filename, field: 'filename' }] : [],
        ...headings.filter(item => item.length >= 4 && item.split(/\s+/).length <= 9).map(phrase => ({ phrase, field: 'heading' })),
        ...(resultIndex < 15 ? sampleEvenly(extractSemanticPhrases(source), 6).map(phrase => ({ phrase, field: 'body' })) : []),
      ];
      const regionSeen = new Set();
      for (const region of attributedRegions) {
        const key = `${region.field}\0${region.phrase.toLowerCase()}`; if (regionSeen.has(key)) continue; regionSeen.add(key);
        candidates.push({ resultIndex, phrase: region.phrase, field: region.field });
        if (candidates.length >= candidateLimit) break;
      }
    }
    if (candidates.length === 0) return;
    const vectors = await this.engine.embedBatch(candidates.map(candidate => candidate.phrase));
    const ranked = new Map();
    for (let i = 0; i < candidates.length; i++) {
      let score = 0;
      for (let j = 0; j < queryVec.length; j++) score += queryVec[j] * vectors[i][j];
      const item = { phrase: candidates[i].phrase, score, field: candidates[i].field };
      const list = ranked.get(candidates[i].resultIndex) || [];
      list.push(item); ranked.set(candidates[i].resultIndex, list);
    }
    const compact = [];
    const compactSeen = new Set();
    for (const [resultIndex, phrases] of ranked) {
      phrases.sort((a, b) => b.score - a.score);
      for (const field of ['filename', 'heading', 'body']) {
        const fieldLimit = field === 'body' ? 4 : 1;
        for (const coarse of phrases.filter(phrase => phrase.field === field).slice(0, fieldLimit)) {
          for (const phrase of extractCompactSubphrases(coarse.phrase)) {
            const key = `${resultIndex}\0${coarse.field}\0${phrase.toLowerCase()}`;
            if (!compactSeen.has(key)) { compactSeen.add(key); compact.push({ resultIndex, phrase, field: coarse.field, parentScore: coarse.score }); }
            if (compact.length >= 1600) break;
          }
          if (compact.length >= 1600) break;
        }
        if (compact.length >= 1600) break;
      }
      if (compact.length >= 1600) break;
    }
    if (compact.length === 0) return;
    const compactVectors = await this.engine.embedBatch(compact.map(candidate => candidate.phrase));
    const compactRanked = new Map();
    for (let i = 0; i < compact.length; i++) {
      let score = 0;
      for (let j = 0; j < queryVec.length; j++) score += queryVec[j] * compactVectors[i][j];
      const words = compact[i].phrase.split(/\s+/).length;
      // Body prose contains many generic words. Only curated filenames and
      // headings may inherit region context; standalone body words must pass
      // on their own embedding score.
      const useRegionContext = compact[i].field !== 'body' && score >= 0.3;
      const contextualScore = useRegionContext ? Math.max(score, score * 0.3 + compact[i].parentScore * 0.7) : score;
      const item = { phrase: compact[i].phrase, score: contextualScore, directScore: score, field: compact[i].field, rankScore: contextualScore + (words === 2 ? 0.08 : words === 3 ? 0.04 : 0) };
      const list = compactRanked.get(compact[i].resultIndex) || [];
      list.push(item); compactRanked.set(compact[i].resultIndex, list);
    }
    for (const [resultIndex, phrases] of compactRanked) {
      const select = (field, maximum) => {
        const rankedPhrases = phrases.filter(phrase => phrase.field === field).sort((a, b) => b.rankScore - a.rankScore); const best = [];
        const fieldSource = field === 'filename' ? path.basename(results[resultIndex].file).replace(/\.(?:md|txt|markdown)$/i, '') : field === 'heading' ? results[resultIndex].heading : results[resultIndex].text;
        for (const phrase of rankedPhrases) {
          const wordCount = phrase.phrase.split(/\s+/).length;
          // Body semantic attribution is phrase-only. Single body words are
          // highlighted deterministically from query lemmas or propagated
          // from a validated filename/heading concept, never guessed from an
          // embedding score in isolation.
          if (field === 'body' && wordCount === 1) continue;
          const configuredMinimum = wordCount === 1 ? options.singleWordMinScore : options.phraseMinScore;
          // Filenames and headings are short, curated semantic labels. Once
          // their full region clears result confidence, compact concepts may
          // use that contextual threshold instead of the stricter standalone
          // body-word threshold.
          const minimumScore = field === 'body' ? configuredMinimum : Math.min(configuredMinimum, options.resultMinScore);
          if (phrase.score < minimumScore) continue;
          const tokens = new Set((phrase.phrase.match(/[\p{L}\p{N}’']+/gu) || []).map(highlightTokenKey).filter(Boolean));
          if ([...tokens].every(token => HIGHLIGHT_STOP_WORDS.has(token) || HIGHLIGHT_GENERIC_WORDS.has(token))) continue;
          const orderedTokens = phrase.phrase.split(/\s+/).map(highlightTokenKey).filter(Boolean);
          const edgeTokens = [orderedTokens[0], orderedTokens[orderedTokens.length - 1]].filter(Boolean);
          if (edgeTokens.some(token => HIGHLIGHT_STOP_WORDS.has(token) && !queryTokenSet.has(token))) continue;
          const queryOverlap = [...tokens].filter(token => queryTokenSet.has(token)).length;
          const nonQueryTokens = [...tokens].filter(token => !queryTokenSet.has(token));
          if (nonQueryTokens.length === 0 && queryPhraseKeys.has(retrievalTokens(phrase.phrase).join(' '))) continue;
          const substantiveRelated = nonQueryTokens.some(token => !HIGHLIGHT_STOP_WORDS.has(token) && !HIGHLIGHT_GENERIC_WORDS.has(token));
          if (queryOverlap > 0 && nonQueryTokens.length > 0 && !substantiveRelated) continue;
          if (best.some(existing => { const chosen = new Set((existing.phrase.match(/[\p{L}\p{N}’']+/gu) || []).map(highlightTokenKey).filter(Boolean)); const shared = [...tokens].filter(token => chosen.has(token)).length; return shared / Math.min(tokens.size || 1, chosen.size || 1) >= 0.75; })) continue;
          const ranges = phraseRanges(fieldSource, phrase.phrase);
          if (best.some(existing => ranges.some(range => existing.ranges.some(chosen => range.start < chosen.end && chosen.start < range.end)))) continue;
          best.push({ phrase: phrase.phrase, score: phrase.score, ranges }); if (best.length === maximum) break;
        }
        return best.map(({ phrase, score }) => ({ phrase, score }));
      };
      results[resultIndex].filenameHighlights = select('filename', 2);
      results[resultIndex].headingHighlights = select('heading', 2);
      const bodyHighlights = select('body', options.maxPhrases);
      const contextualTerms = [...results[resultIndex].filenameHighlights, ...results[resultIndex].headingHighlights]
        .filter(item => results[resultIndex].text.toLowerCase().includes(item.phrase.toLowerCase()));
      results[resultIndex].semanticHighlights = [...contextualTerms, ...bodyHighlights]
        .filter((item, index, all) => all.findIndex(other => other.phrase.toLowerCase() === item.phrase.toLowerCase()) === index)
        .slice(0, options.maxPhrases);
    }
  }

  /**
   * Compute per-file similarity scores for a query string.
   * Returns max chunk score per file (best-matching section wins).
   * @param {string} query
   * @returns {Promise<Record<string, number>>} file path → score
   */
  async queryFileScores(query) {
    if (this.vectors.length === 0) return {};

    const queryVec = await this.engine.embed(query);
    const dim = queryVec.length;

    // Max chunk score per file
    const fileScores = {};
    for (let i = 0; i < this.vectors.length; i++) {
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += queryVec[d] * this.vectors[i][d];
      const file = this.meta[i].file;
      if (fileScores[file] === undefined || dot > fileScores[file]) {
        fileScores[file] = dot;
      }
    }

    return fileScores;
  }

  /**
   * Compute file-level k-nearest-neighbor similarities for the research graph.
   * @param {number} k - Number of nearest neighbors per file (0 = all pairs)
   * @param {number} maxEdges - Safety cap on total edges returned
   * @param {boolean} useDict - Use category dictionary for colors (false = PCA)
   */
  /**
   * Compute average embedding per file, normalized to unit vectors.
   * Shared by getFileEdges() and PCA computation.
   * @returns {{ files: string[], fileVecs: Float32Array[] }}
   */
  _getFileVectors() {
    const dim = this.engine.getDimension();
    const fileChunks = new Map();
    for (let i = 0; i < this.meta.length; i++) {
      const file = this.meta[i].file;
      if (!fileChunks.has(file)) fileChunks.set(file, []);
      fileChunks.get(file).push(i);
    }

    const files = [];
    const fileVecs = [];
    for (const [file, indices] of fileChunks) {
      const avg = new Float32Array(dim);
      for (const idx of indices) {
        const vec = this.vectors[idx];
        for (let d = 0; d < dim; d++) avg[d] += vec[d];
      }
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += avg[d] * avg[d];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let d = 0; d < dim; d++) avg[d] /= norm;
      }
      files.push(file);
      fileVecs.push(avg);
    }

    return { files, fileVecs, dim };
  }

  getFileEdges(k = 5, maxEdges = 2000, useDict = false, mutual = false) {
    if (this.vectors.length === 0) return { edges: [], fileCount: 0, fileCategories: {}, categoryList: [], pcaValues: {}, pcaPositions: {} };

    const { files, fileVecs, dim } = this._getFileVectors();

    // --- Edges: k-NN per file, or all pairs if k=0 ---
    const edges = [];
    if (k === 0) {
      // Unlimited: all pairs
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          let dot = 0;
          for (let d = 0; d < dim; d++) dot += fileVecs[i][d] * fileVecs[j][d];
          edges.push({ source: files[i], target: files[j], score: dot });
        }
      }
    } else {
      // k-NN per file: build neighbor lists, then emit edges
      const neighbors = new Array(files.length);
      const simScores = new Map(); // "i:j" → score (canonical key: i < j)
      for (let i = 0; i < files.length; i++) {
        const sims = [];
        for (let j = 0; j < files.length; j++) {
          if (i === j) continue;
          let dot = 0;
          for (let d = 0; d < dim; d++) dot += fileVecs[i][d] * fileVecs[j][d];
          sims.push({ j, score: dot });
        }
        sims.sort((a, b) => b.score - a.score);
        const topK = sims.slice(0, k);
        neighbors[i] = new Set(topK.map(s => s.j));
        for (const { j, score } of topK) {
          const key = i < j ? `${i}:${j}` : `${j}:${i}`;
          if (!simScores.has(key)) simScores.set(key, score);
        }
      }

      const edgeSet = new Set();
      for (let i = 0; i < files.length; i++) {
        for (const j of neighbors[i]) {
          // Mutual filtering: both must consider each other neighbors
          if (mutual && !neighbors[j].has(i)) continue;
          const key = i < j ? `${i}:${j}` : `${j}:${i}`;
          if (edgeSet.has(key)) continue;
          edgeSet.add(key);
          edges.push({ source: files[i], target: files[j], score: simScores.get(key) });
        }
      }
    }
    edges.sort((a, b) => b.score - a.score);

    // --- Colors: category dictionary or continuous PCA ---
    const categories = useDict
      ? this._classifyFiles(files, fileVecs, dim)
      : this._pcaColors(files, fileVecs, dim);

    return { edges: edges.slice(0, maxEdges), fileCount: files.length, ...categories };
  }

  /**
   * Get top-N most similar files to a given file by embedding similarity.
   * @param {string} filePath - Relative path to vault root
   * @param {number} topN - Number of results
   * @returns {Array<{file: string, score: number}>}
   */
  getSimilarFiles(filePath, topN = 20) {
    const dim = this.engine.getDimension();

    // Compute average embedding for the target file
    const targetChunks = [];
    for (let i = 0; i < this.meta.length; i++) {
      if (this.meta[i].file === filePath) targetChunks.push(i);
    }
    if (targetChunks.length === 0) return [];

    const targetVec = new Float32Array(dim);
    for (const idx of targetChunks) {
      const vec = this.vectors[idx];
      for (let d = 0; d < dim; d++) targetVec[d] += vec[d];
    }
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += targetVec[d] * targetVec[d];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let d = 0; d < dim; d++) targetVec[d] /= norm;

    // Compute average embeddings for all other files
    const fileChunks = new Map();
    for (let i = 0; i < this.meta.length; i++) {
      const file = this.meta[i].file;
      if (file === filePath) continue;
      if (!fileChunks.has(file)) fileChunks.set(file, []);
      fileChunks.get(file).push(i);
    }

    const results = [];
    for (const [file, indices] of fileChunks) {
      const avg = new Float32Array(dim);
      for (const idx of indices) {
        const vec = this.vectors[idx];
        for (let d = 0; d < dim; d++) avg[d] += vec[d];
      }
      let n = 0;
      for (let d = 0; d < dim; d++) n += avg[d] * avg[d];
      n = Math.sqrt(n);
      if (n > 0) for (let d = 0; d < dim; d++) avg[d] /= n;

      let dot = 0;
      for (let d = 0; d < dim; d++) dot += targetVec[d] * avg[d];
      results.push({ file, score: dot });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topN);
  }

  /**
   * Classify files by embedding similarity to category dictionary terms.
   * Reads .gib-search/graph-categories.json from the vault. Falls back to
   * continuous PCA colors when no dictionary is configured.
   * Returns { fileCategories: {file: {category, score, color}}, categoryList: [{name, color}], pcaValues, pcaPositions }
   */
  _classifyFiles(files, fileVecs, dim) {
    const catPath = path.join(this.vaultPath, '.gib-search', 'graph-categories.json');
    let catTerms;
    try {
      const raw = fs.readFileSync(catPath, 'utf-8');
      catTerms = JSON.parse(raw);
      if (!Array.isArray(catTerms) || catTerms.length === 0) catTerms = null;
    } catch {
      catTerms = null;
    }

    if (!catTerms) {
      return this._pcaColors(files, fileVecs, dim);
    }

    if (!this._catCache || this._catCacheKey !== JSON.stringify(catTerms)) {
      this._catCacheKey = JSON.stringify(catTerms);
      this._catCache = null;
    }

    if (!this._catCache) {
      this._embedCategories(catTerms);
      return this._pcaColors(files, fileVecs, dim);
    }

    const catVecs = this._catCache;

    const categoryList = catVecs.map((c, i) => ({
      name: c.name,
      color: `hsl(${Math.round((i / catVecs.length) * 330)}, 65%, 58%)`,
    }));

    const fileCategories = {};
    for (let fi = 0; fi < files.length; fi++) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let ci = 0; ci < catVecs.length; ci++) {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += fileVecs[fi][d] * catVecs[ci].vec[d];
        if (dot > bestScore) {
          bestScore = dot;
          bestIdx = ci;
        }
      }
      fileCategories[files[fi]] = {
        category: catVecs[bestIdx].name,
        score: bestScore,
        color: categoryList[bestIdx].color,
      };
    }

    // PCA positions are still useful for the initial layout even when colors
    // come from the dictionary classifier.
    const pcaResult = this._pcaColors(files, fileVecs, dim);

    return { fileCategories, categoryList, pcaValues: pcaResult.pcaValues, pcaPositions: pcaResult.pcaPositions };
  }

  /**
   * Embed category terms async. Caches result for subsequent getFileEdges calls.
   */
  async _embedCategories(terms) {
    try {
      const vecs = [];
      for (const term of terms) {
        const vec = await this.engine.embed(term);
        vecs.push({ name: term, vec });
      }
      this._catCache = vecs;
      this._catCacheKey = JSON.stringify(terms);
      process.stderr.write(`[gib-search] Embedded ${vecs.length} category terms\n`);
    } catch (err) {
      process.stderr.write(`[gib-search] Category embedding failed: ${err.message}\n`);
    }
  }

  /**
   * Continuous PCA-based coloring for the research graph.
   *
   * Each file gets a unique earthy color from its (PC1, PC2) position, so
   * "close in embedding space" → "close in color". Files at opposite ends
   * of the principal axes get opposite hues; files near the center get
   * desaturated tones. No discrete groups, no community detection.
   */
  _pcaColors(files, fileVecs, dim) {
    const n = files.length;
    const fileCategories = {};
    const pcaValues = {};

    if (n === 0) return { fileCategories, categoryList: [], pcaValues, pcaPositions: {} };

    // --- PCA: PC1, PC2 over centered file vectors ---
    const mean = new Float32Array(dim);
    for (const v of fileVecs) {
      for (let d = 0; d < dim; d++) mean[d] += v[d];
    }
    for (let d = 0; d < dim; d++) mean[d] /= n;

    const centered = fileVecs.map(v => {
      const c = new Float32Array(dim);
      for (let d = 0; d < dim; d++) c[d] = v[d] - mean[d];
      return c;
    });

    const pc1 = this._powerIteration(centered, dim);
    const proj1 = centered.map(v => {
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += v[d] * pc1[d];
      return dot;
    });

    const deflated = centered.map((v, i) => {
      const c = new Float32Array(dim);
      for (let d = 0; d < dim; d++) c[d] = v[d] - proj1[i] * pc1[d];
      return c;
    });
    const pc2 = this._powerIteration(deflated, dim);
    const proj2 = deflated.map(v => {
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += v[d] * pc2[d];
      return dot;
    });

    let min1 = Infinity, max1 = -Infinity;
    for (const v of proj1) { if (v < min1) min1 = v; if (v > max1) max1 = v; }
    const range1 = max1 - min1 || 1;
    let min2 = Infinity, max2 = -Infinity;
    for (const v of proj2) { if (v < min2) min2 = v; if (v > max2) max2 = v; }
    const range2 = max2 - min2 || 1;

    const pcaPositions = {};
    for (let i = 0; i < n; i++) {
      pcaValues[files[i]] = (proj1[i] - min1) / range1;
      pcaPositions[files[i]] = [(proj1[i] - min1) / range1, (proj2[i] - min2) / range2];
    }

    // Continuous earthy color from PCA position (per file)
    for (let i = 0; i < n; i++) {
      const [pc1n, pc2n] = pcaPositions[files[i]];
      fileCategories[files[i]] = {
        category: null,
        score: 1,
        color: pcaToEarthyColor(pc1n, pc2n),
      };
    }

    return { fileCategories, categoryList: [], pcaValues, pcaPositions };
  }

  /**
   * Power iteration: dominant eigenvector of X^T X.
   * Uses deterministic seed + sign convention for stable colors across runs.
   */
  _powerIteration(vectors, dim) {
    const n = vectors.length;

    // Deterministic initial vector: alternating +/- pattern
    let v = new Float32Array(dim);
    for (let d = 0; d < dim; d++) v[d] = (d % 2 === 0) ? 1 : -1;
    // Normalize
    let initNorm = 0;
    for (let d = 0; d < dim; d++) initNorm += v[d] * v[d];
    initNorm = Math.sqrt(initNorm);
    for (let d = 0; d < dim; d++) v[d] /= initNorm;

    for (let iter = 0; iter < 30; iter++) {
      const xv = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += vectors[i][d] * v[d];
        xv[i] = dot;
      }
      const w = new Float32Array(dim);
      for (let i = 0; i < n; i++) {
        for (let d = 0; d < dim; d++) w[d] += xv[i] * vectors[i][d];
      }
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += w[d] * w[d];
      norm = Math.sqrt(norm);
      if (norm === 0) break;
      for (let d = 0; d < dim; d++) w[d] /= norm;
      v = w;
    }

    // Sign convention: force the component with largest absolute value to be positive.
    // This ensures the eigenvector always points the same direction.
    let maxAbs = 0;
    let maxIdx = 0;
    for (let d = 0; d < dim; d++) {
      const a = Math.abs(v[d]);
      if (a > maxAbs) { maxAbs = a; maxIdx = d; }
    }
    if (v[maxIdx] < 0) {
      for (let d = 0; d < dim; d++) v[d] = -v[d];
    }

    return v;
  }

  /**
   * Get current index status.
   */
  getStatus() {
    return {
      indexedFiles: new Set(this.meta.map((c) => c.file)).size,
      totalChunks: this.meta.length,
      vaultFiles: this.vaultFileCount,
      staleFiles: this.staleFileCount,
      isIndexing: this.isIndexing,
    };
  }

  /**
   * Scan the vault for all indexable files.
   * @returns {Map<string, number>} Map of relative path → mtime (ms)
   */
  scanVault() {
    const files = new Map();
    this._scanDir('', files);
    return files;
  }

  _scanDir(relDir, files) {
    const absDir = path.join(this.vaultPath, relDir);
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        this._scanDir(relPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (INDEXABLE_EXTENSIONS.has(ext)) {
          try {
            const stat = fs.statSync(path.join(this.vaultPath, relPath));
            files.set(relPath, stat.mtimeMs);
          } catch {
            // File may have been deleted
          }
        }
      }
    }
  }
}
