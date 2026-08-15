import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { BoundedMetricWindow, IncrementalBm25, mergeIndexReplacements } from '../src/search-core.js';

const budget = (name, elapsed, maximum) => assert.ok(elapsed <= maximum, `${name} exceeded its ${maximum} ms release budget (${elapsed.toFixed(1)} ms)`);

const recordCount = 40_000, meta = Array.from({ length: recordCount }, (_, index) => ({ file: `Notes/${Math.floor(index / 4)}.md`, ordinal: index })), vectors = Array.from({ length: recordCount }, (_, index) => index), replacements = new Map();
for (let file = 0; file < 1_200; file++) { const path = `Notes/${file * 3}.md`; replacements.set(path, { meta: [{ file: path, ordinal: `replacement-${file}` }], vectors: [-file - 1] }); }
let started = performance.now(); const merged = mergeIndexReplacements(meta, vectors, replacements), mergeMs = performance.now() - started;
assert.equal(merged.meta.length, recordCount - replacements.size * 4 + replacements.size); assert.equal(merged.meta.length, merged.vectors.length); assert.ok(merged.meta.some(item => item.ordinal === 'replacement-1199')); budget('Staged index merge', mergeMs, 1_500);

const dimension = 384, passages = 25_000, query = new Float32Array(dimension); for (let index = 0; index < dimension; index++) query[index] = Math.sin(index * .17) * .05; const packed = new Float32Array(passages * dimension); for (let index = 0; index < packed.length; index++) packed[index] = Math.cos(index * .013) * .05;
started = performance.now(); let maximumScore = -Infinity; for (let passage = 0; passage < passages; passage++) { let score = 0, offset = passage * dimension; for (let index = 0; index < dimension; index++) score += query[index] * packed[offset + index]; maximumScore = Math.max(maximumScore, score); } const scanMs = performance.now() - started;
assert.ok(Number.isFinite(maximumScore)); budget('Packed semantic scan', scanMs, 1_500);

const lexical = new IncrementalBm25(); for (let index = 0; index < 20_000; index++) lexical.upsert(`doc:${index}`, { title: `Note ${index}`, body: `shared language topic-${index % 97} exact-${index}` }, { file: `${index}.md` });
started = performance.now(); for (let index = 0; index < 20; index++) assert.equal(lexical.search(`shared topic-${index % 97}`, 20).length, 20); const lexicalMs = performance.now() - started; budget('Warm lexical retrieval', lexicalMs, 1_000);

const metrics = new BoundedMetricWindow(16); for (let index = 1; index <= 40; index++) metrics.record('searchMs', index); const summary = metrics.summary('searchMs'); assert.deepEqual(summary, { count: 16, last: 40, p50: 32, p95: 40, max: 40 });

console.log(`Performance budgets passed: staged merge ${mergeMs.toFixed(1)} ms, 25,000-passage scan ${scanMs.toFixed(1)} ms, 20 warm lexical queries ${lexicalMs.toFixed(1)} ms.`);
