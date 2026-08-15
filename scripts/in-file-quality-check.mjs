import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { env, pipeline } from '@huggingface/transformers';
import { MobileSearchRuntime, chunkMarkdown } from '../src/mobile-runtime.js';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
const modelRoot = argument('model-root') || process.env.GIB_SEARCH_MODEL_ROOT || '';
const dtype = argument('dtype') || process.env.GIB_SEARCH_AUDIT_DTYPE || 'q8';
const inspectionFile = argument('file'), inspectionQuery = argument('query'), verbose = process.argv.includes('--verbose') || Boolean(inspectionFile);
if (modelRoot) { env.localModelPath = modelRoot.replaceAll('\\', '/'); env.allowLocalModels = true; env.allowRemoteModels = false; }
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype, device: 'cpu' });
const embed = async (texts, query = false) => {
  if (!texts.length) return [];
  const input = texts.map(text => query ? `Represent this sentence for searching relevant passages: ${text}` : text), output = await extractor(input, { pooling: 'mean', normalize: true }), dimension = output.dims.at(-1);
  return texts.map((_, index) => new Float32Array(output.data.slice(index * dimension, (index + 1) * dimension)));
};
const plugin = { isMobile: false, settings: {}, manifest: { id: 'gib-search' }, recordActivity() {}, logDiagnostic() {}, reportOnce() {}, app: { vault: { adapter: { getBasePath: () => 'quality-audit' }, configDir: '.obsidian', getName: () => 'quality-audit' }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) }, workspace: { getActiveFile: () => null } } };
const tuning = {
  balanced: { resultMinScore: .3, passageMinScore: .43, phraseMinScore: .57, clauseMinScore: .53, clauseMargin: .015, fallbackMinScore: .57, fallbackLimit: 2, sentenceBeam: 6, localLimit: 4, localWindow: .1, resultWindow: .18, resultLimit: 6, sentenceLimit: 32, scoreWindow: .24, limit: 40 },
  broad: { resultMinScore: .18, passageMinScore: .34, phraseMinScore: .48, clauseMinScore: .44, clauseMargin: .005, fallbackMinScore: .49, fallbackLimit: 4, sentenceBeam: 8, localLimit: 6, localWindow: .16, resultWindow: .28, resultLimit: 10, sentenceLimit: 40, scoreWindow: .38, limit: 64 },
};
const cases = [
  { name: 'relational synonym', query: 'child of god', source: 'The doctrine says humanity is the divine offspring of God. A speaker might say that God remains mysterious. God is correctly understood by the congregation. The Spirit of God inspired the hymn.', expected: [/offspring of God/i], forbidden: [/say that God/i, /God is correctly understood/i, /Spirit of God/i] },
  { name: 'reordered possessive relation', query: 'gods power', source: 'Creation unfolds through the direction and power of God. Humanity is described as the offspring of God. God does not convey truth through every rumor.', expected: [/power of God/i], forbidden: [/offspring of God/i, /convey truth/i] },
  { name: 'modifier paraphrase', query: 'more study', source: 'From further study, the pattern becomes clearer. There are many truths to be known, though only a few are relevant. The committee postponed the meeting.', expected: [/further study/i], forbidden: [/truths to be known/i] },
  { name: 'vehicle paraphrase', query: 'fix the car', source: 'The mechanic repaired the automobile after diagnosing the engine. The car remained parked beside the house. We fixed dinner before sunset.', expected: [/repaired the automobile/i], forbidden: [/car remained parked/i, /fixed dinner/i] },
  { name: 'emotion paraphrase', query: 'deep sadness', source: 'She was overwhelmed by grief after the loss. The report measured deep water near the pier. A blue folder rested on the table.', expected: [/overwhelmed by grief/i], forbidden: [/deep water/i, /blue folder/i] },
  { name: 'action intent', query: 'reduce anxiety', source: 'Slow breathing helped her feel calm again. Anxiety can interrupt sleep. The reduction was approved by the committee.', expected: [/feel calm/i], forbidden: [/Anxiety can interrupt sleep/i, /reduction was approved/i] },
  { name: 'confidentiality intent', query: 'protect private data', source: 'Encrypt the confidential records before creating a backup. The data table lists quarterly revenue. Private meetings occur on Friday.', expected: [/Encrypt the confidential records/i], forbidden: [/data table/i, /Private meetings/i] },
  { name: 'markdown rule paraphrase', query: 'when to stop eating', source: '## Rules\n\n- No food after 5:30pm.\n- Eating window: 9:30am to 5:30pm.\n- Track water and sleep.', expected: [/No food after 5:30pm/i], forbidden: [/Eating window/i, /Track water/i] },
];
if (inspectionFile && inspectionQuery) {
  const literalPattern = value => new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), splitPatterns = name => argument(name).split(';;').map(value => value.trim()).filter(Boolean).map(literalPattern);
  cases.unshift({ name: `inspection ${inspectionFile}`, query: inspectionQuery, source: await readFile(inspectionFile, 'utf8'), expected: splitPatterns('expect'), forbidden: splitPatterns('forbid') });
}

let assertions = 0, forbiddenHits = 0; const durations = [], failures = [];
for (const test of cases) {
  const chunks = chunkMarkdown(test.source, 700), runtime = new MobileSearchRuntime(plugin); runtime.embedBatch = embed; runtime.meta = chunks.map((chunk, index) => ({ ...chunk, file: `${test.name}.md`, passageIndex: index, contentHash: `${test.name}:${index}`, highlightCandidates: [] })); runtime.vectors = await embed(chunks.map(chunk => chunk.text)); runtime.refreshLexical();
  for (const [mode, values] of Object.entries(tuning)) {
    const started = performance.now(), results = await runtime.search(test.query, values.limit, 0, { file: `${test.name}.md`, disableQueryCorrection: true, scoreWindow: values.scoreWindow, semanticHighlights: true, semanticPassages: true, semanticPassagesOnly: true, resultMinScore: values.resultMinScore, passageMinScore: values.passageMinScore, localPhraseMinScore: values.phraseMinScore, clauseMinScore: values.clauseMinScore, clauseParentMargin: values.clauseMargin, clauseContextWeight: .18, localSentenceBeam: values.sentenceBeam, localSemanticLimit: values.localLimit, localSemanticWindow: values.localWindow, sentenceFallbackMinScore: values.fallbackMinScore, sentenceFallbackLimit: values.fallbackLimit, passageResultWindow: values.resultWindow, passageResultLimit: values.resultLimit, passageSentenceLimit: values.sentenceLimit }), elapsed = performance.now() - started, highlights = [...new Set(results.flatMap(result => [...(result.semanticPhrases || []), ...(result.semanticPassages || [])]).map(item => String(item.sourcePhrase || item.phrase || '').trim()).filter(Boolean))]; durations.push(elapsed);
    if (verbose) console.log(`${dtype} ${mode} ${test.name}: ${JSON.stringify(highlights)} chunks=${JSON.stringify(results.map(result => ({ score: Number(result.semanticScore || 0).toFixed(3), text: result.text })))}`);
    for (const expected of test.expected) { assertions++; if (!highlights.some(phrase => expected.test(phrase))) failures.push(`${mode} ${test.name} missed ${expected}: ${JSON.stringify(highlights)}`); }
    for (const forbidden of test.forbidden) { assertions++; const matches = highlights.filter(phrase => forbidden.test(phrase)); forbiddenHits += matches.length; if (matches.length) failures.push(`${mode} ${test.name} admitted ${forbidden}: ${JSON.stringify(highlights)}`); }
    if (!highlights.every(phrase => !/^(?:and|but|or|say that|that)\b/i.test(phrase))) failures.push(`${mode} ${test.name} emitted an incomplete grammatical fragment: ${JSON.stringify(highlights)}`);
  }
}
const ordered = durations.slice().sort((a, b) => a - b), p95 = ordered[Math.max(0, Math.ceil(ordered.length * .95) - 1)];
assert.equal(failures.length, 0, `In-file semantic quality failures:\n${failures.join('\n')}`); assert.equal(forbiddenHits, 0); assert.ok(p95 < 5000, `Warm in-file quality audit p95 is too slow: ${p95.toFixed(1)} ms`);
console.log(`In-file semantic quality audit passed ${assertions} labeled checks across ${cases.length} cases and 2 breadth modes; 0 forbidden highlights; warm p95 ${p95.toFixed(1)} ms (${dtype}).`);
