import assert from 'node:assert/strict';
import { PassageInNoteMatcher, inNoteReaderWindows } from '../src/in-note-reader.js';
import { inNoteReaderInput, inNoteReaderTokenPositions, decodeInNoteReader } from '../src/in-note-reader-codec.js';

const sample = '---\nsecret: hidden\n---\n# Journal\n\n> Maya **enjoyed the company** of strangers. She spoke quietly.\n\n```js\nnot searchable\n```\n';
const windows = inNoteReaderWindows(sample);
assert.ok(windows.every(window => sample.slice(window.from, window.to) === window.sourcePhrase));
assert.ok(windows.every(window => window.displayPositions.length === window.phrase.length));
assert.ok(!windows.some(window => /secret|searchable/.test(window.phrase)));
const body = windows.find(window => window.phrase.startsWith('Maya'));
assert.equal(body.phrase, 'Maya enjoyed the company of strangers. She spoke quietly.');
for (const window of windows) for (let i = 0; i < window.phrase.length; i++) {
  const mapped = sample[window.from + window.displayPositions[i]];
  assert.ok(mapped === window.phrase[i] || /\s/u.test(mapped) && window.phrase[i] === ' ', `Source offset lost: ${i}`);
}
const repeatedWords = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ') + '.';
assert.ok(inNoteReaderWindows(repeatedWords).every(window => window.phrase === repeatedWords.slice(window.from, window.to)), 'Overlapping sentence units duplicated text inside a reader window');
assert.deepEqual(inNoteReaderTokenPositions('Target: café 🤖', ['▁Target', ':', '▁café', '▁🤖']), [{ from: 0, to: 6 }, { from: 6, to: 7 }, { from: 8, to: 12 }, { from: 13, to: 15 }]);
assert.deepEqual(inNoteReaderTokenPositions('Ａ cafe\u0301', ['▁A', '▁café']), [{ from: 0, to: 1 }, { from: 2, to: 7 }]);
assert.equal(inNoteReaderTokenPositions('word skipped same', ['▁word', '▁same']), null, 'An alignment failure jumped to a later word');

const vector = new Float32Array(384); vector[0] = 1;
let reads = 0;
const options = { embed: async texts => texts.map(() => vector), yieldControl: async () => {}, read: async pairs => {
  reads += pairs.length;
  return pairs.map(pair => { const phrase = 'enjoyed the company', from = pair.passage.indexOf(phrase); return { probability: from >= pair.targetFrom && from < pair.targetTo ? .999 : .001, spans: from >= 0 ? [{ from, to: from + phrase.length, score: .99 }] : [] }; });
} };
const matcher = new PassageInNoteMatcher(options), stages = [];
const matches = await matcher.search('liked people', sample, { onProgress: progress => stages.push(progress.stage) });
assert.deepEqual(stages, ['paragraph', 'sentence', 'phrase']); assert.equal(matches.length, 1);
assert.equal(matches[0].highlight.phrase, 'enjoyed the company');
assert.equal(sample.slice(matches[0].highlight.from, matches[0].highlight.to), matches[0].highlight.sourcePhrase);
const beforeCache = reads; await matcher.search('liked people', sample); assert.equal(reads, beforeCache, 'A completed query ignored its cache');
const duplicate = Array.from({ length: 40 }, () => 'She enjoyed the company of strangers.').join('\n\n');
assert.equal((await matcher.search('liked people', duplicate)).length, 40, 'Repeated occurrences were deduplicated away');
const distinct = Array.from({ length: 80 }, (_, i) => `Person ${i} enjoyed the company of strangers.`).join('\n\n');
assert.equal((await matcher.search('liked people', distinct)).length, 80, 'Adaptive expansion skipped distinct occurrences after a partial batch');
const edited = sample.replace('enjoyed the company', 'avoided the company');
assert.equal((await matcher.search('liked people', edited)).length, 0, 'An edit reused stale source offsets');
const unsupported = new PassageInNoteMatcher({ ...options, read: async pairs => pairs.map(() => ({ probability: .99, spans: [{ from: 1, to: 5 }] })) });
assert.equal((await unsupported.search('query', 'Some target.')).length, 0, 'A context/query span became a finding');
let live = true, called = false;
const cancelled = new PassageInNoteMatcher({ ...options, read: async () => { called = true; return []; } });
await assert.rejects(cancelled.search('query', 'Some target.', { isCurrent: () => live, onProgress: () => { live = false; } }), { name: 'AbortError' });
assert.equal(called, false, 'A stale query performed reader inference');
const invalid = new PassageInNoteMatcher({ ...options, read: async pairs => pairs.map(() => ({ probability: NaN, spans: [] })) });
await assert.rejects(invalid.search('query', 'Some target.'), /invalid spans/);
matcher.dispose(); await assert.rejects(matcher.search('query', 'Some target.'), { name: 'AbortError' });
unsupported.dispose(); cancelled.dispose(); invalid.dispose();
let finishEmbedding, announceEmbedding;
const embeddingStarted = new Promise(resolve => { announceEmbedding = resolve; });
const interruptedPreparation = new PassageInNoteMatcher({ ...options, embed: async texts => { announceEmbedding(); await new Promise(resolve => { finishEmbedding = resolve; }); return texts.map(() => vector); } });
const preparing = interruptedPreparation.prepare('A pending note.');
await embeddingStarted; interruptedPreparation.dispose(); finishEmbedding();
await assert.rejects(preparing, { name: 'AbortError' });
assert.equal(interruptedPreparation.vectors.size, 0, 'Disposed preparation repopulated its cache');
const bounded = new PassageInNoteMatcher(options);
for (let i = 0; i < 3000; i++) { const value = new Float32Array(vector); value.focus = { vectors: new Int8Array(30 * 384), words: Array.from({ length: 30 }, () => ({ from: 0, to: 1, text: 'x' })), dimension: 384 }; bounded.rememberVector(`Representation ${i}`, value); }
assert.equal(bounded.vectors.size, 3000, 'Optional phrase attribution evicted compact retrieval vectors');
assert.ok(bounded.vectorBytes <= 16 * 1024 * 1024, 'The note vector cache exceeded its byte budget'); bounded.dispose();

// Verify decoder boundaries independently of a real neural network. This checks
// worker protocol and UTF-16 mapping, not semantic model quality.
const pair = inNoteReaderInput('Maya smiled.'), pieces = ['[CLS]', '▁query', '[SEP]', '▁Target', ':', '▁Maya', '▁smiled', '.', '[SEP]'];
const fakeTokenizer = { sep_token_id: 2, pad_token_id: 99, encode: () => [1], tokenize: () => pieces.slice(3, 8), model: { convert_tokens_to_ids: tokens => tokens.map(piece => pieces.indexOf(piece)) } };
const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8]; ids[8] = 2;
const data = new Float32Array(ids.length * 4);
for (let i = 0; i < ids.length; i++) { data[i * 4] = 8; data[i * 4 + 3] = 8; }
data[6 * 4] = 0; data[6 * 4 + 1] = 8;
const decoded = decodeInNoteReader(fakeTokenizer, { input_ids: { data: BigInt64Array.from(ids, BigInt) } }, { dims: [1, ids.length, 4], data }, [pair]);
assert.equal(decoded.length, 1); assert.equal(pair.passage.slice(decoded[0].spans[0].from, decoded[0].spans[0].to), 'smiled');
const multiPair = inNoteReaderInput('Maya smiled. Owen waved.'), tokenPositions = [{ from: 8, to: 12 }, { from: 13, to: 19 }, { from: 19, to: 20 }, { from: 21, to: 25 }, { from: 26, to: 31 }], multiData = new Float32Array(6 * 5);
for (let i = 0; i < 6; i++) { multiData[i * 5 + 2] = 8; multiData[i * 5 + 3] = 8; multiData[i * 5 + 4] = i < 4 ? 8 : -8; }
multiData[5 + 1] = 10;
const multiInputs = { input_ids: { data: BigInt64Array.from([1, 3, 4, 5, 6, 7], BigInt) }, readerPositions: [{ start: 1, positions: tokenPositions, sentences: [{ from: 8, to: 20 }, { from: 20, to: 32 }] }] };
const multiDecoded = decodeInNoteReader(fakeTokenizer, multiInputs, { dims: [1, 6, 5], data: multiData }, [multiPair]);
assert.equal(multiDecoded[0].spans.length, 2, 'Continuous BIO output crossed a sentence verification boundary');
assert.ok(multiDecoded[0].spans[0].sentenceProbability > .99 && multiDecoded[0].spans[1].sentenceProbability < .01, 'Neighboring sentence evidence leaked');
assert.throws(() => decodeInNoteReader(fakeTokenizer, multiInputs, { dims: [1, 6, 5], data: multiData.slice(0, 20) }, [multiPair]), /invalid outputs/);
multiInputs.readerPositions[0].truncatedTarget = true;
assert.deepEqual(decodeInNoteReader(fakeTokenizer, multiInputs, { dims: [1, 6, 5], data: multiData }, [multiPair]), [{ probability: 0, spans: [] }], 'A truncated target could verify an unread sentence tail');
console.log('Passage reader checks passed: Markdown/Unicode spans, overlap removal, occurrence identity, cache invalidation, cancellation, abstention and worker decoding.');
