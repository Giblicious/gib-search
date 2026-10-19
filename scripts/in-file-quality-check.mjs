import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { env, pipeline } from '@huggingface/transformers';
import { MobileSearchRuntime } from '../src/mobile-runtime.js';
import { IN_NOTE_PRESETS } from '../src/in-note-search.js';
import { embedInNote } from '../src/in-note-embedding.js';
import { inNotePhraseCases, additionalPhraseCases } from './in-note-phrase-cases.mjs';
import { additionalInNoteCases } from './in-note-cases.mjs';
import { inNoteRelevanceCases } from './in-note-relevance-cases.mjs';
import { inNoteLogicCases } from './in-note-logic-cases.mjs';
import { inNoteQuestionCases } from './in-note-question-cases.mjs';
import { inNoteLiveCases } from './in-note-live-cases.mjs';

const argumentsFor = name => process.argv.filter(value => value.startsWith(`--${name}=`)).map(value => value.slice(name.length + 3)), argument = name => argumentsFor(name)[0] || '';
const modelRoot = argument('model-root') || process.env.GIB_SEARCH_MODEL_ROOT || '';
const dtype = argument('dtype') || process.env.GIB_SEARCH_AUDIT_DTYPE || 'q8';
const inspectionFile = argument('file'), inspectionQueries = argumentsFor('query'), summaryOnly = process.argv.includes('--summary'), requestedMobileProfile = process.argv.includes('--mobile'), allBudgets = process.argv.includes('--all-budgets'), diagnostics = process.argv.includes('--diagnostics'), verbose = !summaryOnly && (process.argv.includes('--verbose') || diagnostics || Boolean(inspectionFile));
if (modelRoot) { env.localModelPath = modelRoot.replaceAll('\\', '/'); env.allowLocalModels = true; env.allowRemoteModels = false; }
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype, device: 'cpu' });
const classifier = await pipeline('text-classification', argument('nli-model') || 'Xenova/mobilebert-uncased-mnli', { dtype: 'q8', device: 'cpu' });
const relevanceModel = await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', { revision: 'a09144355adeed5f58c8ed011d209bf8ee5a1fec', dtype: 'q8', device: 'cpu' });
const consistencyModel = await pipeline('text-classification', 'Xenova/nli-deberta-v3-xsmall', { revision: '2a4f614a701367a02d51389039afc998faeda637', dtype: 'q8', device: 'cpu' });
const inNotePairs = async (pairs, kind) => {
  if (!pairs.length) return [];
  const result = [], batchSize = plugin.isMobile ? 4 : 12;
  for (let offset = 0; offset < pairs.length; offset += batchSize) {
    const batch = pairs.slice(offset, offset + batchSize);
    if (kind === 'guard') result.push(...await classifyWith(consistencyModel, batch));
    else { const features = relevanceModel.tokenizer(batch.map(pair => pair.query), { text_pair: batch.map(pair => pair.passage), padding: true, truncation: true, max_length: 192 }); result.push(...(await relevanceModel.model(features)).logits.data); }
  }
  return result;
};
const parallelClassifier = process.argv.includes('--parallel-meaning') ? await pipeline('text-classification', argument('nli-model') || 'Xenova/mobilebert-uncased-mnli', { dtype: 'q8', device: 'cpu' }) : null;
const embed = async texts => {
  if (!texts.length) return [];
  return embedInNote(extractor, texts);
};
const classifyWith = async (classifier, pairs) => {
  if (!pairs.length) return [];
  const features = classifier.tokenizer(pairs.map(pair => pair.premise), { text_pair: pairs.map(pair => pair.hypothesis), padding: true, truncation: true, max_length: 256 }), output = await classifier.model(features), width = output.logits.dims.at(-1), labels = classifier.model.config.id2label;
  return pairs.map((_, index) => { const logits = Array.from(output.logits.data.slice(index * width, (index + 1) * width)), exponents = logits.map(value => Math.exp(value - Math.max(...logits))), sum = exponents.reduce((a, b) => a + b, 0); return Object.fromEntries(exponents.map((value, label) => [labels[label].toLowerCase(), value / sum])); });
};
const classify = async pairs => {
  if (!parallelClassifier || pairs.length <= 6) return classifyWith(classifier, pairs);
  const middle = Math.ceil(pairs.length / 2), parts = await Promise.all([classifyWith(classifier, pairs.slice(0, middle)), classifyWith(parallelClassifier, pairs.slice(middle))]);
  return parts.flat();
};
const plugin = { isMobile: requestedMobileProfile, settings: {}, manifest: { id: 'gib-search' }, recordActivity() {}, logDiagnostic() {}, reportOnce() {}, app: { vault: { adapter: { getBasePath: () => 'quality-audit' }, configDir: '.obsidian', getName: () => 'quality-audit' }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) }, workspace: { getActiveFile: () => null } } };
const cases = [
  { name: 'relational synonym', query: 'child of god', source: 'The doctrine says humanity is the divine offspring of God. A speaker might say that God remains mysterious. God is correctly understood by the congregation. The Spirit of God inspired the hymn.', expected: [/offspring of God/i], forbidden: [/say that God/i, /God is correctly/i, /Spirit of God/i] },
  { name: 'reordered possessive relation', query: 'gods power', source: 'Creation unfolds through the direction and power of God. Humanity is described as the offspring of God. God does not convey truth through every rumor.', expected: [/power of God/i], forbidden: [/offspring of God/i, /convey truth/i] },
  { name: 'modifier paraphrase', query: 'more study', source: 'From further study, the pattern becomes clearer. There are many truths to be known, though only a few are relevant. The committee postponed the meeting.', expected: [/further study/i], forbidden: [/truths to be known/i] },
  { name: 'vehicle paraphrase', query: 'fix the car', source: 'The mechanic repaired the automobile after diagnosing the engine. The car remained parked beside the house. We fixed dinner before sunset.', expected: [/repaired the automobile/i], forbidden: [/car remained parked/i, /fixed dinner/i] },
  { name: 'emotion paraphrase', query: 'deep sadness', source: 'She was overwhelmed by grief after the loss. The report measured deep water near the pier. A blue folder rested on the table.', expected: [/overwhelmed by grief/i], forbidden: [/deep water/i, /blue folder/i] },
  { name: 'action intent', query: 'reduce anxiety', source: 'Slow breathing helped her feel calm again. Anxiety can interrupt sleep. The reduction was approved by the committee.', expected: [/feel calm/i], forbidden: [/interrupt sleep/i, /reduction was approved/i] },
  { name: 'confidentiality intent', query: 'protect private data', source: 'Encrypt the confidential records before creating a backup. The data table lists quarterly revenue. Private meetings occur on Friday.', expected: [/Encrypt the confidential records/i], forbidden: [/data table/i, /Private meetings/i] },
  { name: 'markdown rule paraphrase', query: 'when to stop eating', source: '## Rules\n\n- No food after 5:30pm.\n- Eating window: 9:30am to 5:30pm.\n- Track water and sleep.', expected: [/No food after 5:30pm/i], forbidden: [/Eating window|9:30am to 5:30pm/i, /Track water/i] },
  { name: 'freedom paraphrase', query: 'personal freedom', source: 'Each person possesses individual liberty to choose a path. The freedom festival begins downtown. A personal folder sits on the shelf.', expected: [/individual liberty/i], forbidden: [/freedom festival/i, /personal folder/i] },
  { name: 'hardship paraphrase', query: 'financial hardship', source: 'The family struggled through severe economic difficulty after the factory closed. The financial report arrived yesterday. Hiking difficulty increased near the summit.', expected: [/economic difficulty/i], forbidden: [/financial report/i, /Hiking difficulty/i] },
  { name: 'memory paraphrase', query: 'remember childhood', source: 'She recalled vivid memories from her youth. The children waited beside the bus. Remember to lock the door.', expected: [/memories from her youth/i], forbidden: [/children waited/i, /Remember to lock/i] },
  { name: 'peer influence paraphrase', query: 'social pressure', source: 'Influence from her peers changed the decision. The pressure gauge showed a leak. Their social calendar was full.', expected: [/Influence from her peers/i], forbidden: [/pressure gauge/i, /calendar was full/i] },
  { name: 'doubt paraphrase', query: 'religious doubt', source: 'His faith weakened as unanswered questions accumulated. The religious service ended at noon. There was doubt about the weather forecast.', expected: [/faith weakened/i], forbidden: [/religious service/i, /doubt about the weather/i] },
  { name: 'cosmology paraphrase', query: 'origin of universe', source: 'Scientists debated how the cosmos began. The university opened a new laboratory. The document listed the origin address.', expected: [/cosmos began/i], forbidden: [/university opened/i, /origin address/i] },
  { name: 'three-concept relation', query: 'god guided evolution', source: 'Organic evolution proceeds through the direction and power of God. God is correctly understood by the congregation. The evolution magazine arrived yesterday.', expected: [/direction and power of God/i], forbidden: [/God is correctly understood/i, /evolution magazine/i] },
  { name: 'heading-resolved discourse', query: 'emotional debate about evolution', source: '## Does Evolution Matter?\n\nThere is a tremendous amount of emotion among those who hold opinions on this topic, both for and against.\n\n## Definition\n\nOrganic evolution describes gradual biological change. The evolution magazine arrived yesterday.', expected: [/tremendous amount of emotion/i], forbidden: [/biological change/i, /evolution magazine/i] },
  { name: 'distributed relational context', query: 'human ancestor without a soul', source: '## Why Pre-Adamites Matter\n\nHow do we compare Adam and his genetic father? Would his genetic father be inhuman, something taking the form of man, but having no salvation or soul?\n\n## Other Claims\n\nOne theory says man is not the divine offspring of God. Scholars disagree about the origins of man.', expected: [/genetic father/i, /no salvation or soul/i], forbidden: [/divine offspring/i, /origins of man/i] },
];

cases.forEach(test => { test.required = true; });
cases.push(...additionalInNoteCases);
cases.push(...additionalPhraseCases);
cases.push(...inNoteRelevanceCases);
cases.push(...inNoteLogicCases, ...inNoteQuestionCases);
cases.push(...inNoteLiveCases);
const caseFilter = argument('case'); if (caseFilter) cases.splice(0, cases.length, ...cases.filter(test => test.name.toLowerCase().includes(caseFilter.toLowerCase())));
if (inspectionFile && inspectionQueries.length) {
  const literalPattern = value => new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), splitPatterns = value => String(value || '').split(';;').map(item => item.trim()).filter(Boolean).map(literalPattern), expected = argumentsFor('expect'), forbidden = argumentsFor('forbid'), source = await readFile(inspectionFile, 'utf8');
  inspectionQueries.forEach((query, index) => cases.unshift({ name: `inspection ${index + 1}`, query, source, expected: splitPatterns(expected[index]), forbidden: splitPatterns(forbidden[index]) }));
}
const report = [], failures = [];
for (const mobileProfile of allBudgets ? [false, true] : [requestedMobileProfile]) {
  plugin.isMobile = mobileProfile; let assertions = 0, forbiddenHits = 0, positives = 0, found = 0, phraseAssertions = 0; const durations = [];
  for (const test of cases) {
    const runtime = new MobileSearchRuntime(plugin); runtime.embedBatch = embed; runtime.classifyRelationPairs = classify; runtime.inNotePairs = inNotePairs;
    // The real UI's live-source method, with no index preloaded or patched scores.
    for (const mode of Object.keys(IN_NOTE_PRESETS)) {
      const started = performance.now(), stages = [], result = await runtime.searchInNote(test.query, test.source, { breadth: mode, diagnostics: true, onProgress: progress => { stages.push({ stage: progress.stage, elapsed: performance.now() - started, ranges: progress.ranges.length }); assert.ok(progress.ranges.every(range => test.source.slice(range.from, range.to) === range.sourcePhrase), `${test.name} provisional offsets changed`); } }), elapsed = performance.now() - started, matches = result.matches, highlights = matches.map(match => match.sourcePhrase);
      assert.deepEqual(stages.map(row => row.stage), ['paragraph', 'sentence'], `${test.name} refinement order changed`);
      durations.push(elapsed);
      const missed = (test.expected || []).filter(pattern => !highlights.some(phrase => pattern.test(phrase))), forbidden = (test.forbidden || []).filter(pattern => highlights.some(phrase => pattern.test(phrase)));
      if (test.exhaustive) for (const phrase of highlights.filter(phrase => ![...(test.expected || []), ...(test.ambiguous || [])].some(pattern => pattern.test(phrase)))) { forbiddenHits++; failures.push(`${test.name} ${mode} returned an unsupported occurrence: ${phrase}`); }
      if (mode !== 'precise') { assertions += (test.expected || []).length; positives += (test.expected || []).length; found += (test.expected || []).length - missed.length; if (test.required) for (const pattern of missed.filter(pattern => !(test.optional || []).some(optional => String(optional) === String(pattern)))) failures.push(`${mobileProfile ? 'mobile' : 'desktop'} ${mode} ${test.name} missed ${pattern}: ${JSON.stringify(highlights)}`); }
      assertions += (test.forbidden || []).length + (test.empty ? 1 : 0); forbiddenHits += forbidden.length;
      for (const pattern of forbidden) failures.push(`${mobileProfile ? 'mobile' : 'desktop'} ${mode} ${test.name} admitted ${pattern}: ${JSON.stringify(highlights)}`);
      if (test.empty && highlights.length) { forbiddenHits += highlights.length; failures.push(`${mobileProfile ? 'mobile' : 'desktop'} ${mode} ${test.name} invented matches: ${JSON.stringify(highlights)}`); }
      if (mode !== 'precise' && Number.isInteger(test.expectedCount) && highlights.length !== test.expectedCount) failures.push(`${mobileProfile ? 'mobile' : 'desktop'} ${mode} ${test.name} expected ${test.expectedCount} occurrences, received ${highlights.length}`);
      assert.ok(matches.every(match => test.source.slice(match.from, match.to) === match.sourcePhrase), `${test.name} lost source offsets`);
      assert.ok(matches.every(match => !match.highlight || match.highlight.from >= match.from && match.highlight.to <= match.to && test.source.slice(match.highlight.from, match.highlight.to) === match.highlight.sourcePhrase), `${test.name} lost phrase offsets`);
      const phraseCheck = inNotePhraseCases[test.name];
      if (phraseCheck) for (const match of matches) { if (!match.highlight || !phraseCheck.expected.test(match.highlight.phrase) || phraseCheck.excluded?.test(match.highlight.phrase)) failures.push(`${test.name} ${mode} lost the relevant phrase: ${match.highlight?.phrase}`); phraseAssertions += 2; }
      const row = { name: test.name, query: test.query, mobile: mobileProfile, mode, elapsed, stages, highlights, phrases: matches.map(match => match.highlight?.phrase || match.phrase), missed: missed.map(String), forbidden: forbidden.map(String), ambiguous: (test.ambiguous || []).filter(pattern => highlights.some(phrase => pattern.test(phrase))).map(String), ...(diagnostics ? { candidates: result.candidates } : {}) }; report.push(row);
      if (verbose) console.log(JSON.stringify(row));
    }
  }
  const p95 = durations.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(durations.length * .95) - 1)];
  console.log(`In-note audit: ${assertions} checks, ${cases.length} cases, all 3 breadth modes, ${mobileProfile ? 'mobile' : 'desktop'} batches; ${found}/${positives} paraphrases; ${forbiddenHits} forbidden hits; ${phraseAssertions} phrase-span checks; warm p95 ${p95.toFixed(1)} ms (${dtype}).`);
  if (positives && found / positives < .95) failures.push(`In-note paraphrase recall regressed below 95%: ${found}/${positives}`);
  if (p95 >= 5000) failures.push(`In-note audit p95 is too slow: ${p95.toFixed(1)} ms`);
}
if (argument('report')) await writeFile(argument('report'), JSON.stringify({ report, failures }, null, 2));
assert.equal(failures.length, 0, `In-note quality failures:\n${failures.join('\n')}`);
await extractor.dispose(); await classifier.dispose(); await parallelClassifier?.dispose(); await relevanceModel.dispose(); await consistencyModel.dispose();
