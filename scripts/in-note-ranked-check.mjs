import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { InNoteVectorStore } from '../src/in-note-cache.js';
import { RankedInNoteMatcher } from '../src/ranked-in-note-search.js';
import { inNoteGrammar, inNoteQuery, inNoteFragmentClaim, inNoteConflict, inNoteRoleMatch } from '../src/in-note-logic.js';
import { inNoteUnits } from '../src/in-note-search.js';
import { inNoteParagraphs } from '../src/in-note-hierarchy.js';

const longParagraph = Array.from({ length: 20 }, (_, index) => `Sentence ${index} records a separate observation.`).join(' ');
const hierarchy = inNoteParagraphs(inNoteUnits(longParagraph), longParagraph);
assert.equal(inNoteFragmentClaim(inNoteQuery('liked people')), 'Someone liked people.');
assert.equal(inNoteFragmentClaim(inNoteQuery('Alice liked people')), '');
assert.equal(inNoteFragmentClaim(inNoteQuery('He liked people')), '');
assert.equal(inNoteFragmentClaim(inNoteQuery('given by god')), '');
assert.equal(inNoteFragmentClaim(inNoteQuery('protect private data')), '');
assert.ok(hierarchy.length > 1 && hierarchy.every(paragraph => paragraph.indices.length <= 6 && paragraph.phrase.length <= 900));
assert.equal(hierarchy.flatMap(paragraph => paragraph.indices).length, 20);
assert.ok(hierarchy.every(paragraph => longParagraph.slice(paragraph.from, paragraph.to) === paragraph.sourcePhrase));

for (const [query, correct, wrong] of [
  ['Ada hired Ben', 'Ben was hired by Ada.', 'Ada was hired by Ben.'],
  ['files are encrypted', 'The files are not only encrypted but also signed.', 'The files are not encrypted.'],
  ['backups failed', 'Several backups failed.', 'No backups have failed.'],
  ['logs are encrypted', 'All logs are encrypted.', 'The archive is encrypted, but the logs remain in plaintext.'],
]) {
  const intent = inNoteQuery(query);
  assert.equal(inNoteConflict(intent, inNoteGrammar(correct)), '', correct);
  assert.ok(inNoteConflict(intent, inNoteGrammar(wrong)), wrong);
}
assert.equal(inNoteConflict(inNoteQuery('Alice borrowed money from Bob'), inNoteGrammar('Bob lent money to Alice.')), '', 'Inverse verbs with exchanged roles are equivalent');
assert.equal(inNoteRoleMatch(inNoteQuery('Alice paid Bob'), inNoteGrammar("Alice's friend paid Bob.")), false);
assert.equal(inNoteRoleMatch(inNoteQuery('Alice paid Bob'), inNoteGrammar('If Alice paid Bob, the order would ship.')), false);
assert.equal(inNoteRoleMatch(inNoteQuery('Alice paid Bob and Sam left'), inNoteGrammar('Alice paid Bob.')), false);
for (const text of ['Alice denied paying the invoice.', 'If Alice paid the invoice, it would ship.', 'Alice did not pay the invoice.', 'Only if authorized, Alice paid the invoice.']) {
  for (const prefix of ['', 'Record 12: ', 'Item 81: ']) { const source = prefix + text, unit = inNoteUnits(source)[0]; assert.equal(unit.phrase, text, 'Record formatting changed the complete sentence claim'); assert.equal(source.slice(unit.from, unit.to), text); }
}
const open = () => new Promise((resolve, reject) => { const request = indexedDB.open('in-note-unit', 1); request.onupgradeneeded = () => request.result.createObjectStore('indexes'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const vector = new Float32Array(384); vector[0] = 1; vector.focus = { dimension: 384, words: [{ text: 'file', from: 0, to: 4 }], vectors: new Int8Array(384) };
const cache = new InNoteVectorStore({ open, key: 'vault-a', maxEntries: 2 });
await cache.save(new Map([['file one', vector], ['private query', vector], ['file two', vector], ['file three', vector]]), new Set(['file one', 'file two', 'file three']));
const restored = await cache.load(); assert.deepEqual(restored.map(([text]) => text), ['file two', 'file three']);
assert.ok(restored[0][1].focus.vectors instanceof Int8Array); assert.equal(restored[0][1].focus.words[0].to, 4);
assert.deepEqual(await new InNoteVectorStore({ open, key: 'vault-b' }).load(), [], 'Note cache crossed vault boundaries');
assert.deepEqual(await new InNoteVectorStore({ open, key: 'vault-a', maxBytes: 1 }).load(), [], 'Stored cache bypassed memory bound');
const database = await open();
await new Promise(resolve => { const transaction = database.transaction('indexes', 'readwrite'); transaction.objectStore('indexes').put({ version: 'obsolete', entries: restored }, cache.key); transaction.oncomplete = resolve; });
assert.deepEqual(await cache.load(), [], 'An obsolete vector schema was reused');

const options = { embed: async texts => texts.map(() => vector), classify: async pairs => pairs.map(() => ({ entailment: .99, neutral: .005, contradiction: .005 })), rank: async pairs => pairs.map(() => 8), guard: async pairs => pairs.map(() => ({ entailment: .99, neutral: .005, contradiction: .005 })), yieldControl: async () => {} };
const matcher = new RankedInNoteMatcher(options), source = Array.from({ length: 30 }, () => 'Ben was hired by Ada.').join('\n\n');
const hits = await matcher.search('Ada hired Ben', source); assert.equal(hits.length, 30, 'Find-all was capped at a shortlist size');
assert.ok(hits.every(hit => source.slice(hit.from, hit.to) === hit.sourcePhrase));
assert.equal((await matcher.search('Ben hired Ada', source)).length, 0, 'A reversed query reused an accepted relation');
const stages = [], streamed = new RankedInNoteMatcher(options);
const streamedHits = await streamed.search('Ada hired Ben', source, { onProgress: progress => { stages.push(progress.stage); assert.ok(progress.ranges.every(range => source.slice(range.from, range.to) === range.sourcePhrase)); } });
assert.deepEqual(stages, ['paragraph', 'sentence']); assert.equal(streamedHits.length, 30);
let live = true, modelCalls = 0;
const cancelledStream = new RankedInNoteMatcher({ ...options, classify: async pairs => { modelCalls++; return options.classify(pairs); } });
await assert.rejects(cancelledStream.search('Ada hired Ben', source, { isCurrent: () => live, onProgress: () => { live = false; } }), { name: 'AbortError' });
assert.equal(modelCalls, 0, 'An obsolete paragraph preview queued sentence inference');
streamed.dispose(); cancelledStream.dispose();
const badGuard = new RankedInNoteMatcher({ ...options, guard: async pairs => pairs.map(() => ({ entailment: .8, neutral: .8, contradiction: .8 })) });
await assert.rejects(badGuard.search('Ada hired Ben', 'Ada hired Ben.'), /invalid scores/);
let preparing = true, calls = 0;
const cancelling = new RankedInNoteMatcher({ ...options, embed: async texts => { calls++; preparing = false; return texts.map(() => vector); } });
await assert.rejects(cancelling.prepare('One sentence.\n\nAnother sentence.', () => preparing), { name: 'AbortError' });
assert.equal(calls, 1); assert.equal(cancelling.preparing, false);
let rankedPairs = 0;
const shortlisting = new RankedInNoteMatcher({ ...options, rank: async pairs => { rankedPairs += pairs.length; return pairs.map(pair => pair.passage.startsWith('answer') ? 8 : -11); } });
const shortlistPool = Array.from({ length: 80 }, (_, index) => ({ similarity: .9 - index * .005 })), allPairs = shortlistPool.map((_, index) => ({ query: 'question', passage: `answer ${index}`, cacheKey: `all ${index}` }));
assert.equal((await shortlisting.questionRanking(shortlistPool, allPairs)).filter(Number.isFinite).length, 80, 'Answer-rich notes were capped at the initial shortlist');
rankedPairs = 0;
const mixedPairs = shortlistPool.map((_, index) => ({ query: 'question', passage: `${index === 0 ? 'answer' : 'unrelated'} ${index}`, cacheKey: `mixed ${index}` }));
await shortlisting.questionRanking(shortlistPool, mixedPairs); assert.ok(rankedPairs < 40, 'A sparse answer query scored the entire note'); shortlisting.dispose();
let meaningPairs = 0;
const adaptive = new RankedInNoteMatcher({ ...options, classify: async pairs => { meaningPairs += pairs.length; return pairs.map(pair => pair.premise.startsWith('answer') ? { entailment: .99, neutral: .005, contradiction: .005 } : { entailment: .001, neutral: .998, contradiction: .001 }); } });
const allUnits = shortlistPool.map((unit, index) => ({ ...unit, phrase: `answer ${index}` }));
assert.equal((await adaptive.sentenceMeaning(allUnits, 'question')).filter(score => !score.unscored).length, 80, 'Sentence verification capped an answer-rich note');
meaningPairs = 0;
const sparseUnits = shortlistPool.map((unit, index) => ({ ...unit, phrase: `${index === 0 ? 'answer' : 'irrelevant'} ${index}` }));
await adaptive.sentenceMeaning(sparseUnits, 'sparse question'); assert.ok(meaningPairs < 40, 'A sparse fragment verified every sentence'); adaptive.dispose();
matcher.dispose(); badGuard.dispose(); cancelling.dispose(); database.close();
console.log('Ranked in-note checks passed: role and polarity guards, inverse relations, logical proof scope, persistent cache isolation, 30 occurrences, invalid scores, and preparation cancellation.');
