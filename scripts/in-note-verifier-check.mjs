import assert from 'node:assert/strict';
import { sentenceReaderInputs, sentenceReaderResults } from '../src/in-note-sentence-codec.js';
import { VerifiedInNoteMatcher, inNoteLiteralRole, inNoteStatement, inNoteNliHypothesis, inNoteSemanticRoleConflict, inNoteControlConflict } from '../src/verified-in-note-search.js';
import { inNoteQuestionPlan, inNoteQuestionSlot, inNoteQuestionRange } from '../src/in-note-question-plan.js';
import { inNoteGrammar, inNoteQuery, inNoteConflict } from '../src/in-note-logic.js';
import { InNoteEngine } from '../src/in-note-engine.js';

let tokenized;
const tokenizer = Object.assign((queries, options) => { tokenized = { queries, options }; return {}; }, { encode: text => Array.from(text) });
const pairs = [{ query: 'query', passage: 'Target: Café smiled.', targetFrom: 8, targetTo: 20 }, { query: 'x', passage: 'x'.repeat(600), targetFrom: 0, targetTo: 600 }];
const inputs = sentenceReaderInputs(tokenizer, pairs);
assert.deepEqual(inputs.selected, [0]); assert.equal(tokenized.options.truncation, false);
assert.equal(tokenized.options.text_pair[0], 'Target: Café smiled.\nContext: ');
const decoded = sentenceReaderResults(pairs, inputs.selected, { to: () => ({ data: new Float32Array([4]) }) });
assert.ok(decoded[0].probability > .98); assert.equal(decoded[0].spans[0].from, 8);
assert.deepEqual(decoded[1], { probability: 0, binaryProbability: 0, complete: false, spans: [] });
assert.throws(() => sentenceReaderInputs(tokenizer, [{ ...pairs[0], targetTo: 99 }]), /boundaries/);
assert.throws(() => sentenceReaderResults(pairs, [0], { to: () => ({ data: [NaN] }) }), /invalid scores/);
assert.deepEqual(sentenceReaderInputs(tokenizer, []).selected, []);
const intent = inNoteQuery('Someone signed the contract');
assert.ok(inNoteLiteralRole(intent, inNoteGrammar('Maya signed the contract on Tuesday.')));
assert.ok(inNoteLiteralRole(intent, inNoteGrammar('The venue manager signed the contract on Thursday.')));
assert.equal(inNoteStatement("couldn't sleep"), "Someone couldn't sleep.");
assert.equal(inNoteStatement('wanted to leave'), '');
assert.equal(inNoteStatement('fix the car'), '');
assert.equal(inNoteStatement('Maya signed the contract'), '');
assert.equal(inNoteNliHypothesis("Jo couldn't sleep"), 'Jo could not sleep.');
assert.equal(inNoteNliHypothesis('They won’t enter'), 'They will not enter.');
assert.equal(inNoteNliHypothesis('not signed'), 'not signed');
assert.deepEqual(inNoteQuestionPlan('why did the lights fail?'), { type: 'cause', hypothesis: 'The lights failed.' });
assert.deepEqual(inNoteQuestionPlan('how long are refunds available'), { type: 'time', hypothesis: 'Refunds are available.' });
assert.deepEqual(inNoteQuestionPlan('can guests edit documents'), { type: 'boolean', hypothesis: 'Guests can edit documents.' });
assert.equal(inNoteQuestionPlan('liked people'), null);
const locationPlan = inNoteQuestionPlan('where is the spare key'), locationText = 'The extra key is taped beneath the lowest kitchen drawer.';
assert.ok(inNoteQuestionSlot(locationPlan, locationText, inNoteGrammar(locationText)));
const locationRange = inNoteQuestionRange(locationPlan, locationText, inNoteGrammar(locationText));
assert.equal(locationText.slice(locationRange.from, locationRange.to), 'beneath the lowest kitchen drawer');
const timePlan = inNoteQuestionPlan('how long are refunds available'), timeText = 'You can request your money back within fourteen days of delivery.';
assert.ok(inNoteQuestionSlot(timePlan, timeText, inNoteGrammar(timeText)));
assert.equal(inNoteQuestionSlot(timePlan, 'Refund requests go to the accounts team.', inNoteGrammar('Refund requests go to the accounts team.')), false);
assert.ok(inNoteControlConflict(inNoteQuery('regretted leaving'), inNoteGrammar('Nola regretted that her friend left town.'), 'Nola regretted that her friend left town.'));
assert.ok(!inNoteControlConflict(inNoteQuery('regretted leaving'), inNoteGrammar('Nola regretted leaving town.'), 'Nola regretted leaving town.'));
const roles = { queryRows: [{ text: 'water' }, { text: 'ceiling' }], words: [{ text: 'ceiling' }, { text: 'water' }], scores: new Float32Array([.1, .95, .95, .1]) };
assert.ok(inNoteSemanticRoleConflict(inNoteQuery('water damaged the ceiling'), inNoteGrammar('The damaged ceiling caused a water pipe to snap.'), roles));
assert.ok(!inNoteSemanticRoleConflict(inNoteQuery('water damaged the ceiling'), inNoteGrammar('Water damaged the ceiling.'), roles));
assert.ok(inNoteSemanticRoleConflict(inNoteQuery('stole from a neighbour'), inNoteGrammar('The neighbour secretly took cash from the tenant.'), roles));
for (const source of ['Maya almost signed the contract.', 'Maya could have signed the contract.', 'If Maya signed the contract, we could leave.', 'Maya dreamed that she signed the contract.', 'Maya signed the contract in a fictional story.']) assert.ok(!inNoteLiteralRole(intent, inNoteGrammar(source)), source);
assert.ok(!inNoteLiteralRole(inNoteQuery('The athlete signed the contract'), inNoteGrammar('The manager behind the athlete signed the contract.')));
assert.ok(inNoteConflict(intent, inNoteGrammar('Nobody signed the contract.')));

const vector = () => { const value = new Float32Array(384); value[0] = 1; return value; };
let calls = 0, live = true;
const matcher = new VerifiedInNoteMatcher({ embed: async texts => { calls += texts.length; return texts.map(vector); }, read: async pairs => pairs.map(() => ({ complete: false, probability: 0, binaryProbability: 0, spans: [] })), classify: async pairs => pairs.map(() => ({ entailment: .99, neutral: .01, contradiction: 0 })), guard: async pairs => pairs.map(() => ({ entailment: .99, neutral: .01, contradiction: 0 })), rank: async pairs => pairs.map(() => 10), yieldControl: async () => {} });
assert.equal((await matcher.search('Someone signed the contract', 'Maya signed the contract.')).length, 0, 'A literal proof accepted an unread/truncated sentence');
assert.equal((await matcher.search('where is the spare key', locationText)).length, 0, 'Question verification accepted an unread/truncated sentence');
const before = calls; await matcher.prepare('Maya signed the contract.'); await matcher.prepare('Maya signed the contract.'); assert.equal(calls, before, 'Preparation encoded shared representations twice');
await assert.rejects(matcher.search('liked people', 'Maya enjoyed company.', { isCurrent: () => live, onProgress: () => { live = false; } }), { name: 'AbortError' });
matcher.dispose(); assert.equal(matcher.vectors.size, 0);
await assert.rejects(matcher.search('query', 'Source.'), { name: 'AbortError' });

let encoded = [], largeCurrent = true;
const lazy = new VerifiedInNoteMatcher({ embed: async texts => { encoded.push(...texts); return texts.map(vector); }, read: async () => assert.fail('Cancelled retrieval started sentence inference'), yieldControl: async () => {} });
const largeSource = Array.from({ length: 90 }, (_, index) => `Inventory entry ${index + 1} lists the shelf number.`).join('\n\n');
await lazy.prepare(largeSource);
assert.ok(lazy.snapshot(largeSource).lazy);
assert.ok(encoded.length < 30, 'Large-note preparation encoded every sentence');
const preparedCount = encoded.length;
await assert.rejects(lazy.search('liked people', largeSource, { isCurrent: () => largeCurrent, onProgress: progress => { assert.equal(progress.stage, 'paragraph'); largeCurrent = false; } }), { name: 'AbortError' });
assert.equal(encoded.length, preparedCount + 1, 'Sentence encoding blocked the initial paragraph stage'); lazy.dispose();

let recovered = 0;
const focused = () => Object.assign(vector(), { focus: { vectors: new Int8Array(384), words: [{ text: 'word', from: 0, to: 4 }] } });
const focusMatcher = new VerifiedInNoteMatcher({ embed: async texts => { recovered += texts.length; return texts.map(focused); }, read: async () => [] });
focusMatcher.rememberVector('query', focused()); focusMatcher.rememberVector('source', focused());
focusMatcher.rememberVector('large preparation', Object.assign(vector(), { focus: { vectors: new Int8Array(17 * 1024 * 1024), words: [] } }));
assert.equal(focusMatcher.vectors.get('query').focus, null);
await focusMatcher.ensureFocus([{ query: 'query', passage: 'source', targetFrom: 0, targetTo: 6 }]);
assert.equal(recovered, 2); assert.ok(focusMatcher.vectors.get('query').focus); assert.ok(focusMatcher.vectors.get('source').focus);
await focusMatcher.ensureFocus([{ query: 'query', passage: 'source', targetFrom: 0, targetTo: 6 }]); assert.equal(recovered, 2);
assert.ok(focusMatcher.vectorBytes <= 16 * 1024 * 1024); focusMatcher.dispose();

// Exercise the actual client protocol without loading neural models. A corrupt
// or unsupported native runtime must have a working browser fallback.
const original = globalThis.Worker, workers = [];
class FakeWorker {
  constructor() { workers.push(this); }
  postMessage(message) { queueMicrotask(() => this.onmessage?.({ data: { type: 'result', id: message.id, value: message.type === 'init' ? { backend: 'wasm' } : 42 } })); }
  terminate() { this.terminated = true; }
}
globalThis.Worker = FakeWorker;
try {
  const engine = new InNoteEngine({ mobile: true, browserSource: '', modelCache: {}, readerAssets: {}, runtime: {} });
  assert.equal(await engine.request('test'), 42); assert.equal(engine.backend, 'wasm');
  engine.stop(); assert.ok(workers[0].terminated); assert.equal(engine.pending.size, 0);
  await assert.rejects(engine.request('test'), /stopped/);
} finally { globalThis.Worker = original; }
console.log('Sentence verifier checks passed: complete targets, literal-proof scope, shared vectors, cancellation, client RPC, fallback and shutdown.');
