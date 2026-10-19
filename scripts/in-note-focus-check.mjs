import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Tensor } from '@huggingface/transformers';
import { packInNoteFocus, inNoteFocusRange, inNoteWordAlignment, inNoteEvidence } from '../src/in-note-focus.js';
import { embedInNote } from '../src/in-note-embedding.js';
import { inNotePhraseHighlight, inNoteUnits } from '../src/in-note-search.js';

function profile(text, associations = {}, dimension = 4) {
  const words = [...text.matchAll(/[\p{L}\p{N}]+(?:['’:_-][\p{L}\p{N}]+)*/gu)].map(match => ({ from: match.index, to: match.index + match[0].length, text: match[0].toLowerCase() })), vectors = new Int8Array(words.length * dimension);
  words.forEach((word, index) => { vectors[index * dimension + (associations[word.text] ?? dimension - 1)] = 127; });
  return { words, vectors, dimension };
}
const query = profile('fix car', { fix: 0, car: 1 }), context = 'Workshop. The mechanic repaired the automobile yesterday.', passage = profile(context, { repaired: 0, automobile: 1 });
const focus = inNoteFocusRange(query, passage, 'Workshop. '.length, context.length);
assert.equal(context.slice(focus.from + 10, focus.to + 10), 'repaired the automobile');
const negativeText = 'Sharing is not permitted for guests.', negative = inNoteFocusRange(profile('forbidden', { forbidden: 0 }), profile(negativeText, { permitted: 0 }));
assert.equal(negativeText.slice(negative.from, negative.to), 'not permitted', 'Phrase attribution removed the predicate negation');
const mixedText = 'The invoice was unpaid until the customer settled it.', mixed = inNoteFocusRange(profile('paid invoice', { paid: 0, invoice: 1 }), profile(mixedText, { invoice: 1, settled: 0, unpaid: 0 }));
assert.equal(mixedText.slice(mixed.from, mixed.to), mixedText.slice(0, -1), 'An ambiguous contrast was attributed to only one side');

const markdown = 'The mechanic **repaired** the [[Fleet|automobile]] yesterday.', unit = inNoteUnits(markdown)[0], normalized = profile(unit.phrase, { repaired: 0, automobile: 1 });
const marked = inNotePhraseHighlight({ ...unit, unitIndex: 0 }, query, normalized, 0, unit.displayPositions);
assert.equal(marked.phrase, 'repaired the automobile'); assert.equal(markdown.slice(marked.from, marked.to), marked.sourcePhrase);
assert.ok(marked.from > unit.from && marked.to < unit.to, 'The focused display still paints the whole sentence');
const alignment = inNoteWordAlignment(query, normalized);
assert.ok(inNoteEvidence(alignment).supported, 'A full paraphrase lost independent token support');
assert.ok(inNoteEvidence(alignment).reliable, 'Balanced body support did not distinguish a full paraphrase from a shared topic');
assert.equal(inNoteFocusRange(query, normalized, 0, Infinity, alignment).from, unit.phrase.indexOf('repaired'));
const absent = inNoteWordAlignment(query, profile('The garden receives sunlight.'));
assert.equal(inNoteEvidence(absent).supported, false, 'Unrelated body tokens passed whole-query evidence');
const title = inNoteWordAlignment(query, profile('Fix the car', { fix: 0, car: 1 }));
const onlyTitle = inNoteEvidence(absent, [title]);
assert.ok(onlyTitle.complete && !onlyTitle.grounded && !onlyTitle.supported, 'A matching heading stood in for sentence evidence');
assert.equal(onlyTitle.reliable, false, 'A matching title supplied confident sentence evidence');
const reference = inNoteWordAlignment(query, profile('Repair it tomorrow.', { repair: 0 }));
assert.equal(inNoteEvidence(reference).supported, false);
assert.equal(inNoteEvidence(reference, [title]).supported, true, 'Heading context could not resolve a genuine reference');
assert.equal(inNoteEvidence(inNoteWordAlignment(query, profile('Repair', { repair: 0 })), [title]).supported, false, 'A single partial concept inherited an entire multi-concept query');
assert.equal(inNoteEvidence(null), null, 'Unavailable attribution did not leave sentence verification available');
const packed = packInNoteFocus('Café running at 5:30pm', ['[CLS]', 'cafe', 'runn', '##ing', 'at', '5', ':', '30', '##pm', '[SEP]'], Float32Array.from({ length: 30 }, (_, index) => index % 3 + 1), new Float32Array(3), 3);
assert.deepEqual(packed.words.map(word => word.text), ['cafe', 'running', 'at', '5:30pm']);
assert.equal(packed.words[1].to - packed.words[1].from, 7, 'WordPiece continuation split the displayed word');
assert.equal(packed.words.at(-1).to, 'Café running at 5:30pm'.length, 'A numeric deadline was cut inside its token');
assert.ok(packed.vectors instanceof Int8Array && packed.vectors.length === packed.words.length * 3);

// Exactly one encoder call, with the original attention-masked mean and L2 norm.
let forwardCalls = 0;
const hidden = new Tensor('float32', new Float32Array([1, 2, 3, 2, 4, 1, 3, 1, 2, 100, 100, 100]), [1, 4, 3]), mask = new Tensor('int64', new BigInt64Array([1n, 1n, 1n, 0n]), [1, 4]);
const extractor = { tokenizer: Object.assign(() => ({ input_ids: new Tensor('int64', new BigInt64Array([0n, 1n, 2n, 3n]), [1, 4]), attention_mask: mask }), { model: { convert_ids_to_tokens: () => ['[CLS]', 'car', '[SEP]', '[PAD]'] } }), model: async () => { forwardCalls++; return { last_hidden_state: hidden }; } };
const [vector] = await embedInNote(extractor, ['car']);
assert.equal(forwardCalls, 1, 'Phrase display caused another encoder pass');
const expectedVector = [6 / 11, 7 / 11, 6 / 11];
assert.ok(Array.from(vector).every((value, index) => Math.abs(value - expectedVector[index]) < 1e-7), 'Attribution changed the attention-masked, normalized sentence vector');
assert.ok(vector.focus.words.length === 1);

// Cached-note display work must remain cheap even with hundreds of findings.
const dimension = 384, performanceQuery = profile('fix the car', { fix: 0, car: 1 }, dimension), performancePassage = profile('The mechanic repaired the automobile after diagnosing the engine.', { repaired: 0, automobile: 1 }, dimension);
const started = performance.now(); for (let index = 0; index < 1000; index++) inNoteFocusRange(performanceQuery, performancePassage);
const elapsed = performance.now() - started; assert.ok(elapsed < 120, `Phrase attribution exceeded its 1,000-finding budget (${elapsed.toFixed(1)} ms)`);
console.log(`Phrase regressions passed: semantic alignment, negation/contrast, Markdown offsets, Unicode/WordPiece/deadlines, identical pooled vectors, one encoder pass; 1,000 cached spans ${elapsed.toFixed(1)} ms.`);
