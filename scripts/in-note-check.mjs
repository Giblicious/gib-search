import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { InNoteMatcher, inNoteProjection, inNoteUnits } from '../src/in-note-search.js';
import { MobileSearchRuntime } from '../src/mobile-runtime.js';

function semanticVector(text) {
  const words = [...text.matchAll(/[a-z]+/giu)].map(match => ({ from: match.index, to: match.index + match[0].length, text: match[0].toLowerCase() })), vectors = new Int8Array(words.length * 3);
  words.forEach((word, index) => { vectors[index * 3 + (/^(?:repair|repaired)$/.test(word.text) ? 0 : /^(?:engine|motor)$/.test(word.text) ? 1 : 2)] = 127; });
  const vector = new Float32Array([1, 0, 0]); vector.focus = { words, vectors, dimension: 3 }; return vector;
}
const verifiedPremises = [], groundedMatcher = new InNoteMatcher({ embed: async texts => texts.map(semanticVector), classify: async pairs => { verifiedPremises.push(...pairs.map(pair => pair.premise)); return pairs.map(() => ({ entailment: .99, neutral: .005, contradiction: .005 })); }, yieldControl: async () => {} });
const headedNote = '## Repair engine\n\nThe garden receives sunlight.\n\nThey repaired the motor.';
const groundedMatches = await groundedMatcher.search('repair engine', headedNote);
assert.ok(groundedMatches.some(match => /repaired the motor/.test(match.phrase)));
assert.ok(!groundedMatches.some(match => /garden/.test(match.phrase)), 'Even 99% NLI confidence bypassed missing sentence evidence');
assert.ok(!verifiedPremises.some(premise => /garden/.test(premise)), 'An unrelated sentence consumed an avoidable verifier call');
assert.ok(verifiedPremises.includes('They repaired the motor.'), 'The verifier was given a heading as a sentence assertion');
assert.equal((await groundedMatcher.search('repair engine', '## Engine\n\nRepair it tomorrow.')).some(match => /Repair it tomorrow/.test(match.phrase)), true, 'Contextual retrieval discarded a heading-resolved reference');
const repeatedReference = '## Engine\n\nRepair it tomorrow.\n\n## Garden\n\nRepair it tomorrow.', referenceMatches = await groundedMatcher.search('repair engine', repeatedReference);
assert.equal(referenceMatches.filter(match => /Repair it tomorrow/.test(match.phrase)).length, 1, 'Identical wording inherited another occurrence\'s heading context');
assert.ok(referenceMatches.some(match => match.from === repeatedReference.indexOf('Repair it tomorrow')));

const source = '---\nalias: Private metadata\n---\n# Finance\n\n**Encrypt** the [[Records|private records]] and [backup](https://example.test/backup).\n\n```md\nIgnore this code example.\n```\n\nVersion 2.5 uses 1.2 GB.\nThis paragraph continues\non the next line.\n\n- Parent item\n    - Nested item\n';
const units = inNoteUnits(source);
assert.ok(units.every(unit => source.slice(unit.from, unit.to) === unit.sourcePhrase));
assert.ok(!units.some(unit => /Private metadata|Ignore this code/.test(unit.phrase)));
assert.ok(units.some(unit => unit.phrase === 'Finance'));
assert.ok(units.some(unit => unit.phrase === 'Encrypt the private records and backup.'));
assert.ok(units.some(unit => unit.phrase === 'Version 2.5 uses 1.2 GB.'));
assert.ok(units.some(unit => unit.phrase === 'This paragraph continues on the next line.'));
assert.ok(units.some(unit => unit.phrase === 'Nested item'));
assert.ok(inNoteUnits('---\nThis is ordinary content without a YAML closing delimiter.').some(unit => /ordinary content/.test(unit.phrase)));
assert.equal(inNoteProjection('snake_case costs 2 * 3; **bold** and _italics_.').text, 'snake_case costs 2 * 3; bold and italics.');
const linked = '[backup](https://example.test/backup)', projected = inNoteProjection(linked);
assert.equal(projected.text, 'backup'); assert.equal(projected.positions[0], 1);
const long = 'A start. ' + 'Longword '.repeat(180) + 'important ending.';
assert.ok(inNoteUnits(long).some(unit => unit.phrase.includes('important ending')));
assert.ok(inNoteUnits(long).every(unit => unit.phrase.length <= 220));

const affirmative = { entailment: .98, neutral: .01, contradiction: .01 }, unrelated = { entailment: .01, neutral: .98, contradiction: .01 }, contradiction = { entailment: .01, neutral: .01, contradiction: .98 };
const embedding = async texts => texts.map(() => new Float32Array([1, 0]));
const groupedBatches = [], grouped = new InNoteMatcher({ embed: embedding, batchSize: 2, classify: async pairs => { groupedBatches.push(pairs.map(pair => pair.premise.length)); return pairs.map(pair => ({ entailment: pair.premise.length / 100, contradiction: .01, neutral: .99 - pair.premise.length / 100 })); }, yieldControl: async () => {} });
const groupedScores = await grouped.meaning([90, 10, 50, 10].map(length => ({ premise: 'x'.repeat(length), hypothesis: 'test' })));
assert.deepEqual(groupedBatches, [[10, 50], [90]], 'Verifier batches did not group sentence lengths or deduplicate pairs');
assert.deepEqual(groupedScores.map(score => score.entailment), [.9, .1, .5, .1], 'Grouped verification attached a score to the wrong occurrence');
let embeddingCalls = 0, classificationCalls = 0;
const matcher = new InNoteMatcher({ embed: async texts => { embeddingCalls++; return embedding(texts); }, classify: async pairs => { classificationCalls++; return pairs.map(pair => /repaired|fix the car/i.test(pair.premise) ? affirmative : unrelated); }, batchSize: 3 });
const many = Array.from({ length: 30 }, (_, index) => `## Job ${index}\nThe mechanic repaired the automobile for client ${index}.`).join('\n\n');
const all = await matcher.search('fix the car', many);
assert.equal(all.length, 30, 'An in-note search still caps findings at the first few passages');
assert.ok(all.every(match => many.slice(match.from, match.to) === match.sourcePhrase));
const calls = [embeddingCalls, classificationCalls];
assert.deepEqual(await matcher.search('fix the car', many), all); assert.deepEqual([embeddingCalls, classificationCalls], calls, 'Identical queries should reuse the scored source snapshot');
assert.equal((await matcher.search('fix the car', 'The mechanic repaired the automobile yesterday.')).length, 1);
assert.equal((await matcher.search('fix the car', 'The tomato plants need watering.')).length, 0, 'A changed source reused obsolete semantic findings');
const emptyMatcher = new InNoteMatcher({ embed: embedding, classify: async pairs => pairs.map(() => ({ entailment: .001, neutral: .998, contradiction: .001 })) });
assert.equal((await emptyMatcher.search('unavailable concept', 'An unrelated sentence is the best available candidate.')).length, 0, 'Relative best-of-bad candidates must abstain');
const oppositeMatcher = new InNoteMatcher({ embed: embedding, classify: async pairs => pairs.map(() => contradiction) });
assert.equal((await oppositeMatcher.search('data is encrypted', 'Data is not encrypted.')).length, 0, 'Complete keyword coverage bypassed meaning verification');
const ambiguousMatcher = new InNoteMatcher({ embed: embedding, classify: async pairs => pairs.map(() => ({ entailment: .425, neutral: .263, contradiction: .312 })) });
for (const breadth of ['balanced', 'broad']) assert.equal((await ambiguousMatcher.search('speak quietly', 'A quiet street leads to the park.', { breadth })).length, 0, 'A mixed contradiction verdict passed as a positive statement');
let current = true, batches = 0;
const cancelling = new InNoteMatcher({ embed: async texts => { batches++; current = false; return embedding(texts); }, classify: async () => { throw new Error('obsolete inference continued'); }, batchSize: 2 });
await assert.rejects(cancelling.search('new query', many, { isCurrent: () => current }), { name: 'AbortError' }); assert.equal(batches, 1);
const badScores = new InNoteMatcher({ embed: embedding, classify: async pairs => pairs.map(() => ({ entailment: NaN, neutral: 0, contradiction: 0 })) });
await assert.rejects(badScores.search('new query', 'A source sentence with invalid model results.'), /invalid scores/);
assert.ok(matcher.vectors.size <= 2048 && matcher.classifications.size <= 512 && matcher.sources.size <= 2 && matcher.results.size <= 4);

let embeddedTexts = [];
const longMatcher = new InNoteMatcher({ embed: async texts => { embeddedTexts.push(...texts); return embedding(texts); }, classify: async pairs => pairs.map(() => affirmative), batchSize: 128, yieldControl: async () => {} });
const largeNote = Array.from({ length: 2200 }, (_, index) => `Unique passage ${index} describes this repair.`).join('\n\n');
await longMatcher.search('repair', largeNote); embeddedTexts = [];
await longMatcher.search('automobile', largeNote);
assert.deepEqual(embeddedTexts, ['automobile'], 'A note larger than the shared cache re-embedded itself for another query');
embeddedTexts = [];
await longMatcher.search('vehicle', largeNote + '\n\nAn additional repair paragraph.');
assert.deepEqual(embeddedTexts, ['An additional repair paragraph.', 'vehicle'], 'A small edit discarded the previous note snapshot embeddings');

let releaseFirst, enteredFirst, generation = 1, activeCalls = 0, maximumActiveCalls = 0, queuedCalls = 0;
const entered = new Promise(resolve => { enteredFirst = resolve; }), blocked = new Promise(resolve => { releaseFirst = resolve; });
const latest = new InNoteMatcher({ embed: async texts => { activeCalls++; maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls); queuedCalls++; if (queuedCalls === 1) { enteredFirst(); await blocked; } activeCalls--; return embedding(texts); }, classify: async pairs => pairs.map(() => affirmative), yieldControl: async () => {} });
const queries = [latest.search('first query', 'Repair the automobile.', { isCurrent: () => generation === 1 }).catch(error => error.name)];
await entered;
for (let index = 2; index <= 20; index++) { generation = index; queries.push(latest.search(`query ${index}`, 'Repair the automobile.', { isCurrent: () => generation === index }).catch(error => error.name)); }
releaseFirst(); const completed = await Promise.all(queries);
assert.ok(completed.slice(0, -1).every(value => value === 'AbortError'));
assert.ok(Array.isArray(completed.at(-1))); assert.equal(maximumActiveCalls, 1);
assert.equal(queuedCalls, 2, 'Superseded typing queued redundant source/model work instead of reusing the completed batch');

const plugin = { isMobile: false, settings: {}, manifest: { id: 'gib-search' }, app: { vault: { adapter: {}, getName: () => 'in-note-test' } } }, runtime = new MobileSearchRuntime(plugin);
runtime.embedBatch = embedding; runtime.classifyRelationPairs = async pairs => pairs.map(() => affirmative);
assert.equal(runtime.meta.length, 0);
assert.equal((await runtime.searchInNote('fix the car', 'Repair the automobile.')).length, 1, 'Current-note matching depends on a ready vault index');
const unavailableRuntime = new MobileSearchRuntime(plugin);
unavailableRuntime.initializeRelationModel = async () => { throw new Error('Attempted main-thread model load'); };
await assert.rejects(unavailableRuntime.classifyRelationPairs([{ premise: 'Test', hypothesis: 'Test' }], { backgroundOnly: true }), { name: 'BackgroundWorkerUnavailableError' });

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'), helper = name => { const start = main.indexOf(`function ${name}(`); return main.slice(start, main.indexOf('\nfunction ', start + 1)); };
const embedderEnvironment = { clearTimeout, crossOriginIsolated: false }, Embedder = vm.runInNewContext(`${main.slice(main.indexOf('class DesktopEmbedder {'), main.indexOf('\nfunction activeTweaks('))}\nDesktopEmbedder`, embedderEnvironment);
const cpuPlugin = { isMobile: false, search: { indexingConfig: { cores: 4, memoryGiB: 8 }, activeWasmThreads: 1 } }, cpu = new Embedder(cpuPlugin), primaryCalls = [], auxiliaryCalls = [];
cpu.backend = 'wasm'; cpu.relationBackend = 'wasm'; cpu.request = async message => { primaryCalls.push(message.pairs); return message.pairs.map(pair => pair.index); };
let stopped = false;
cpu.inNoteWorker = { disabled: false, classifyRelations: async pairs => { auxiliaryCalls.push(pairs); return pairs.map(pair => pair.index); }, stop() { stopped = true; } };
const pairs = Array.from({ length: 15 }, (_, index) => ({ premise: `Premise ${index}`, hypothesis: 'Meaning', index }));
assert.deepEqual(Array.from(await cpu.classifyRelations(pairs, { interactive: true })), pairs.map(pair => pair.index));
assert.equal(primaryCalls[0].length, 8); assert.equal(auxiliaryCalls[0].length, 7);
cpu.inNoteWorker.classifyRelations = async () => { throw new Error('Helper unavailable'); };
assert.deepEqual(Array.from(await cpu.classifyRelations(pairs, { interactive: true })), pairs.map(pair => pair.index), 'A failed optional CPU helper lost or reordered findings');
cpu.releaseInNoteWorker(); assert.ok(stopped); assert.equal(cpu.inNoteWorker, null);
cpu.backend = 'webgpu'; cpu.relationBackend = 'webgpu';
await cpu.classifyRelations(pairs, { interactive: true }); assert.equal(cpu.inNoteWorker, null, 'GPU inference created an unnecessary CPU helper');
cpu.backend = 'wasm'; cpu.relationBackend = 'wasm'; cpuPlugin.isMobile = true;
await cpu.classifyRelations(pairs, { interactive: true }); assert.equal(cpu.inNoteWorker, null, 'Mobile inference created a desktop CPU helper');
cpuPlugin.isMobile = false; cpuPlugin.search.indexingConfig.memoryGiB = 4;
await cpu.classifyRelations(pairs, { interactive: true }); assert.equal(cpu.inNoteWorker, null, 'Low-memory devices created another model session');
cpuPlugin.search.indexingConfig.memoryGiB = 8; embedderEnvironment.crossOriginIsolated = true;
await cpu.classifyRelations(pairs, { interactive: true }); assert.equal(cpu.inNoteWorker, null, 'A renderer with shared WASM threading also created another model session');
const highlights = new Map();
class TestHighlight { constructor(...ranges) { this.ranges = ranges; } }
class TestRange { setStart(node, offset) { this.node = node; this.from = offset; } setEnd(node, offset) { this.to = offset; } compareBoundaryPoints(_, other) { return this.from - other.from; } }
const state = { nodes: [] }, sandbox = { inNoteProjection, CSS: { highlights }, Highlight: TestHighlight, Range: TestRange, NodeFilter: { SHOW_TEXT: 4 }, document: { createTreeWalker: () => { let index = 0; return { nextNode: () => state.nodes[index++] }; } } };
const Search = vm.runInNewContext(`${helper('cleanSourceText')}\n${main.slice(main.indexOf('function inNoteSemanticPool('), main.indexOf('const IMAGE_EXTENSION'))}\n${main.slice(main.indexOf('class SemanticInNoteSearch'), main.indexOf('class AtlasNavigatorView'))}\nSemanticInNoteSearch`, sandbox);
const note = 'We closed the account.\n\nWe closed the account.', from = note.lastIndexOf('We closed'), semantic = [{ from, to: note.length, sourcePhrase: note.slice(from), phrase: note.slice(from), score: 1 }], ui = new Search({ workspace: {} }, {}, { file: { path: 'Example.md' } });
ui.options = { lexical: false, semantic: true };
const matches = ui.compactPhrases(semantic, 'bank closure', note);
const literalRegex = ui.matchRegex({ kind: 'lexical', phrase: 'a+b [x]', displayPhrase: 'a+b [x]' });
assert.ok(literalRegex.test('a+b [x]')); assert.ok(!literalRegex.test('aaab x'), 'Find treated query punctuation as regular expressions');
assert.equal(matches.length, 1); assert.equal(matches[0].from, from, 'Semantic strings were rematched at an unscored occurrence');
assert.equal(ui.compactPhrases(semantic, 'bank closure', 'Changed text.').length, 0, 'Obsolete offsets were applied to changed editor content');
ui.compactPhrases(semantic, 'bank closure', note);
ui.el = { isConnected: true }; ui.host = { querySelector: () => ({}) }; ui.editor = { cm: { posAtDOM: (_, offset) => from + offset } }; state.nodes = [{ nodeValue: note.slice(from) }];
ui.paintHighlights(); assert.equal(highlights.get(ui.highlightNames.semantic).ranges.length, 1, 'Virtualized editor offsets lost the visible later occurrence');
ui.editor.cm.posAtDOM = (_, offset) => offset;
ui.paintHighlights(); assert.equal(highlights.get(ui.highlightNames.semantic).ranges.length, 0, 'A visible earlier occurrence inherited an offscreen semantic score');
ui.isButter = true; ui.current = 0; ui.updateCount = () => {}; state.nodes = [{ nodeValue: note.replace('\n\n', '') }];
ui.paintHighlights(); assert.equal(highlights.get(ui.highlightNames.semantic).ranges.length, 1); assert.equal(highlights.get(ui.highlightNames.semantic).ranges[0].from, note.indexOf('\n\n'), 'Rendered rich-text highlighting selected the wrong repeated sentence');
ui.isButter = false; ui.options.lexical = true; ui.options.semantic = true;
const bothSource = 'fix the car.\nRepair the automobile.', bothFrom = bothSource.indexOf('Repair');
assert.equal(ui.compactPhrases([{ from: bothFrom, to: bothSource.length, sourcePhrase: bothSource.slice(bothFrom), phrase: bothSource.slice(bothFrom), score: .9 }], 'fix the car', bothSource).length, 2, 'Literal matches suppress valid paraphrases');

const verifiedSentence = 'He always paid the invoice.', focusedFrom = verifiedSentence.indexOf('paid'), focusedTo = verifiedSentence.length - 1;
const focusedHit = { from: 0, to: verifiedSentence.length, phrase: verifiedSentence, sourcePhrase: verifiedSentence, score: .9, highlight: { from: focusedFrom, to: focusedTo, phrase: 'paid the invoice', sourcePhrase: 'paid the invoice' } };
ui.options = { lexical: false, semantic: true };
assert.equal(ui.compactPhrases([focusedHit], 'paid invoice', verifiedSentence)[0].from, focusedFrom);
assert.equal(ui.compactPhrases([focusedHit], 'paid invoice', 'He never  paid the invoice.').length, 0, 'An unchanged phrase inherited verification after its sentence was negated');

const focusedSentence = 'The mechanic repaired the automobile yesterday.', repeated = Array.from({ length: 30 }, () => focusedSentence).join('\n\n'), repeatedHits = [...repeated.matchAll(/The mechanic repaired the automobile yesterday\./gu)].map(match => ({ from: match.index, to: match.index + focusedSentence.length, phrase: focusedSentence, sourcePhrase: focusedSentence, score: .9, highlight: { from: match.index + 13, to: match.index + 36, phrase: 'repaired the automobile', sourcePhrase: focusedSentence.slice(13, 36) } }));
// Count actual full-document regex scans, not merely construction of a pattern.
const regularMatchRegex = ui.matchRegex.bind(ui); let scans = 0;
ui.matchRegex = (...args) => { const regex = regularMatchRegex(...args); return { source: regex.source, flags: regex.flags, [Symbol.matchAll](value) { scans++; return regex[Symbol.matchAll](value); } }; };
ui.isButter = true; ui.current = 0; ui.compactPhrases(repeatedHits, 'fix the car', repeated); scans = 0; state.nodes = [{ nodeValue: repeated.replaceAll('\n\n', '') }];
ui.paintHighlights(); assert.equal(highlights.get(ui.highlightNames.semantic).ranges.length, 30); assert.equal(scans, 1, 'Repeated focused phrases rescanned the rendered note for every occurrence');

ui.matchRegex = regularMatchRegex; ui.isButter = false;
const nativeSource = 'The mechanic **repaired** the [[Fleet|automobile]] yesterday.', nativeFrom = nativeSource.indexOf('repaired'), nativeTo = nativeSource.indexOf(']]');
ui.compactPhrases([{ from: 0, to: nativeSource.length, phrase: 'The mechanic repaired the automobile yesterday.', sourcePhrase: nativeSource, score: .9, highlight: { from: nativeFrom, to: nativeTo, phrase: 'repaired the automobile', sourcePhrase: nativeSource.slice(nativeFrom, nativeTo) } }], 'fix the car', nativeSource);
const nativeNode = { nodeValue: nativeSource }; state.nodes = [nativeNode]; ui.host = { querySelector: () => ({ contains: node => node === nativeNode }) }; ui.editor.cm = { domAtPos: offset => ({ node: nativeNode, offset }), posAtDOM: (_, offset) => offset, viewport: { from: 0, to: nativeSource.length } };
ui.paintHighlights(); const nativeRange = highlights.get(ui.highlightNames.semantic).ranges[0]; assert.equal(nativeRange.from, nativeFrom); assert.equal(nativeRange.to, nativeTo, 'Native Markdown formatting broke the focused source range');
console.log('In-note regressions passed: live source, exhaustive occurrences, abstention, polarity, bounded caches, cancellation, Markdown spans, and source/rich-editor highlight locations.');
