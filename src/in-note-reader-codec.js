// Shared by the worker and audit harness. All returned spans refer to the
// original candidate string, never reconstructed text from a language model.
export const IN_NOTE_READER_FORMAT = 1;
export function inNoteReaderInput(target, context = '') {
  const text = String(target || '');
  return { passage: `Target: ${text}${context ? `\nContext: ${context}` : ''}`, targetFrom: 8, targetTo: 8 + text.length };
}

function normalizedSource(text, wordpiece = false) {
  const positions = [], characters = [];
  const segments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text) : [...text].map((segment, index) => ({ segment, index }));
  let fallbackOffset = 0;
  for (const item of segments) {
    const from = typeof Intl.Segmenter === 'function' ? item.index : fallbackOffset;
    fallbackOffset += item.segment.length;
    const normalized = wordpiece ? item.segment.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() : item.segment.normalize('NFKC');
    for (const character of normalized) {
      const value = /\s/u.test(character) ? ' ' : character;
      if (value === ' ' && characters.at(-1) === ' ') { positions.at(-1).to = from + item.segment.length; continue; }
      for (let index = 0; index < value.length; index++) { characters.push(value[index]); positions.push({ from, to: from + item.segment.length }); }
    }
  }
  return { text: characters.join(''), positions };
}

export function inNoteReaderTokenPositions(text, pieces, { wordpiece = false } = {}) {
  const normalized = normalizedSource(String(text), wordpiece), positions = []; let cursor = 0;
  for (const piece of pieces) {
    if (!piece) { positions.push(null); continue; }
    if (wordpiece && piece === '[UNK]') {
      while (normalized.text[cursor] === ' ') cursor++;
      const start = cursor, first = normalized.positions[cursor];
      if (!first) return null;
      if (/[\p{L}\p{N}_]/u.test(normalized.text[cursor])) while (cursor < normalized.text.length && /[\p{L}\p{N}_]/u.test(normalized.text[cursor])) cursor++;
      else while (cursor < normalized.positions.length && normalized.positions[cursor].from === first.from) cursor++;
      positions.push({ from: first.from, to: normalized.positions[Math.max(start, cursor - 1)].to }); continue;
    }
    const raw = piece.replace(/^##/u, '').replaceAll('▁', ' ').trim();
    const value = wordpiece ? raw.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() : raw.normalize('NFKC');
    if (!value) { positions.push(null); continue; }
    const at = normalized.text.indexOf(value, cursor);
    // Fail closed on an unsupported tokenizer normalisation. Skipping arbitrary
    // words could align a token with a later duplicate and highlight it falsely.
    if (at < 0 || normalized.text.slice(cursor, at).trim()) return null;
    const first = normalized.positions[at], last = normalized.positions[at + value.length - 1];
    if (!first || !last) return null;
    positions.push({ from: first.from, to: last.to }); cursor = at + value.length;
  }
  return positions;
}

export function inNoteReaderQuery(query) { return `${/\?\s*$|^(?:how|why|what|where|when|who|whom|whose|which)\b/iu.test(query) ? 'Question' : 'Wording'}: ${query}`; }
export function inNoteReaderSentenceRanges(pair) {
  return [...pair.passage.slice(pair.targetFrom, pair.targetTo).matchAll(/(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+(?=\s|$)|$)/gu)].map(match => ({ from: pair.targetFrom + match.index, to: pair.targetFrom + match.index + match[0].length }));
}

const tokenCaches = new WeakMap();
function tokenizerCache(tokenizer) {
  if (!tokenCaches.has(tokenizer)) tokenCaches.set(tokenizer, { documents: new Map(), queries: new Map(), bytes: 0, cls: tokenizer.encode('', { add_special_tokens: true })[0] });
  return tokenCaches.get(tokenizer);
}

function passagePositions(tokenizer, ids, pair) {
  const start = tokenizer.encode(pair.query, { add_special_tokens: false }).length + 2;
  let end = ids.length;
  while (end > start && ids[end - 1] === tokenizer.pad_token_id) end--;
  if (ids[end - 1] === tokenizer.sep_token_id) end--;
  const raw = tokenizer.tokenize(pair.passage, { add_special_tokens: false }).slice(0, Math.max(0, end - start));
  const encoded = tokenizer.model.convert_tokens_to_ids(raw);
  if (encoded.length !== end - start || encoded.some((id, index) => id !== ids[start + index])) return { start, positions: null };
  return { start, positions: inNoteReaderTokenPositions(pair.passage, raw, { wordpiece: tokenizer.model.config?.type === 'WordPiece' }) };
}

export function inNoteReaderFeatures(tokenizer, pairs, Tensor, { queryFormat = 0 } = {}) {
  const cache = tokenizerCache(tokenizer), wordpiece = tokenizer.model.config?.type === 'WordPiece';
  const prepared = pairs.map(pair => {
    const query = queryFormat ? inNoteReaderQuery(pair.query) : pair.query;
    let queryIds = cache.queries.get(query);
    if (!queryIds) { queryIds = tokenizer.encode(query, { add_special_tokens: false }); cache.queries.set(query, queryIds); if (cache.queries.size > 48) cache.queries.delete(cache.queries.keys().next().value); }
    if (queryIds.length > 128) throw new Error('Use a shorter query for in-note meaning search');
    let document = cache.documents.get(pair.passage);
    if (!document) {
      const pieces = tokenizer.tokenize(pair.passage, { add_special_tokens: false }), ids = tokenizer.model.convert_tokens_to_ids(pieces);
      document = { ids, positions: inNoteReaderTokenPositions(pair.passage, pieces, { wordpiece }), bytes: pair.passage.length * 2 + ids.length * 32 };
      cache.documents.set(pair.passage, document); cache.bytes += document.bytes;
      while (cache.bytes > 16 * 1024 * 1024 || cache.documents.size > 512) { const key = cache.documents.keys().next().value; cache.bytes -= cache.documents.get(key).bytes; cache.documents.delete(key); }
    }
    const count = Math.min(document.ids.length, 384 - queryIds.length - 3), start = queryIds.length + 2;
    const positions = document.positions?.slice(0, count) || null, visibleTo = positions?.at(-1)?.to || 0;
    return { pair, ids: [cache.cls, ...queryIds, tokenizer.sep_token_id, ...document.ids.slice(0, count), tokenizer.sep_token_id], start, positions, truncatedTarget: visibleTo < pair.targetTo && Boolean(pair.passage.slice(visibleTo, pair.targetTo).trim()), sentences: inNoteReaderSentenceRanges(pair) };
  });
  const rows = pairs.length, length = Math.max(...prepared.map(row => row.ids.length));
  const ids = new BigInt64Array(rows * length), attention = new BigInt64Array(rows * length), types = new BigInt64Array(rows * length), mask = new BigInt64Array(rows * length), sentenceIds = new BigInt64Array(rows * length); sentenceIds.fill(-1n);
  if (tokenizer.pad_token_id) ids.fill(BigInt(tokenizer.pad_token_id));
  prepared.forEach((row, index) => {
    row.ids.forEach((id, token) => { ids[index * length + token] = BigInt(id); attention[index * length + token] = 1n; if (token >= row.start) types[index * length + token] = 1n; });
    row.positions?.forEach((at, token) => {
      if (at && at.from >= row.pair.targetFrom && at.to <= row.pair.targetTo) {
        mask[index * length + row.start + token] = 1n;
        const group = row.sentences.findIndex(sentence => at.from < sentence.to && at.to > sentence.from);
        sentenceIds[index * length + row.start + token] = BigInt(Math.min(7, Math.max(0, group)));
      }
    });
  });
  const inputs = { input_ids: new Tensor('int64', ids, [rows, length]), attention_mask: new Tensor('int64', attention, [rows, length]), token_type_ids: new Tensor('int64', types, [rows, length]), target_mask: new Tensor('int64', mask, [rows, length]), sentence_ids: new Tensor('int64', sentenceIds, [rows, length]) };
  Object.defineProperty(inputs, 'readerPositions', { value: prepared });
  return inputs;
}

function readerLabels(values, transition, weight) {
  if (!transition || !weight) return values.map(row => row.indexOf(Math.max(...row)));
  const path = new Int8Array(values.length * 3); let previous = [0, -100, -100];
  values.forEach((row, index) => {
    const maximum = Math.max(...row), sum = row.reduce((total, value) => total + Math.exp(value - maximum), 0), logTotal = maximum + Math.log(sum);
    const next = row.map((value, label) => {
      const scores = previous.map((prior, from) => prior + weight * transition[from][label]), best = scores.indexOf(Math.max(...scores));
      path[index * 3 + label] = best; return value - logTotal + scores[best];
    }); previous = next;
  });
  const labels = new Int8Array(values.length); let label = previous.indexOf(Math.max(...previous));
  for (let index = values.length - 1; index >= 0; index--) { labels[index] = label; label = path[index * 3 + label]; }
  return labels;
}

export function decodeInNoteReader(tokenizer, inputs, output, pairs, configuration = {}) {
  const [rows, length, width] = output.dims;
  if (rows !== pairs.length || !Number.isInteger(length) || length < 1 || ![4, 5].includes(width) || output.data?.length !== rows * length * width || !output.data.every(Number.isFinite)) throw new Error('In-note reader returned invalid outputs');
  const decoded = [];
  for (let row = 0; row < rows; row++) {
    if (inputs.readerPositions?.[row]?.truncatedTarget) { decoded.push({ probability: 0, spans: [] }); continue; }
    const ids = Array.from(inputs.input_ids.data.slice(row * length, (row + 1) * length), Number);
    const pair = pairs[row], { start: firstToken, positions } = inputs.readerPositions?.[row] || passagePositions(tokenizer, ids, pair), spans = [];
    const values = positions?.map((at, index) => at && at.from >= pair.targetFrom && at.to <= pair.targetTo ? Array.from(output.data.slice((row * length + firstToken + index) * width, (row * length + firstToken + index) * width + 3)) : [0, -100, -100]) || [];
    const labels = readerLabels(values, configuration.reader_transitions, configuration.reader_transition_weight || 0);
    let start = null, end = null, evidence = [], sentenceEvidence = [], activeSentence = null;
    const sentences = inputs.readerPositions?.[row]?.sentences || inNoteReaderSentenceRanges(pair);
    const finish = () => {
      if (start !== null && end > start) {
        const first = sentences.find(sentence => start >= sentence.from && start < sentence.to), last = sentences.find(sentence => end > sentence.from && end <= sentence.to);
        spans.push({ from: start, to: end, score: Math.min(...evidence), ...(width === 5 ? { sentenceProbability: Math.min(...sentenceEvidence) } : {}), ...(first && last ? { sentenceFrom: first.from, sentenceTo: last.to } : {}) });
      }
      start = end = null; evidence = []; sentenceEvidence = []; activeSentence = null;
    };
    if (positions) for (let index = 0; index < positions.length; index++) {
      const at = positions[index], base = (row * length + firstToken + index) * width;
      const logits = Array.from(output.data.slice(base, base + 3)), maximum = Math.max(...logits), probabilities = logits.map(value => Math.exp(value - maximum)), total = probabilities.reduce((a, b) => a + b, 0);
      let label = labels[index];
      if (!at || at.from < pair.targetFrom || at.to > pair.targetTo) label = 0;
      const sentence = at && sentences.find(range => at.from >= range.from && at.from < range.to);
      if (start !== null && sentence !== activeSentence) finish();
      if (!label || label === 1 && start !== null) finish();
      if (label) { if (start === null) { start = at.from; activeSentence = sentence; } end = at.to; evidence.push(probabilities[label] / total); if (width === 5) sentenceEvidence.push(1 / (1 + Math.exp(-output.data[base + 4]))); }
    }
    finish();
    const findings = new Map();
    for (const span of spans) {
      const key = `${span.sentenceFrom ?? span.from}:${span.sentenceTo ?? span.to}`, previous = findings.get(key);
      if (!previous) findings.set(key, { ...span });
      else { previous.from = Math.min(previous.from, span.from); previous.to = Math.max(previous.to, span.to); previous.score = Math.min(previous.score, span.score); if (width === 5) previous.sentenceProbability = Math.min(previous.sentenceProbability, span.sentenceProbability); }
    }
    decoded.push({ probability: 1 / (1 + Math.exp(-output.data[row * length * width + 3])), spans: [...findings.values()] });
  }
  return decoded;
}
