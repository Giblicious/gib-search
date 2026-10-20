import { inNoteUnits } from './in-note-search.js';
import { inNoteParagraphs, inNoteDot } from './in-note-hierarchy.js';
import { inNoteReaderInput } from './in-note-reader-codec.js';
import { inNoteFocusRange } from './in-note-focus.js';

export const IN_NOTE_READER_THRESHOLDS = Object.freeze({ precise: .95, balanced: .9, broad: .8 });
function current(check) { if (check && !check()) { const error = new Error('Superseded by a newer in-note query'); error.name = 'AbortError'; throw error; } }
function remember(map, key, value, limit) { map.delete(key); map.set(key, value); while (map.size > limit) map.delete(map.keys().next().value); return value; }
const vectorBytes = (text, vector) => text.length * 2 + vector.byteLength + (vector.focus?.vectors?.byteLength || 0) + (vector.focus?.words?.length || 0) * 64;
const words = text => String(text).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

export function inNoteReaderWindows(source) {
  const units = inNoteUnits(source), paragraphs = inNoteParagraphs(units, source);
  return paragraphs.map(paragraph => {
    const characters = [], positions = []; let previous = -1;
    for (const index of paragraph.indices) {
      const unit = units[index];
      for (let offset = 0; offset < unit.phrase.length; offset++) {
        const position = unit.from + unit.displayPositions[offset];
        if (position <= previous) continue;
        if (!offset && characters.length && characters.at(-1) !== ' ') { const whitespace = source.slice(previous + 1, position).search(/\s/u); characters.push(' '); positions.push(previous + 1 + Math.max(0, whitespace)); }
        if (/\s/u.test(unit.phrase[offset]) && characters.at(-1) === ' ') { previous = position; continue; }
        characters.push(unit.phrase[offset]); positions.push(position); previous = position;
      }
    }
    const from = positions[0], to = positions.at(-1) + 1;
    return { from, to, phrase: characters.join(''), sourcePhrase: source.slice(from, to), heading: units[paragraph.indices[0]].heading, isHeading: paragraph.isHeading, retrievalTexts: paragraph.indices.map(index => units[index].phrase), displayPositions: new Uint32Array(positions.map(position => position - from)) };
  }).filter(window => window.phrase.length >= 3);
}

export class PassageInNoteMatcher {
  constructor({ embed, read, cache, batchSize = 6, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
    this.embed = embed; this.read = read; this.cache = cache; this.batchSize = batchSize; this.yieldControl = yieldControl;
    this.sources = new Map(); this.vectors = new Map(); this.readings = new Map(); this.results = new Map(); this.vectorBytes = 0;
    this.cacheReady = cache ? cache.load().then(entries => { if (this.disposed) return; for (const [text, vector] of entries) { const copy = new Float32Array(vector); copy.focus = vector.focus || null; this.rememberVector(text, copy); } }).catch(() => {}) : Promise.resolve();
  }
  rememberVector(text, vector) {
    const old = this.vectors.get(text); if (old) this.vectorBytes -= vectorBytes(text, old);
    this.vectors.delete(text); this.vectors.set(text, vector); this.vectorBytes += vectorBytes(text, vector);
    // Optional word attribution must not evict the smaller retrieval vectors
    // and force an entire large note to be encoded again on every query.
    if (this.vectorBytes > 16 * 1024 * 1024) for (const value of this.vectors.values()) {
      if (!value.focus) continue;
      this.vectorBytes -= (value.focus.vectors?.byteLength || 0) + (value.focus.words?.length || 0) * 64; value.focus = null;
      if (this.vectorBytes <= 16 * 1024 * 1024) break;
    }
    while (this.vectorBytes > 16 * 1024 * 1024 || this.vectors.size > 8192) { const key = this.vectors.keys().next().value; this.vectorBytes -= vectorBytes(key, this.vectors.get(key)); this.vectors.delete(key); }
  }
  snapshot(source) {
    if (this.sources.has(source)) return this.sources.get(source);
    const units = inNoteReaderWindows(source), paragraphs = units.map((unit, index) => ({ ...unit, indices: [index] })), paragraphOf = new Map(units.map((_, index) => [index, index]));
    // A target already includes its paragraph's sentence context and overlap.
    // Unrelated neighbouring paragraphs must not override that occurrence.
    const pairs = units.map(unit => inNoteReaderInput(unit.phrase, unit.heading));
    const representations = [...new Set(units.flatMap(unit => [unit.phrase, ...unit.retrievalTexts]))];
    return remember(this.sources, source, { units, paragraphs, paragraphOf, pairs, representations }, 2);
  }
  async embeddings(texts, check) {
    const resolved = new Map(texts.filter(text => this.vectors.has(text)).map(text => [text, this.vectors.get(text)]));
    const missing = [...new Set(texts.filter(text => !resolved.has(text)))];
    for (let offset = 0; offset < missing.length; offset += this.batchSize) {
      current(check); const batch = missing.slice(offset, offset + this.batchSize), values = await this.embed(batch);
      current(check);
      if (values.length !== batch.length || values.some(vector => vector?.length !== 384 || !vector.every(Number.isFinite))) throw new Error('In-note retrieval returned invalid vectors');
      batch.forEach((text, index) => { resolved.set(text, values[index]); this.rememberVector(text, values[index]); }); current(check); await this.yieldControl();
    }
    return texts.map(text => resolved.get(text));
  }
  save() {
    if (!this.cache || this.disposed) return;
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => {
      const allowed = new Set([...this.sources.values()].flatMap(note => note.representations));
      this.cache.save(this.vectors, allowed).catch(() => {});
    }, 1500);
  }
  async prepare(source, check) {
    const valid = () => !this.disposed && (!check || check());
    await this.cacheReady; current(valid); const note = this.snapshot(String(source || '')); this.preparing = true;
    try { await this.embeddings(note.representations, valid); }
    finally { this.preparing = false; this.save(); }
  }
  search(query, source, options = {}) {
    const run = (this.pending || Promise.resolve()).then(() => this.searchCurrent(query, source, options));
    this.pending = run.catch(() => {}); return run;
  }
  async searchCurrent(query, source, { breadth = 'balanced', isCurrent, diagnostics = false, exhaustive = false, onProgress } = {}) {
    const externalCurrent = isCurrent; isCurrent = () => !this.disposed && (!externalCurrent || externalCurrent());
    await this.cacheReady; current(isCurrent);
    const text = String(source || ''), literal = String(query || '').trim(); if (literal.length < 2 || !text.trim()) return diagnostics ? { matches: [], candidates: [] } : [];
    const resultKey = JSON.stringify([literal, text, breadth, exhaustive]); if (!diagnostics && this.results.has(resultKey)) return this.results.get(resultKey);
    const note = this.snapshot(text), queryWords = new Set(words(literal)), threshold = IN_NOTE_READER_THRESHOLDS[breadth] ?? IN_NOTE_READER_THRESHOLDS.balanced;
    const [queryVector] = await this.embeddings([literal], isCurrent), vectors = await this.embeddings(note.representations, isCurrent), byText = new Map(note.representations.map((text, index) => [text, vectors[index]]));
    const paragraphs = note.paragraphs.map(paragraph => ({ ...paragraph, similarity: Math.max(inNoteDot(queryVector, byText.get(paragraph.phrase)), ...paragraph.retrievalTexts.map(text => inNoteDot(queryVector, byText.get(text)))) }));
    const groups = new Map();
    note.units.forEach((unit, index) => {
      const input = note.pairs[index], key = `${literal}\0${input.passage}`;
      const lexical = words(unit.phrase).filter(word => queryWords.has(word)).length / Math.max(1, queryWords.size);
      const similarity = paragraphs[note.paragraphOf.get(index)].similarity;
      if (!groups.has(key)) groups.set(key, { key, input: { ...input, query: literal }, similarity, lexical, priority: similarity + .04 * lexical, units: [] });
      groups.get(key).units.push(unit);
    });
    const ordered = [...groups.values()].sort((a, b) => b.priority - a.priority), matches = [], candidates = [];
    const selected = new Set(ordered.length <= 24 || exhaustive ? ordered : [...ordered.slice(0, 16), ...ordered.slice().sort((a, b) => b.lexical - a.lexical || b.similarity - a.similarity).slice(0, 8)]);
    const queue = [...selected].sort((a, b) => a.input.passage.length - b.input.passage.length), remaining = ordered.filter(group => !selected.has(group));
    const publish = async (stage, ranges, confirmed) => { current(isCurrent); await onProgress?.({ stage, ranges, ...(confirmed ? { matches: [...confirmed] } : {}) }); current(isCurrent); await this.yieldControl(); };
    await publish('paragraph', paragraphs.slice().sort((a, b) => b.similarity - a.similarity).slice(0, 3));
    // Dense paragraph and sentence evidence is unioned with lexical candidates.
    // Expand answer-rich/tied tails; find-all is not capped at the first batch.
    // Audits can run exhaustively to measure the shortlist's lost occurrences.
    let acceptedInRound = 0, acceptedFloor = Infinity, roundStart = 0, sentencesPublished = false;
    for (let offset = 0; offset < queue.length;) {
      current(isCurrent); const batch = queue.slice(offset, offset + this.batchSize), resolved = new Map(batch.filter(group => this.readings.has(group.key)).map(group => [group.key, this.readings.get(group.key)])), missing = batch.filter(group => !resolved.has(group.key));
      if (missing.length) {
        const readings = await this.read(missing.map(group => group.input)); current(isCurrent);
        if (readings.length !== missing.length || readings.some(reading => !Number.isFinite(reading?.probability) || reading.probability < 0 || reading.probability > 1 || !Array.isArray(reading.spans) || reading.spans.some(span => !Number.isInteger(span.from) || !Number.isInteger(span.to) || span.from < 0 || span.to <= span.from))) throw new Error('In-note reader returned invalid spans');
        missing.forEach((group, index) => { resolved.set(group.key, readings[index]); remember(this.readings, group.key, readings[index], 512); });
      }
      for (const group of batch) {
        const reading = resolved.get(group.key); candidates.push({ phrase: group.units[0].phrase, probability: reading.probability, similarity: group.similarity });
        if (reading.probability < threshold) continue;
        const matchesBeforeGroup = matches.length;
        for (const unit of group.units) for (const span of reading.spans) {
          if (Number.isFinite(span.sentenceProbability) && span.sentenceProbability < Math.min(.9, threshold)) continue;
          let fromPlain = span.from - group.input.targetFrom, toPlain = span.to - group.input.targetFrom;
          const sentenceFrom = Number.isInteger(span.sentenceFrom) && span.sentenceFrom >= group.input.targetFrom ? span.sentenceFrom - group.input.targetFrom : 0, sentenceTo = Number.isInteger(span.sentenceTo) && span.sentenceTo <= group.input.targetTo ? span.sentenceTo - group.input.targetFrom : unit.phrase.length;
          // Attribution reuses the retrieval encoder's existing hidden states.
          // It only narrows display within the sentence the reader verified.
          const focus = inNoteFocusRange(queryVector.focus, byText.get(unit.phrase)?.focus, sentenceFrom, sentenceTo);
          if (focus && focus.from >= 0 && focus.to > focus.from && sentenceFrom + focus.to <= sentenceTo) { fromPlain = sentenceFrom + focus.from; toPlain = sentenceFrom + focus.to; }
          if (fromPlain < 0 || toPlain > unit.phrase.length || toPlain <= fromPlain || !unit.displayPositions?.length) continue;
          const wordPart = /[\p{L}\p{N}\p{M}_’'-]/u;
          if (fromPlain && wordPart.test(unit.phrase[fromPlain - 1]) && wordPart.test(unit.phrase[fromPlain]) || toPlain < unit.phrase.length && wordPart.test(unit.phrase[toPlain - 1]) && wordPart.test(unit.phrase[toPlain])) continue;
          const from = unit.from + unit.displayPositions[fromPlain], to = unit.from + unit.displayPositions[toPlain - 1] + 1;
          if (!Number.isInteger(from) || !Number.isInteger(to) || from < unit.from || to > unit.to || to <= from || matches.some(match => from < match.highlight.to && to > match.highlight.from)) continue;
          const highlight = { from, to, phrase: unit.phrase.slice(fromPlain, toPlain), sourcePhrase: text.slice(from, to) };
          const checkedFrom = unit.from + unit.displayPositions[sentenceFrom], checkedTo = unit.from + unit.displayPositions[sentenceTo - 1] + 1;
          if (!Number.isInteger(checkedFrom) || !Number.isInteger(checkedTo) || checkedFrom > from || checkedTo < to || checkedTo > unit.to || checkedFrom < unit.from) continue;
          matches.push({ from: checkedFrom, to: checkedTo, phrase: unit.phrase.slice(sentenceFrom, sentenceTo), sourcePhrase: text.slice(checkedFrom, checkedTo), score: Math.min(reading.probability, span.sentenceProbability ?? 1), similarity: group.similarity, kind: 'semantic', highlight });
        }
        if (matches.length > matchesBeforeGroup) { acceptedInRound++; acceptedFloor = Math.min(acceptedFloor, group.similarity); }
      }
      if (matches.length) {
        if (!sentencesPublished) { await publish('sentence', matches.map(match => ({ from: match.from, to: match.to, sourcePhrase: match.sourcePhrase }))); sentencesPublished = true; }
        await publish('phrase', [], matches);
      }
      await this.yieldControl();
      offset += batch.length;
      if (offset >= queue.length && remaining.length) {
        const denseTail = remaining[0].similarity >= acceptedFloor - .035;
        if (exhaustive || acceptedInRound >= Math.max(2, (queue.length - roundStart) / 3) && denseTail || !matches.length && queue.length < 32) {
          roundStart = queue.length; queue.push(...remaining.splice(0, 12).sort((a, b) => a.input.passage.length - b.input.passage.length)); acceptedInRound = 0;
        }
      }
    }
    if (!sentencesPublished) await publish('sentence', []);
    matches.sort((a, b) => a.highlight.from - b.highlight.from); current(isCurrent); remember(this.results, resultKey, matches, 8); this.save();
    return diagnostics ? { matches, candidates, totalCandidates: ordered.length, readCandidates: candidates.length } : matches;
  }
  dispose() { this.disposed = true; clearTimeout(this.saveTimer); this.saveTimer = null; this.sources.clear(); this.vectors.clear(); this.vectorBytes = 0; this.readings.clear(); this.results.clear(); }
}
