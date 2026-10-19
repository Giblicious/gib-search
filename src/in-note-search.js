// In-note matching deliberately has no dependency on the vault's passage index.
// Every finding retains its occurrence in the exact editor snapshot that was scored.
import { inNoteFocusRange, inNoteWordAlignment, inNoteEvidence } from './in-note-focus.js';
export const IN_NOTE_MATCH_VERSION = 5;
export const IN_NOTE_PRESETS = Object.freeze({
  precise: { similarity: .48, entailment: .60, contradiction: .25, neutralSimilarity: .70 },
  balanced: { similarity: .40, entailment: .40, contradiction: .35, neutralSimilarity: .60 },
  broad: { similarity: .34, entailment: .30, contradiction: .40, neutralSimilarity: .60 },
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

export function inNotePhraseHighlight(unit, queryFocus, passageFocus, contextOffset, sourcePositions, alignment) {
  const range = inNoteFocusRange(queryFocus, passageFocus, contextOffset, contextOffset + unit.phrase.length, alignment);
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
    if (heading) { flush(); headings.length = heading[1].length; headings[heading[1].length - 1] = inNoteProjection(heading[2]).text; blocks.push({ from: offset + line.indexOf(heading[2]), to: offset + line.length, heading: headings.slice(0, -1).filter(Boolean).join(' > '), topics: headings.slice(0, -1).filter(Boolean), line: lineIndex, isHeading: true }); list = false; continue; }
    const listItem = /^\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)/u.test(line);
    if (/^(?:\s{4}|\t)/u.test(line) && !listItem && !list) { flush(); continue; }
    const prefix = line.match(/^\s*(?:(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s*)?)/u)?.[0].length || 0;
    if (listItem) { flush(); list = true; }
    if (!block) block = { from: offset + prefix, to: offset + line.length, heading: headings.filter(Boolean).join(' > '), topics: headings.filter(Boolean), line: lineIndex };
    else block.to = offset + line.length;
  }
  flush();
  for (const block of blocks) {
    const projection = inNoteProjection(text.slice(block.from, block.to));
    // Decimal numbers and times inside a line keep their context.
    const sentences = [...projection.text.matchAll(/(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+(?=\s|$)|$)/gu)];
    for (const sentence of sentences) {
      // A numbered record label is structural context, like a list marker or
      // heading. It must not change the statement submitted to the verifier.
      const record = block.isHeading ? null : sentence[0].match(/^\s*[\p{L}][\p{L}\p{N} _-]{0,40}\s+\d+:\s+/u), label = record?.[0].trim().replace(/:$/u, ''), content = record ? sentence[0].slice(record[0].length) : sentence[0];
      const words = [...content.matchAll(/\S+/gu)];
      if (!words.length) continue;
      let start = 0;
      while (start < words.length) {
        if (words[start][0].length > 220) { start++; continue; }
        let end = start + 1;
        while (end < words.length && end - start < 36 && words[end].index + words[end][0].length - words[start].index <= 220) end++;
        const fromPlain = sentence.index + (record?.[0].length || 0) + words[start].index, toPlain = sentence.index + (record?.[0].length || 0) + words[end - 1].index + words[end - 1][0].length;
        const from = block.from + projection.positions[fromPlain], to = block.from + projection.positions[toPlain - 1] + 1;
        const phrase = projection.text.slice(fromPlain, toPlain).trim().replace(/\s+/gu, ' ');
        if (phrase.length >= 3) {
          const unit = { from, to, phrase, sourcePhrase: text.slice(from, to), heading: [block.heading, label].filter(Boolean).join(' > '), contextHeading: block.heading, topics: [...block.topics, ...(label ? [label] : [])].map(topic => topic.slice(-160)), line: block.line, isHeading: Boolean(block.isHeading) }, positions = []; let space = false;
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
    // Group similarly sized premises so short sentences do not pay for the
    // longest sentence's padding throughout every CPU verification batch.
    const entries = [...missing].sort((first, second) => first[1].premise.length - second[1].premise.length);
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
  async searchCurrent(query, source, { breadth = 'balanced', isCurrent, diagnostics = false, retrievalOnly = false } = {}) {
    current(isCurrent); const text = String(source || ''), literalQuery = String(query || '').trim();
    if (literalQuery.length < 2 || !text.trim()) return [];
    const preset = IN_NOTE_PRESETS[breadth] || IN_NOTE_PRESETS.balanced, key = JSON.stringify([literalQuery, text, breadth]), cached = this.results.get(key);
    if (cached && !diagnostics) return cached;
    let prepared = this.sources.get(text);
    if (!prepared) { const units = inNoteUnits(text); prepared = remember(this.sources, text, { units, representations: [...new Set(units.flatMap(unit => [unit.phrase, ...unit.topics]))], vectors: new Map() }, 2); }
    const { units, representations } = prepared, anchors = [...new Set(meaningWords(literalQuery))].slice(0, 8), queryWords = new Set(anchors);
    // Pin this note's vectors independently of the small shared phrase cache.
    // Otherwise notes over 2,048 units evict themselves on every new query.
    await this.embeddings(representations, isCurrent, prepared.vectors);
    const [queryVector] = await this.embeddings([literalQuery], isCurrent), vectors = units.map(unit => prepared.vectors.get(unit.phrase)), topicAlignments = new Map(), queryFocus = queryVector.focus;
    const alignments = new Map(), retrieved = units.map((unit, index) => {
      // Headings may improve candidate recall. They can fill missing concepts
      // only when the sentence refers back to a topic; verification stays local.
      const contextual = unit.topics.length > 0 && /\b(?:it|its|this|these|those|that|such|topic|subject)\b/iu.test(unit.phrase), vector = vectors[index];
      const bodySimilarity = similarity(queryVector, vector); let score = bodySimilarity;
      for (const topic of unit.topics) {
        const heading = prepared.vectors.get(topic); let squared = 0, dot = 0;
        for (let column = 0; column < vector.length; column++) { const value = .7 * vector[column] + .3 * heading[column]; squared += value * value; dot += queryVector[column] * value; }
        score = Math.max(score, dot / (Math.sqrt(squared) || 1));
      }
      return { ...unit, unitIndex: index, contextual, bodySimilarity, similarity: score, coverage: new Set(meaningWords(unit.phrase).filter(word => queryWords.has(word))).size };
    }).filter(unit => unit.similarity >= preset.similarity);
    // Answer retrieval uses its full-sentence ranker and consistency checks;
    // defer token attribution until an answer is actually selected.
    if (retrievalOnly) return { matches: [], candidates: retrieved };
    for (let index = 0; index < retrieved.length; index++) {
      if (index && index % 64 === 0) { current(isCurrent); await this.yieldControl(); }
      const unit = retrieved[index], alignment = inNoteWordAlignment(queryFocus, vectors[unit.unitIndex].focus);
      const contexts = unit.contextual ? unit.topics.map(topic => { if (!topicAlignments.has(topic)) topicAlignments.set(topic, inNoteWordAlignment(queryFocus, prepared.vectors.get(topic).focus)); return topicAlignments.get(topic); }) : [];
      unit.evidence = inNoteEvidence(alignment, contexts);
      if (alignment && unit.evidence?.supported) alignments.set(unit.unitIndex, alignment);
    }
    const candidates = retrieved.filter(unit => !unit.evidence || unit.evidence.supported);
    // Headings can resolve a topic for retrieval, but cannot assert that every
    // sentence beneath them entails the query. Verify the actual occurrence.
    const scores = await this.meaning(candidates.map(unit => ({ premise: unit.phrase, hypothesis: literalQuery })), isCurrent);
    const needsAnchors = anchors.length > 1 && candidates.some((unit, index) => !unit.evidence && unit.coverage > 0 && unit.coverage < anchors.length && scores[index].entailment >= preset.entailment && scores[index].entailment < .9 && scores[index].contradiction <= preset.contradiction);
    const anchorVectors = needsAnchors ? await this.embeddings(anchors, isCurrent) : [];
    const findings = candidates.map((unit, index) => {
      const vector = vectors[unit.unitIndex];
      return { ...unit, ...scores[index], specificity: anchorVectors.length ? unit.similarity - Math.max(...anchorVectors.map(anchor => similarity(anchor, vector))) : -Infinity };
    }).filter(unit => {
      if (unit.contradiction > preset.contradiction) return false;
      // A mixed verdict needs balanced support for every query concept in the
      // sentence itself. A heading or one strong shared word cannot supply it.
      const specific = unit.evidence || anchors.length < 2 || !unit.coverage || unit.coverage === anchors.length || unit.specificity >= -.015 || unit.entailment >= .9;
      const entailed = unit.entailment >= preset.entailment && unit.entailment >= (unit.evidence?.reliable ? 1 : 2) * unit.contradiction && specific;
      // A sentence with "it" or "this topic" may remain neutral in isolation.
      // Only supported body + heading evidence may fill that missing reference.
      const contextual = unit.contextual && unit.evidence?.supported;
      const neutralSimilarity = contextual ? unit.similarity : unit.bodySimilarity;
      const neutral = unit.neutral >= .90 && (unit.entailment >= .015 || contextual) && unit.contradiction <= .10 && neutralSimilarity >= preset.neutralSimilarity && !unit.coverage;
      return entailed || neutral;
    });
    current(isCurrent);
    const selected = [];
    for (const unit of findings.sort((a, b) => b.entailment - a.entailment || b.similarity - a.similarity)) {
      if (!selected.some(other => unit.from < other.to && unit.to > other.from)) selected.push(unit);
    }
    const matches = selected.sort((a, b) => a.from - b.from).map(unit => {
      const highlight = inNotePhraseHighlight(unit, queryFocus, vectors[unit.unitIndex].focus, 0, prepared.units[unit.unitIndex].displayPositions, alignments.get(unit.unitIndex));
      return { from: unit.from, to: unit.to, phrase: unit.phrase, sourcePhrase: unit.sourcePhrase, score: unit.entailment, similarity: unit.similarity, kind: 'semantic', ...(highlight ? { highlight } : {}) };
    });
    remember(this.results, key, matches, 4);
    if (!diagnostics) return matches;
    const verified = new Map(candidates.map((unit, index) => [unit.unitIndex, scores[index]]));
    return { matches, candidates: retrieved.map(unit => ({ ...unit, ...(verified.get(unit.unitIndex) || { rejected: 'unsupported-query-evidence' }) })) };
  }
}
