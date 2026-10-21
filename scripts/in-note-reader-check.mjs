import assert from 'node:assert/strict';
import { PassageInNoteMatcher, inNoteReaderWindows } from '../src/in-note-reader.js';

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
const blockedCache = new PassageInNoteMatcher({ ...options, cacheTimeoutMs: 10, cache: { load: () => new Promise(() => {}), save: async () => {} } });
assert.equal((await blockedCache.search('liked people', sample)).length, 1, 'Blocked optional storage prevented search'); blockedCache.dispose();
for (let i = 0; i < 3000; i++) { const value = new Float32Array(vector); value.focus = { vectors: new Int8Array(30 * 384), words: Array.from({ length: 30 }, () => ({ from: 0, to: 1, text: 'x' })), dimension: 384 }; bounded.rememberVector(`Representation ${i}`, value); }
assert.equal(bounded.vectors.size, 3000, 'Optional phrase attribution evicted compact retrieval vectors');
assert.ok(bounded.vectorBytes <= 16 * 1024 * 1024, 'The note vector cache exceeded its byte budget'); bounded.dispose();


console.log('Passage reader checks passed: Markdown/Unicode source spans, overlap removal, occurrence identity, cache invalidation, cancellation and abstention.');
