// Reuse one token alignment for conservative query evidence and display focus.
const FUNCTION_WORDS = new Set('a an the of to for from in on at about is are was were be been being this that it its with and or how when what where who whom whose which his her their our your my each as before after again later by so there those these i you he she we they do does did have has had can could will would should may might among than then while although because both all some'.split(' '));
const NEGATION = /^(?:no|not|never|without|cannot|neither|nor|cant|wont|dont|doesnt|didnt|isnt|arent|wasnt|werent)$/u;
const surfaceWords = text => { let previous = 0; return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’:_-][\p{L}\p{N}\p{M}]+)*/gu)].map(match => { const word = { from: match.index, to: match.index + match[0].length, text: wordKey(match[0]), breakBefore: /[,;.!?]/u.test(text.slice(previous, match.index)) }; previous = word.to; return word; }); };
function wordKey(text) { return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/gu, ''); }
function stem(text) { return text.length > 3 ? text.replace(/s$/u, '') : text; }

// Preserve UTF-16 source positions through the uncased WordPiece normalizer.
function normalizedPositions(text) {
  let normalized = ''; const positions = [];
  for (let offset = 0; offset < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(offset)), value = character.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let index = 0; index < value.length; index++) positions.push({ from: offset, to: offset + character.length });
    normalized += value; offset += character.length;
  }
  return { text: normalized, positions };
}

export function packInNoteFocus(text, pieces, hidden, center, dimension) {
  // Attribution is optional for unusually large pasted queries; never retain a
  // token cache proportional to text the encoder cannot meaningfully inspect.
  if (text.length > 8192) return null;
  const projection = normalizedPositions(text), words = surfaceWords(text), sums = words.map(() => new Float32Array(dimension)), counts = new Uint16Array(words.length);
  let cursor = 0, wordIndex = 0;
  for (let token = 0; token < pieces.length; token++) {
    const piece = pieces[token];
    if (piece === '[UNK]') {
      while (/\s/u.test(projection.text[cursor] || '') && cursor < projection.text.length) cursor++;
      const position = projection.positions[cursor]?.from, unknown = words.find(word => word.from <= position && word.to > position);
      if (unknown) while (projection.positions[cursor]?.from < unknown.to) cursor++;
      else cursor++;
      continue;
    }
    if (!piece || /^\[.*\]$/u.test(piece)) continue;
    const value = piece.replace(/^##/u, ''), at = projection.text.indexOf(value, cursor); if (at < 0) return null;
    const first = projection.positions[at], last = projection.positions[at + value.length - 1]; if (!first || !last) return null;
    cursor = at + value.length;
    while (wordIndex < words.length && words[wordIndex].to <= first.from) wordIndex++;
    const word = words[wordIndex];
    if (!word || first.from < word.from || last.to > word.to) continue;
    counts[wordIndex]++;
    for (let index = 0, base = token * dimension; index < dimension; index++) sums[wordIndex][index] += hidden[base + index];
  }
  const selected = words.map((word, index) => ({ word, index })).filter(({ index }) => counts[index]), vectors = new Int8Array(selected.length * dimension);
  for (let row = 0; row < selected.length; row++) {
    const { index } = selected[row], values = sums[index]; let squared = 0;
    // Remove shared sentence context from attribution, retaining the original
    // pooled vector unchanged for retrieval and sentence verification.
    for (let column = 0; column < dimension; column++) { values[column] = values[column] / counts[index] - .7 * center[column]; squared += values[column] ** 2; }
    const scale = 127 / (Math.sqrt(squared) || 1);
    for (let column = 0; column < dimension; column++) vectors[row * dimension + column] = Math.max(-127, Math.min(127, Math.round(values[column] * scale)));
  }
  return { words: selected.map(({ word }) => word), vectors, dimension };
}

export function inNoteWordAlignment(query, passage, from = 0, to = Infinity) {
  if (!query?.words?.length || !passage?.words?.length || !query.vectors || !passage.vectors || !Number.isInteger(query.dimension) || query.dimension < 1 || query.dimension !== passage.dimension) return null;
  const dimension = query.dimension, queryRows = query.words.map((word, index) => ({ ...word, index })).filter(word => !FUNCTION_WORDS.has(word.text)).slice(0, 12);
  const words = passage.words.map((word, index) => ({ ...word, index })).filter(word => word.from >= from && word.to <= to);
  if (!queryRows.length || !words.length || query.vectors.length !== query.words.length * dimension || passage.vectors.length !== passage.words.length * dimension) return null;
  const scores = new Float32Array(words.length * queryRows.length); scores.fill(-1);
  for (let row = 0; row < words.length; row++) {
    if (FUNCTION_WORDS.has(words[row].text)) continue;
    for (let anchor = 0; anchor < queryRows.length; anchor++) {
      let dot = 0; const a = queryRows[anchor].index * dimension, b = words[row].index * dimension;
      for (let column = 0; column < dimension; column++) dot += query.vectors[a + column] * passage.vectors[b + column];
      scores[row * queryRows.length + anchor] = dot / 16129 + (stem(queryRows[anchor].text) === stem(words[row].text) ? .15 : 0);
    }
  }
  return { queryRows, words, scores };
}

// Absolute support for each content concept prevents a shared topic (especially
// a heading) from standing in for the requested action or relationship. Degree
// modifiers are weaker evidence than content concepts; NLI still checks polarity.
const DEGREE_MODIFIERS = new Set('big brief broad deep extreme great high huge intense large little long low major minor quick severe short small strong tiny very'.split(' '));
export function inNoteEvidence(alignment, contexts = []) {
  if (!alignment) return null;
  const { queryRows, words, scores } = alignment, support = new Float32Array(queryRows.length), body = new Float32Array(queryRows.length);
  support.fill(-1); body.fill(-1);
  for (let row = 0; row < words.length; row++) for (let anchor = 0; anchor < queryRows.length; anchor++) {
    // The exact-word bonus belongs to display selection, never evidence gating.
    const value = scores[row * queryRows.length + anchor] - (stem(queryRows[anchor].text) === stem(words[row].text) ? .15 : 0);
    support[anchor] = Math.max(support[anchor], value);
    body[anchor] = Math.max(body[anchor], value);
  }
  for (const context of contexts) if (context && context.queryRows.length === queryRows.length) for (let row = 0; row < context.words.length; row++) for (let anchor = 0; anchor < queryRows.length; anchor++) {
    const value = context.scores[row * queryRows.length + anchor] - (stem(queryRows[anchor].text) === stem(context.words[row].text) ? .15 : 0);
    support[anchor] = Math.max(support[anchor], value);
  }
  const contentWords = words.filter(word => !FUNCTION_WORDS.has(word.text)).length;
  // This is a missing-evidence veto, not a second relevance score. Keep its
  // floor conservative across q8 CPU and fp16 GPU token representations.
  // One strong shared word cannot drown out the other requested concepts.
  const strongest = Math.max(...queryRows.map((word, index) => DEGREE_MODIFIERS.has(word.text) ? 0 : support[index])), minimum = Math.max(.15, .35 * strongest);
  const complete = contentWords >= Math.min(2, queryRows.length) && queryRows.every((word, index) => support[index] >= (DEGREE_MODIFIERS.has(word.text) ? .12 : minimum));
  const grounded = queryRows.some((word, index) => !DEGREE_MODIFIERS.has(word.text) && body[index] >= .25);
  const strongestBody = Math.max(...queryRows.map((word, index) => DEGREE_MODIFIERS.has(word.text) ? 0 : body[index]));
  const reliable = complete && grounded && queryRows.every((word, index) => DEGREE_MODIFIERS.has(word.text) || body[index] >= Math.max(.25, .5 * strongestBody));
  return { supported: complete && grounded, complete, grounded, reliable, support: Array.from(support), body: Array.from(body) };
}

export function inNoteFocusRange(query, passage, from = 0, to = Infinity, aligned = null) {
  const alignment = aligned || inNoteWordAlignment(query, passage, from, to);
  if (!alignment) return null;
  const { queryRows } = alignment, indices = alignment.words.map((word, index) => ({ word, index })).filter(({ word }) => word.from >= from && word.to <= to), words = indices.map(({ word }) => word);
  if (!words.length) return null;
  const scores = new Float32Array(words.length * queryRows.length);
  indices.forEach(({ index }, row) => scores.set(alignment.scores.subarray(index * queryRows.length, (index + 1) * queryRows.length), row * queryRows.length));
  const minimumWords = Math.min(2, queryRows.length, words.filter(word => !FUNCTION_WORDS.has(word.text)).length);
  const queryKeys = new Set(queryRows.map(word => stem(word.text))), anchors = words.map(word => queryKeys.has(stem(word.text)));
  let best = -Infinity, first = 0, last = words.length - 1;
  for (let start = 0; start < words.length; start++) {
    if (FUNCTION_WORDS.has(words[start].text)) continue;
    const maxima = new Float32Array(queryRows.length); maxima.fill(-1); let contentWords = 0, crossedBoundary = false, unsupportedBoundary = false, segmentAnchor = false;
    for (let end = start; end < Math.min(words.length, start + Math.max(12, queryRows.length * 2)); end++) {
      if (end > start && words[end].breakBefore) { crossedBoundary = true; if (!segmentAnchor) unsupportedBoundary = true; segmentAnchor = false; }
      segmentAnchor ||= anchors[end];
      let sum = 0, minimum = Infinity;
      for (let anchor = 0; anchor < queryRows.length; anchor++) { maxima[anchor] = Math.max(maxima[anchor], scores[end * queryRows.length + anchor]); sum += maxima[anchor]; minimum = Math.min(minimum, maxima[anchor]); }
      if (!FUNCTION_WORDS.has(words[end].text)) contentWords++;
      // A phrase cannot join an unrelated introductory clause to a predicate.
      // Explicit anchors on both sides still allow names across a parenthesis.
      if (FUNCTION_WORDS.has(words[end].text) || contentWords < minimumWords || crossedBoundary && (unsupportedBoundary || !segmentAnchor)) continue;
      const score = sum / queryRows.length + .5 * minimum - .025 * (end - start);
      if (score > best) { best = score; first = start; last = end; }
    }
  }
  // Do not clip a negated predicate, a modifier's noun, or a numeric deadline.
  for (let index = first - 1; index >= Math.max(0, first - 3); index--) {
    if (words[index + 1].breakBefore) break;
    if (NEGATION.test(words[index].text)) { first = index; break; }
    if (['and', 'but', 'yet', 'however'].includes(words[index].text)) break;
  }
  let predicate = first - 1;
  while (predicate >= 0 && /^(?:the|a|an|its|his|her|their|our|your|my)$/u.test(words[predicate].text) && !words[predicate + 1].breakBefore) predicate--;
  if (predicate >= 0 && !words[predicate + 1].breakBefore && /(?:ed|ing)$/u.test(words[predicate].text)) first = predicate;
  // A selected verb followed by an article/possessive still needs its object:
  // "settled" must not drop "the outstanding bill" from the visible phrase.
  if (/(?:ed|ing)$/u.test(words[last].text) && /^(?:the|a|an|its|his|her|their|our|your|my)$/u.test(words[last + 1]?.text || '') && words[last + 2] && !words[last + 1].breakBefore && !words[last + 2].breakBefore) last += 2;
  if ((/(?:ing|ed|ive|ous|ial|al|ic|ful|less)$/u.test(words[last].text) || words[last].text.includes('-')) && words[last + 1] && !words[last + 1].breakBefore && !FUNCTION_WORDS.has(words[last + 1].text)) last++;
  if (/^(?:after|before|until|by|at|for|within)$/u.test(words[last + 1]?.text || '') && /\d/u.test(words[last + 2]?.text || '')) {
    last += 2;
    if (/^(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|am|pm)$/u.test(words[last + 1]?.text || '')) last++;
  }
  // A contrast can change which clause makes the verified statement true.
  // Keep that relationship together rather than attributing it to one side.
  if (words.some(word => /^(?:but|yet|however|until|unless|instead|rather|although)$/u.test(word.text))) { first = 0; last = words.length - 1; }
  return { from: words[first].from - from, to: words[last].to - from };
}
