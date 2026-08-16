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

class BoundedMetricWindow {
  constructor(maximumSamples = 64) { this.maximumSamples = Math.max(4, Math.min(256, Math.floor(Number(maximumSamples) || 64))); this.samples = new Map(); }
  record(name, value) {
    const number = Number(value); if (!Number.isFinite(number) || number < 0) return this.summary(name);
    const values = this.samples.get(name) || []; values.push(number); if (values.length > this.maximumSamples) values.splice(0, values.length - this.maximumSamples); this.samples.set(name, values); return this.summary(name);
  }
  summary(name) {
    const values = this.samples.get(name) || []; if (!values.length) return { count: 0, last: 0, p50: 0, p95: 0, max: 0 };
    const sorted = values.slice().sort((first, second) => first - second), at = percentile => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1))];
    return { count: values.length, last: values.at(-1), p50: at(.5), p95: at(.95), max: sorted.at(-1) };
  }
  snapshot() { return Object.fromEntries([...this.samples.keys()].map(name => [name, this.summary(name)])); }
}

function mergeIndexReplacements(meta, vectors, replacements) {
  if (!Array.isArray(meta) || !Array.isArray(vectors) || meta.length !== vectors.length) throw new Error('Current index metadata and vectors are not aligned');
  const changed = new Set(replacements?.keys?.() || []); if (!changed.size) return { meta, vectors, changed };
  const nextMeta = [], nextVectors = [];
  for (let index = 0; index < meta.length; index++) if (!changed.has(meta[index]?.file)) { nextMeta.push(meta[index]); nextVectors.push(vectors[index]); }
  for (const [file, replacement] of replacements) {
    if (!Array.isArray(replacement?.meta) || !Array.isArray(replacement?.vectors) || replacement.meta.length !== replacement.vectors.length || replacement.meta.some(item => item?.file !== file)) throw new Error(`Replacement index records are incomplete for ${file}`);
    nextMeta.push(...replacement.meta); nextVectors.push(...replacement.vectors);
  }
  return { meta: nextMeta, vectors: nextVectors, changed };
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
  const remaining = values.map(normalizedVector), mean = new Float32Array(remaining[0].length); for (const vector of remaining) for (let dimension = 0; dimension < mean.length; dimension++) mean[dimension] += vector[dimension]; const center = normalizedVector(mean);
  let representativeIndex = 0, representativeScore = -Infinity; for (let index = 0; index < remaining.length; index++) { const score = dotVector(remaining[index], center); if (score > representativeScore) { representativeScore = score; representativeIndex = index; } } const selected = [remaining.splice(representativeIndex, 1)[0]];
  while (selected.length < maximum && remaining.length) {
    let bestIndex = 0, bestDistance = -1;
    for (let index = 0; index < remaining.length; index++) { const similarity = Math.max(...selected.map(value => dotVector(value, remaining[index]))), distance = 1 - similarity; if (distance > bestDistance) { bestDistance = distance; bestIndex = index; } }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function uniqueCentroidAlignment(scores) {
  const rows = scores.length, columns = scores[0]?.length || 0, transposed = rows > columns, sourceLength = Math.min(rows, columns), targetLength = Math.max(rows, columns), scoreAt = (source, target) => transposed ? scores[target][source] : scores[source][target]; if (!sourceLength) return -1;
  if (sourceLength <= 6 && targetLength <= 8) { let best = -Infinity; const visit = (index, used, total) => { if (index === sourceLength) { best = Math.max(best, total); return; } for (let target = 0; target < targetLength; target++) if (!used.has(target)) { used.add(target); visit(index + 1, used, total + scoreAt(index, target)); used.delete(target); } }; visit(0, new Set(), 0); return best / sourceLength; }
  const pairs = []; for (let source = 0; source < sourceLength; source++) for (let target = 0; target < targetLength; target++) pairs.push({ source, target, score: scoreAt(source, target) }); pairs.sort((a, b) => b.score - a.score); const sourceUsed = new Set(), targetUsed = new Set(); let total = 0; for (const pair of pairs) { if (sourceUsed.has(pair.source) || targetUsed.has(pair.target)) continue; sourceUsed.add(pair.source); targetUsed.add(pair.target); total += pair.score; if (sourceUsed.size === sourceLength) break; } return total / sourceLength;
}

function centroidSimilarity(first, second) {
  if (!first?.length || !second?.length) return -1;
  const scores = first.map(vector => second.map(other => dotVector(vector, other))), forward = scores.reduce((sum, row) => sum + Math.max(...row), 0) / first.length, reverse = second.reduce((sum, _, column) => sum + Math.max(...scores.map(row => row[column])), 0) / second.length, balancedCoverage = forward > 0 && reverse > 0 ? 2 * forward * reverse / (forward + reverse) : (forward + reverse) / 2, alignment = uniqueCentroidAlignment(scores), peak = Math.max(...scores.flat());
  return Math.max(-1, Math.min(1, balancedCoverage * .55 + alignment * .35 + peak * .1));
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

export { BoundedMetricWindow, IncrementalBm25, assembleIndexSegments, boundedTopK, centroidSimilarity, diverseCentroids, dotVector, insertTopK, mergeIndexReplacements, reciprocalRankFusion, searchTerms };
