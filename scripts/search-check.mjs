import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IncrementalBm25, assembleIndexSegments, boundedTopK, centroidSimilarity, diverseCentroids } from '../src/search-core.js';
import { MobileSearchRuntime, chunkMarkdown } from '../src/mobile-runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vector = (...values) => { const result = new Float32Array(384); values.forEach((value, index) => { result[index] = value; }); const norm = Math.hypot(...values) || 1; values.forEach((value, index) => { result[index] = value / norm; }); return result; };

const lexical = new IncrementalBm25();
lexical.replaceFile('Science.md', [{ key: 'science:1', fields: { title: 'Plant notes', heading: 'Energy', body: 'Photosynthesis converts light into chemical energy.', path: 'Study', metadata: 'biology' }, payload: { file: 'Science.md' } }]);
lexical.replaceFile('Journal.md', [{ key: 'journal:1', fields: { title: 'Daily entry', body: 'A quiet walk before breakfast.', path: 'Journal' }, payload: { file: 'Journal.md' } }]);
assert.equal(lexical.search('photosynthesis', 5)[0]?.key, 'science:1', 'BM25 did not recover an exact body term');
lexical.replaceFile('Science.md', [{ key: 'science:2', fields: { title: 'Plant notes', body: 'Roots take up water.' }, payload: { file: 'Science.md' } }]);
assert.equal(lexical.search('photosynthesis', 5).length, 0, 'Incremental BM25 retained a replaced passage');
assert.equal(lexical.search('breakfast', 5, new Set(['Science.md'])).length, 0, 'BM25 ignored a pre-ranking file scope');

const candidates = Array.from({ length: 5000 }, (_, index) => ({ id: index, score: Math.sin(index * 1.7) })), expected = candidates.slice().sort((a, b) => b.score - a.score).slice(0, 17).map(item => item.id), actual = boundedTopK(candidates, 17).map(item => item.id);
assert.deepEqual(actual, expected, 'Bounded top-K selection changed ranking order');

const multiTheme = diverseCentroids([vector(1, 0), vector(0, 1), vector(.98, .02), vector(.02, .98)], 3), sameThemes = diverseCentroids([vector(1, 0), vector(0, 1)], 3), genericMiddle = diverseCentroids([vector(1, 1), vector(1, 1)], 3);
assert.ok(centroidSimilarity(multiTheme, sameThemes) > centroidSimilarity(multiTheme, genericMiddle), 'Multi-centroid similarity collapsed a note into its average topic');

const validSegment = { meta: [{ file: 'A.md' }], vectors: vector(1, 0).buffer }, recovered = assembleIndexSegments([validSegment]); assert.equal(recovered.meta[0].file, 'A.md'); assert.equal(new Float32Array(recovered.vectors).length, 384); assert.throws(() => assembleIndexSegments([{ meta: [{ file: 'broken.md' }], vectors: new ArrayBuffer(4) }]), /incomplete/, 'A torn index segment was accepted instead of falling back to the prior generation');

const chunks = chunkMarkdown('---\ntitle: Hidden metadata\n---\n\n## First section\nVisible body text.\n\n## Last section\nClosing body text.', 700);
assert.equal(chunks[0]?.heading, 'First section'); assert.equal(chunks[0]?.lineStart, 5); assert.ok(chunks.every(chunk => !chunk.text.includes('Hidden metadata')), 'Chunking leaked frontmatter into passages'); assert.equal(chunks.at(-1)?.heading, 'Last section');

const files = new Map([['A.md', { path: 'A.md', extension: 'md', stat: { mtime: 2, ctime: 1 } }]]), reads = [];
const plugin = { isMobile: true, settings: { writingProfileIndexEnabled: false }, manifest: { id: 'gib-search' }, recordActivity() {}, logDiagnostic() {}, reportOnce() {}, app: { vault: { adapter: { getBasePath: () => 'test' }, configDir: '.obsidian', getName: () => 'test', getFiles: () => { throw new Error('dirty-file indexing performed a vault-wide scan'); }, getAbstractFileByPath: file => files.get(file) || null, read: async file => { reads.push(file.path); return '# Updated\nOnly this file changed.'; } }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) }, workspace: { getActiveFile: () => null } } };
const runtime = new MobileSearchRuntime(plugin); runtime.enabled = true; runtime.indexingTurn = async () => {}; runtime.embedIndexChunks = async texts => texts.map(() => vector(1, 0)); runtime.queueIndexSave = () => { runtime.indexDirty = true; }; runtime.scheduleWritingProfileSync = () => {}; runtime.meta = [{ file: 'A.md', heading: 'Old', text: 'Old text', lineStart: 0, lineEnd: 0, mtime: 1, contentHash: 'old-a', passageVersion: 3, highlightVersion: 1, highlightCandidates: [], graphVersion: 1, entities: [] }, { file: 'B.md', heading: '', text: 'Untouched', lineStart: 0, lineEnd: 0, mtime: 1, contentHash: 'old-b', passageVersion: 3, highlightVersion: 1, highlightCandidates: [], graphVersion: 1, entities: [] }]; runtime.vectors = [vector(1, 0), vector(0, 1)];
await runtime.performDirtyIndexUpdate(false, new Set(['A.md']));
assert.deepEqual(reads, ['A.md'], 'Dirty-file indexing read more than the changed file'); assert.ok(runtime.meta.some(item => item.file === 'B.md' && item.text === 'Untouched'), 'Dirty-file commit discarded an unchanged note'); assert.ok(runtime.meta.some(item => item.file === 'A.md' && item.text.includes('Only this file changed')), 'Dirty-file commit did not replace the changed note');

const runtimeSource = fs.readFileSync(path.join(root, 'src', 'mobile-runtime.js'), 'utf8'), workerSource = fs.readFileSync(path.join(root, 'src', 'desktop-embed-worker.js'), 'utf8'), mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
assert.ok(runtimeSource.includes('const INDEX_BUCKETS = 64') && runtimeSource.includes(':segment:${snapshot.buckets[bucket]}') && runtimeSource.includes('previousManifest.current'), 'Mobile persistence is not segmented with a rollback generation');
assert.ok(workerSource.includes('const taskQueues = Array.from') && workerSource.includes('enqueueTask(message.priority') && workerSource.includes("enqueueTask(message.lowPriority ? 4 : 2"), 'Background inference does not prioritize interactive work');
assert.ok(mainSource.includes('semanticHighlights: false') && mainSource.includes('highlightResults(highlighted, query'), 'Search does not render results before semantic highlighting');
assert.ok(!runtimeSource.includes("from 'compromise'"), 'The synchronous NLP parser remains in the indexing runtime');

const performanceIndex = new IncrementalBm25(); for (let index = 0; index < 12000; index++) performanceIndex.upsert(`doc:${index}`, { title: `Note ${index}`, body: `shared language topic-${index % 97} exact-${index}` }, { file: `${index}.md` }); const started = performance.now(); const performanceResults = performanceIndex.search('shared language', 20); const elapsed = performance.now() - started; assert.equal(performanceResults.length, 20); assert.ok(elapsed < 750, `BM25 performance regression: ${elapsed.toFixed(1)} ms`);

console.log(`Search engine checks passed (${elapsed.toFixed(1)} ms for 12,000-document lexical retrieval).`);
