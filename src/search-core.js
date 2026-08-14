const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;

function searchTerms(source) {
  return (String(source || '').normalize('NFKC').toLowerCase().match(WORD_PATTERN) || [])
    .map(value => value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(value => value.length > 1);
}

function fieldTermCounts(source) {
  const counts = new Map();
  for (const term of searchTerms(source)) counts.set(term, (counts.get(term) || 0) + 1);
  return counts;
}

function insertTopK(values, value, limit, scoreOf = item => Number(item?.score || 0)) {
  if (limit <= 0) return values;
  const score = scoreOf(value); let low = 0, high = values.length;
  while (low < high) { const middle = (low + high) >>> 1; if (scoreOf(values[middle]) >= score) low = middle + 1; else high = middle; }
  if (low < limit) values.splice(low, 0, value);
  if (values.length > limit) values.length = limit;
  return values;
}

function boundedTopK(iterable, limit, scoreOf = item => Number(item?.score || 0)) {
  const output = [];
  for (const value of iterable) insertTopK(output, value, limit, scoreOf);
  return output;
}

class IncrementalBm25 {
  constructor(options = {}) {
    this.k1 = Math.max(.2, Number(options.k1) || 1.2); this.b = Math.max(0, Math.min(1, Number(options.b) || .72));
    this.documents = new Map(); this.postings = new Map(); this.keysByFile = new Map(); this.totalLength = 0;
  }
  clear() { this.documents.clear(); this.postings.clear(); this.keysByFile.clear(); this.totalLength = 0; }
  remove(key) {
    const previous = this.documents.get(key); if (!previous) return false;
    this.documents.delete(key); this.totalLength -= previous.length;
    for (const term of previous.terms.keys()) { const posting = this.postings.get(term); if (!posting) continue; posting.delete(key); if (!posting.size) this.postings.delete(term); } const file = previous.payload?.file, fileKeys = file && this.keysByFile.get(file); if (fileKeys) { fileKeys.delete(key); if (!fileKeys.size) this.keysByFile.delete(file); }
    return true;
  }
  upsert(key, fields = {}, payload = null) {
    this.remove(key);
    const weights = { title: 2.8, heading: 2.1, body: 1, path: .65, metadata: 1.35 }, terms = new Map(); let length = 0;
    for (const [field, weight] of Object.entries(weights)) {
      const counts = fieldTermCounts(fields[field]);
      for (const [term, count] of counts) terms.set(term, (terms.get(term) || 0) + count * weight);
      if (field === 'body') length += [...counts.values()].reduce((sum, value) => sum + value, 0);
    }
    length = Math.max(1, length); const value = { key, fields, terms, length, payload };
    this.documents.set(key, value); this.totalLength += length; const file = payload?.file; if (file) { const fileKeys = this.keysByFile.get(file) || new Set(); fileKeys.add(key); this.keysByFile.set(file, fileKeys); }
    for (const [term, frequency] of terms) { const posting = this.postings.get(term) || new Map(); posting.set(key, frequency); this.postings.set(term, posting); }
    return value;
  }
  replaceFile(file, documents) {
    for (const key of [...(this.keysByFile.get(file) || [])]) this.remove(key);
    for (const document of documents || []) this.upsert(document.key, document.fields, document.payload);
  }
  search(query, limit = 100, allowed = null) {
    const terms = [...new Set(searchTerms(query))]; if (!terms.length || !this.documents.size) return [];
    const documentCount = this.documents.size, averageLength = this.totalLength / Math.max(1, documentCount), scores = new Map(), matched = new Map();
    for (const term of terms) {
      const posting = this.postings.get(term); if (!posting?.size) continue;
      const idf = Math.log(1 + (documentCount - posting.size + .5) / (posting.size + .5));
      for (const [key, frequency] of posting) {
        const document = this.documents.get(key); if (!document || allowed && !allowed.has(document.payload?.file)) continue;
        const denominator = frequency + this.k1 * (1 - this.b + this.b * document.length / Math.max(1, averageLength)), score = idf * frequency * (this.k1 + 1) / Math.max(.001, denominator);
        scores.set(key, (scores.get(key) || 0) + score); matched.set(key, (matched.get(key) || 0) + 1);
      }
    }
    const ranked = boundedTopK([...scores].map(([key, score]) => ({ key, score, coverage: (matched.get(key) || 0) / terms.length, payload: this.documents.get(key)?.payload })), Math.max(1, limit), item => item.score);
    const maximum = Number(ranked[0]?.score || 0) || 1;
    return ranked.map((item, rank) => ({ ...item, rank, normalized: Math.max(0, Math.min(1, item.score / maximum)) }));
  }
}

function dotVector(first, second) { let value = 0; for (let index = 0; index < Math.min(first?.length || 0, second?.length || 0); index++) value += first[index] * second[index]; return value; }
function normalizedVector(source) { const vector = Float32Array.from(source || []), norm = Math.sqrt(dotVector(vector, vector)) || 1; for (let index = 0; index < vector.length; index++) vector[index] /= norm; return vector; }

function diverseCentroids(vectors, maximum = 4) {
  const values = (vectors || []).filter(vector => vector?.length); if (!values.length) return [];
  if (values.length <= maximum) return values.map(normalizedVector);
  const mean = new Float32Array(values[0].length); for (const vector of values) for (let dimension = 0; dimension < mean.length; dimension++) mean[dimension] += vector[dimension];
  const selected = [normalizedVector(mean)], remaining = values.map(normalizedVector);
  while (selected.length < maximum && remaining.length) {
    let bestIndex = 0, bestDistance = -1;
    for (let index = 0; index < remaining.length; index++) { const similarity = Math.max(...selected.map(value => dotVector(value, remaining[index]))), distance = 1 - similarity; if (distance > bestDistance) { bestDistance = distance; bestIndex = index; } }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function centroidSimilarity(first, second) {
  if (!first?.length || !second?.length) return -1;
  const directional = (source, target) => source.reduce((sum, vector) => sum + Math.max(...target.map(other => dotVector(vector, other))), 0) / source.length;
  const coverage = (directional(first, second) + directional(second, first)) / 2, peak = Math.max(...first.flatMap(vector => second.map(other => dotVector(vector, other))));
  return Math.max(-1, Math.min(1, coverage * .72 + peak * .28));
}

function reciprocalRankFusion(rankings, options = {}) {
  const constant = Math.max(1, Number(options.constant) || 40), scores = new Map(), details = new Map();
  for (const ranking of rankings || []) {
    const weight = Math.max(0, Number(ranking.weight) || 1);
    (ranking.items || []).forEach((item, rank) => { const key = ranking.keyOf ? ranking.keyOf(item) : item.key; if (key === undefined || key === null) return; scores.set(key, (scores.get(key) || 0) + weight / (constant + rank + 1)); const detail = details.get(key) || {}; detail[ranking.name || 'rank'] = rank; details.set(key, detail); });
  }
  return [...scores].map(([key, score]) => ({ key, score, ranks: details.get(key) || {} })).sort((first, second) => second.score - first.score || String(first.key).localeCompare(String(second.key)));
}

function assembleIndexSegments(segments, dimension = 384) {
  const meta = [], parts = []; for (const segment of segments || []) { const count = Number(segment?.meta?.length || 0), buffer = segment?.vectors; if (!segment || !Array.isArray(segment.meta) || !buffer || Number(buffer.byteLength || 0) !== count * dimension * 4) throw new Error('Index segment is incomplete'); meta.push(...segment.meta); parts.push(new Float32Array(buffer)); }
  const vectors = new Float32Array(meta.length * dimension); let offset = 0; for (const part of parts) { vectors.set(part, offset); offset += part.length; } return { meta, vectors: vectors.buffer };
}

export { IncrementalBm25, assembleIndexSegments, boundedTopK, centroidSimilarity, diverseCentroids, dotVector, insertTopK, reciprocalRankFusion, searchTerms };
