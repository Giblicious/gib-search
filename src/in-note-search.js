// In-note matching deliberately has no dependency on the vault's passage index.
// Every finding retains its occurrence in the exact editor snapshot that was scored.
import { inNoteFocusRange } from './in-note-focus.js';
export const IN_NOTE_MATCH_VERSION = 3;
export const IN_NOTE_PRESETS = Object.freeze({
  precise: { similarity: .48, entailment: .60, contradiction: .25, neutralSimilarity: .70 },
  balanced: { similarity: .40, entailment: .40, contradiction: .35, neutralSimilarity: .60 },
  broad: { similarity: .34, entailment: .30, contradiction: .40, neutralSimilarity: .58 },
});

function remember(cache, key, value, limit) {
  cache.delete(key); cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
}
function current(check) {
  if (!check || check()) return;
  const error = new Error('Superseded by a newer in-note query'); error.name = 'AbortError'; throw error;
}
function similarity(first, second) {
  let score = 0; for (let index = 0; index < first.length; index++) score += first[index] * second[index]; return score;
}
const QUERY_FUNCTION_WORDS = new Set('a an the of to for in on at is are was were be been being this that it with and or how when what where more less much many further'.split(' '));
function meaningWords(text) { return (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => !QUERY_FUNCTION_WORDS.has(word)).map(word => word.length > 3 ? word.replace(/s$/u, '') : word); }

// Keep a position map while removing Markdown syntax, so formatting and links do
// not turn a valid semantic hit into a different occurrence elsewhere in the note.
export function inNoteProjection(source) {
  const text = String(source || ''), characters = [], positions = [], hidden = new Uint8Array(text.length);
  const hide = (from, to) => hidden.fill(1, from, to);
  for (const match of text.matchAll(/!?(?:\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\([^)]*\))/gu)) {
    hide(match.index, match.index + match[0].length);
    const label = match[2] || match[1] || match[3];
    if (label) { const labelOffset = match[2] ? match[0].indexOf('|') + 1 : match[3] ? match[0].indexOf('[') + 1 : match[0].indexOf('[[') + 2, start = match.index + labelOffset; hidden.fill(0, start, start + label.length); }
  }
  for (const match of text.matchAll(/<\/?[A-Za-z][^>]*>|^\s{0,3}>\s?/gmu)) hide(match.index, match.index + match[0].length);
  for (const match of text.matchAll(/(?<![\p{L}\p{N}])(\*\*|__|~~|`+|\*|_)(?=\S)([\s\S]*?\S)\1/gu)) { hide(match.index, match.index + match[1].length); hide(match.index + match[0].length - match[1].length, match.index + match[0].length); }
  for (let index = 0; index < text.length; index++) if (!hidden[index]) { characters.push(text[index]); positions.push(index); }
  return { text: characters.join(''), positions };
}

export function inNotePhraseHighlight(unit, queryFocus, passageFocus, contextOffset, sourcePositions) {
  const range = inNoteFocusRange(queryFocus, passageFocus, contextOffset, contextOffset + unit.phrase.length);
  if (!range || range.from < 0 || range.to > unit.phrase.length || range.to <= range.from) return null;
  let projected = sourcePositions ? { text: unit.phrase, positions: sourcePositions } : null;
  if (!projected) {
    const raw = inNoteProjection(unit.sourcePhrase), characters = [], positions = [];
    for (let index = 0; index < raw.text.length; index++) {
      const character = raw.text[index], space = /\s/u.test(character);
      if (space && (!characters.length || characters.at(-1) === ' ')) continue;
      characters.push(space ? ' ' : character); positions.push(raw.positions[index]);
    }
    if (characters.at(-1) === ' ') { characters.pop(); positions.pop(); }
    projected = { text: characters.join(''), positions };
  }
  if (projected.text !== unit.phrase) return null;
  const from = projected.positions[range.from], to = projected.positions[range.to - 1] + 1;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to) return null;
  return { from: unit.from + from, to: unit.from + to, phrase: unit.phrase.slice(range.from, range.to), sourcePhrase: unit.sourcePhrase.slice(from, to) };
}

export function inNoteUnits(source) {
  const text = String(source || ''), units = [], headings = [], lines = [...text.matchAll(/[^\n]*(?:\n|$)/gu)], blocks = [];
  let fence = '', frontmatter = /^---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/u.test(text), block = null, list = false;
  const flush = () => { if (block) blocks.push(block); block = null; };
  for (const [lineIndex, lineMatch] of lines.entries()) {
    const line = lineMatch[0].replace(/\r?\n$/u, ''), offset = lineMatch.index;
    if (frontmatter) { if (lineIndex > 0 && /^(?:---|\.\.\.)\s*$/u.test(line)) frontmatter = false; continue; }
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fenced) { flush(); if (!fence) fence = fenced[1]; else if (fenced[1][0] === fence[0] && fenced[1].length >= fence.length) fence = ''; continue; }
    if (fence || !line.trim()) { flush(); list = false; continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)/u);
    if (heading) { flush(); headings.length = heading[1].length; headings[heading[1].length - 1] = inNoteProjection(heading[2]).text; blocks.push({ from: offset + line.indexOf(heading[2]), to: offset + line.length, heading: headings.slice(0, -1).filter(Boolean).join(' > '), line: lineIndex }); list = false; continue; }
    const listItem = /^\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)/u.test(line);
    if (/^(?:\s{4}|\t)/u.test(line) && !listItem && !list) { flush(); continue; }
    const prefix = line.match(/^\s*(?:(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s*)?)/u)?.[0].length || 0;
    if (listItem) { flush(); list = true; }
    if (!block) block = { from: offset + prefix, to: offset + line.length, heading: headings.filter(Boolean).join(' > '), line: lineIndex };
    else block.to = offset + line.length;
  }
  flush();
  for (const block of blocks) {
    const projection = inNoteProjection(text.slice(block.from, block.to));
    // Decimal numbers and times inside a line keep their context.
    const sentences = [...projection.text.matchAll(/(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+(?=\s|$)|$)/gu)];
    for (const sentence of sentences) {
      const words = [...sentence[0].matchAll(/\S+/gu)];
      if (!words.length) continue;
      let start = 0;
      while (start < words.length) {
        if (words[start][0].length > 220) { start++; continue; }
        let end = start + 1;
        while (end < words.length && end - start < 36 && words[end].index + words[end][0].length - words[start].index <= 220) end++;
        const fromPlain = sentence.index + words[start].index, toPlain = sentence.index + words[end - 1].index + words[end - 1][0].length;
        const from = block.from + projection.positions[fromPlain], to = block.from + projection.positions[toPlain - 1] + 1;
        const phrase = projection.text.slice(fromPlain, toPlain).trim().replace(/\s+/gu, ' ');
        if (phrase.length >= 3) {
          const unit = { from, to, phrase, sourcePhrase: text.slice(from, to), heading: block.heading, line: block.line }, positions = []; let space = false;
          for (let index = fromPlain; index < toPlain; index++) { const nextSpace = /\s/u.test(projection.text[index]); if (!nextSpace || !space) positions.push(block.from + projection.positions[index] - from); space = nextSpace; }
          Object.defineProperty(unit, 'displayPositions', { value: new Uint32Array(positions) }); units.push(unit);
        }
        if (end >= words.length) break;
        start = Math.max(start + 1, end - 8);
      }
    }
  }
  return units;
}

export class InNoteMatcher {
  constructor({ embed, classify, batchSize = 16, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
    this.embed = embed; this.classify = classify; this.batchSize = batchSize; this.yieldControl = yieldControl;
    this.sources = new Map(); this.vectors = new Map(); this.classifications = new Map(); this.results = new Map();
  }
  async embeddings(texts, check, prepared = null) {
    const resolved = prepared || new Map();
    for (const text of texts) {
      if (resolved.has(text)) continue;
      const vector = this.vectors.get(text) || (prepared && [...this.sources.values()].map(source => source.vectors.get(text)).find(Boolean));
      if (vector) resolved.set(text, vector);
    }
    const missing = [...new Set(texts.filter(text => !resolved.has(text)))];
    for (let offset = 0; offset < missing.length; offset += this.batchSize) {
      current(check); const batch = missing.slice(offset, offset + this.batchSize), values = await this.embed(batch);
      if (values.length !== batch.length || values.some(value => !value?.length || value.length !== values[0].length || !Array.from(value).every(Number.isFinite))) throw new Error('In-note embedding model returned invalid vectors');
      // A completed embedding belongs to this immutable source, even if typing
      // superseded the query. Keep it so the next query can resume preparation.
      batch.forEach((text, index) => { resolved.set(text, values[index]); remember(this.vectors, text, values[index], 2048); });
      current(check);
      await this.yieldControl();
    }
    return texts.map(text => resolved.get(text));
  }
  async meaning(pairs, check) {
    const keys = pairs.map(pair => `${pair.premise}\0${pair.hypothesis}`), resolved = new Map(), missing = new Map();
    pairs.forEach((pair, index) => { const key = keys[index]; if (this.classifications.has(key)) resolved.set(key, this.classifications.get(key)); else missing.set(key, pair); });
    const entries = [...missing];
    for (let offset = 0; offset < entries.length; offset += this.batchSize) {
      current(check); const batch = entries.slice(offset, offset + this.batchSize), values = await this.classify(batch.map(([, pair]) => pair)); current(check);
      if (values.length !== batch.length || values.some(value => !['entailment', 'neutral', 'contradiction'].every(key => Number.isFinite(value?.[key]) && value[key] >= 0 && value[key] <= 1) || Math.abs(value.entailment + value.neutral + value.contradiction - 1) > .01)) throw new Error('In-note meaning model returned invalid scores');
      batch.forEach(([key], index) => { resolved.set(key, values[index]); remember(this.classifications, key, values[index], 512); });
      await this.yieldControl();
    }
    return keys.map(key => resolved.get(key));
  }
  search(query, source, options = {}) {
    // Only one query prepares/scores a snapshot at a time. Superseded requests
    // check their generation before starting, rather than queueing model work.
    const run = (this.pending || Promise.resolve()).then(() => this.searchCurrent(query, source, options));
    this.pending = run.catch(() => {}); return run;
  }
  async searchCurrent(query, source, { breadth = 'balanced', isCurrent, diagnostics = false } = {}) {
    current(isCurrent); const text = String(source || ''), literalQuery = String(query || '').trim();
    if (literalQuery.length < 2 || !text.trim()) return [];
    const preset = IN_NOTE_PRESETS[breadth] || IN_NOTE_PRESETS.balanced, key = JSON.stringify([literalQuery, text, breadth]), cached = this.results.get(key);
    if (cached && !diagnostics) return cached;
    const context = unit => [unit.heading.slice(-160), unit.phrase].filter(Boolean).join('. ');
    let prepared = this.sources.get(text);
    if (!prepared) { const units = inNoteUnits(text); prepared = remember(this.sources, text, { units, representations: units.map(context), vectors: new Map() }, 2); }
    const { units, representations } = prepared, anchors = [...new Set(meaningWords(literalQuery))].slice(0, 8), queryWords = new Set(anchors);
    // Pin this note's vectors independently of the small shared phrase cache.
    // Otherwise notes over 2,048 units evict themselves on every new query.
    const vectors = await this.embeddings(representations, isCurrent, prepared.vectors), [queryVector] = await this.embeddings([literalQuery], isCurrent);
    const candidates = units.map((unit, index) => ({ ...unit, unitIndex: index, similarity: similarity(queryVector, vectors[index]), coverage: new Set(meaningWords(unit.phrase).filter(word => queryWords.has(word))).size })).filter(unit => unit.similarity >= preset.similarity);
    // Classify each occurrence with its own heading; never score a neighboring
    // sentence and then paint every occurrence of a winning string.
    const scores = await this.meaning(candidates.map(unit => ({ premise: context(unit), hypothesis: literalQuery })), isCurrent);
    const needsAnchors = anchors.length > 1 && candidates.some((unit, index) => unit.coverage > 0 && unit.coverage < anchors.length && scores[index].entailment >= preset.entailment && scores[index].entailment < .9 && scores[index].contradiction <= preset.contradiction);
    const anchorVectors = needsAnchors ? await this.embeddings(anchors, isCurrent) : [];
    const findings = candidates.map((unit, index) => {
      const vector = vectors[unit.unitIndex];
      return { ...unit, ...scores[index], specificity: anchorVectors.length ? unit.similarity - Math.max(...anchorVectors.map(anchor => similarity(anchor, vector))) : -Infinity };
    }).filter(unit => unit.contradiction <= preset.contradiction && (unit.entailment >= preset.entailment && (anchors.length < 2 || !unit.coverage || unit.coverage === anchors.length || unit.specificity >= -.015 || unit.entailment >= .9) || unit.neutral >= .90 && unit.entailment >= .015 && unit.contradiction <= .10 && unit.similarity >= preset.neutralSimilarity && !unit.coverage));
    current(isCurrent);
    const selected = [];
    for (const unit of findings.sort((a, b) => b.entailment - a.entailment || b.similarity - a.similarity)) {
      if (!selected.some(other => unit.from < other.to && unit.to > other.from)) selected.push(unit);
    }
    const matches = selected.sort((a, b) => a.from - b.from).map(unit => {
      const highlight = inNotePhraseHighlight(unit, queryVector.focus, vectors[unit.unitIndex].focus, representations[unit.unitIndex].length - unit.phrase.length, prepared.units[unit.unitIndex].displayPositions);
      return { from: unit.from, to: unit.to, phrase: unit.phrase, sourcePhrase: unit.sourcePhrase, score: unit.entailment, similarity: unit.similarity, kind: 'semantic', ...(highlight ? { highlight } : {}) };
    });
    remember(this.results, key, matches, 4);
    return diagnostics ? { matches, candidates: candidates.map((unit, index) => ({ ...unit, ...scores[index] })) } : matches;
  }
}
