import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { MOBILE_BOOTSTRAP_SEGMENTS, bootstrapBucket, mobileBootstrapFileIndex, readMobileBootstrap, readMobileBootstrapManifest, writeMobileBootstrap } from '../src/mobile-bootstrap.js';
import { MobileSearchRuntime, mobileBootstrapEmbeddingBatches } from '../src/mobile-runtime.js';

class MemoryAdapter {
  constructor() { this.files = new Map(); this.directories = new Set(); }
  async exists(path) { return this.files.has(path) || this.directories.has(path); }
  async mkdir(path) { this.directories.add(path); }
  async read(path) { const value = this.files.get(path); if (typeof value !== 'string') throw new Error(`Not text: ${path}`); return value; }
  async write(path, value) { this.files.set(path, String(value)); }
  async readBinary(path) { const value = this.files.get(path); if (!(value instanceof Uint8Array)) throw new Error(`Not binary: ${path}`); return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength); }
  async writeBinary(path, value) { this.files.set(path, new Uint8Array(value).slice()); }
  async remove(path) { this.files.delete(path); }
  async rename(from, to) { const value = this.files.get(from); if (value === undefined) throw new Error(`Missing rename source: ${from}`); this.files.set(to, value); this.files.delete(from); }
}

const vector = seed => new Float32Array([seed, seed + .1, seed + .2, seed + .3]), dimension = 4, pathA = 'Writings/A.md'; let pathB = 'Notes/B.md';
while (bootstrapBucket(pathA, MOBILE_BOOTSTRAP_SEGMENTS) === bootstrapBucket(pathB, MOBILE_BOOTSTRAP_SEGMENTS)) pathB = `Folder/${pathB}`;
const bucketA = bootstrapBucket(pathA, MOBILE_BOOTSTRAP_SEGMENTS), bucketB = bootstrapBucket(pathB, MOBILE_BOOTSTRAP_SEGMENTS), adapter = new MemoryAdapter(), directory = '.obsidian/plugins/gib-search/mobile-bootstrap';
const firstBuckets = new Map(Array.from({ length: MOBILE_BOOTSTRAP_SEGMENTS }, (_, bucket) => [bucket, { meta: [], vectors: [] }]));
firstBuckets.get(bucketA).meta.push({ file: pathA, contentHash: 'a1' }); firstBuckets.get(bucketA).vectors.push(vector(1)); firstBuckets.get(bucketB).meta.push({ file: pathB, contentHash: 'b1' }); firstBuckets.get(bucketB).vectors.push(vector(2));
const firstIndex = new Map([[pathA, { mtime: 1, size: 10, contentHash: 'a1', bucket: bucketA, records: 1 }], [pathB, { mtime: 1, size: 20, contentHash: 'b1', bucket: bucketB, records: 1 }]]), base = { dimension, modelId: 'test-model', passageVersion: 3, chunkCharacters: 1000 };
const first = await writeMobileBootstrap(adapter, directory, { ...base, buckets: firstBuckets, fileIndex: firstIndex });
assert.equal(first.changedSegments, MOBILE_BOOTSTRAP_SEGMENTS); assert.equal(first.reusedSegments, 0); assert.equal(mobileBootstrapFileIndex(first).size, 2);
const firstRead = await readMobileBootstrap(adapter, directory); assert.equal(firstRead.meta.length, 2); assert.equal(firstRead.vectors.length, 2);
const invalidAdapter = new MemoryAdapter(); invalidAdapter.files.set('bad/manifest.json', JSON.stringify({ ...first, segments: first.segments.slice(1) }));
await assert.rejects(readMobileBootstrapManifest(invalidAdapter, 'bad'), /Unsupported mobile bootstrap manifest/);

const changedBuckets = new Map([[bucketA, { meta: [{ file: pathA, contentHash: 'a2' }], vectors: [vector(3)] }]]), secondIndex = new Map([[pathA, { mtime: 2, size: 11, contentHash: 'a2', bucket: bucketA, records: 1 }], [pathB, firstIndex.get(pathB)]]), oldA = first.segments.find(segment => segment.bucket === bucketA), oldB = first.segments.find(segment => segment.bucket === bucketB);
const second = await writeMobileBootstrap(adapter, directory, { ...base, buckets: changedBuckets, previousManifest: first, fileIndex: secondIndex });
assert.equal(second.changedSegments, 1); assert.equal(second.reusedSegments, MOBILE_BOOTSTRAP_SEGMENTS - 1); assert.notEqual(second.segments.find(segment => segment.bucket === bucketA).name, oldA.name); assert.equal(second.segments.find(segment => segment.bucket === bucketB).name, oldB.name); assert.equal(await adapter.exists(`${directory}/${oldA.name}`), false); assert.equal(await adapter.exists(`${directory}/${oldB.name}`), true);
const secondRead = await readMobileBootstrap(adapter, directory), byFile = new Map(secondRead.meta.map((item, index) => [item.file, secondRead.vectors[index]])); assert.deepEqual([...byFile.get(pathA)], [...vector(3)]); assert.deepEqual([...byFile.get(pathB)], [...vector(2)]);

const entries = Array.from({ length: 10 }, (_, index) => ({ chunks: [{ text: String(index) }] })), started = performance.now(), batches = mobileBootstrapEmbeddingBatches(entries, 4), elapsed = performance.now() - started;
assert.deepEqual(batches.map(batch => batch.length), [4, 4, 2]); assert.deepEqual(batches[0].map(item => item.entryIndex), [0, 1, 2, 3]); assert.ok(elapsed < 100, `Cross-file batch planning is unexpectedly slow: ${elapsed.toFixed(1)} ms`);

const runtimeAdapter = new MemoryAdapter(), contents = new Map(), files = Array.from({ length: 20 }, (_, index) => {
  const content = `# Note ${index}\n\nA distinct short passage for mobile bootstrap test number ${index}.`;
  contents.set(`Notes/${index}.md`, content); return { path: `Notes/${index}.md`, extension: 'md', stat: { mtime: 100 + index, size: content.length } };
}), embedCalls = [], diagnostics = [];
const plugin = {
  isMobile: false,
  manifest: { id: 'gib-search' },
  settings: { mobileBootstrapEnabled: true, mobileBootstrapPath: 'mobile-package' },
  app: {
    vault: { adapter: runtimeAdapter, configDir: '.obsidian', getName: () => 'Test vault', getFiles: () => files, read: file => Promise.resolve(contents.get(file.path)) },
    metadataCache: { getFileCache: () => null },
  },
  desktopEmbedder: {
    async embedMobileBootstrap(texts) { embedCalls.push(texts.slice()); return texts.map((_, index) => { const output = new Float32Array(384); output[(embedCalls.length + index) % output.length] = 1; return output; }); },
    async releaseMobileBootstrap() {},
  },
  logDiagnostic(message) { diagnostics.push(message); },
};
const runtime = new MobileSearchRuntime(plugin); runtime.indexingConfig.maximumEmbedBatchSize = 16;
const built = await runtime.buildMobileBootstrap();
assert.deepEqual(embedCalls.map(call => call.length), [16, 4], 'The complete builder should combine short notes into full cross-file batches');
assert.equal(built.files, files.length); assert.equal(built.changedSegments, MOBILE_BOOTSTRAP_SEGMENTS); assert.equal(built.reusedSegments, 0);
const unchangedGeneration = built.generation, callsAfterBuild = embedCalls.length, current = await runtime.buildMobileBootstrap();
assert.equal(current.generation, unchangedGeneration, 'An unchanged package should not be rewritten'); assert.equal(embedCalls.length, callsAfterBuild, 'An unchanged package should not run inference');
const changedFile = files[3], changedContent = `${contents.get(changedFile.path)}\n\nA newly added sentence.`;
contents.set(changedFile.path, changedContent); changedFile.stat = { mtime: changedFile.stat.mtime + 1, size: changedContent.length };
const refreshed = await runtime.buildMobileBootstrap();
assert.equal(embedCalls.length, callsAfterBuild + 1); assert.equal(embedCalls.at(-1).length, 1); assert.equal(refreshed.changedSegments, 1); assert.equal(refreshed.reusedSegments, MOBILE_BOOTSTRAP_SEGMENTS - 1); assert.notEqual(refreshed.generation, unchangedGeneration);
assert.ok(diagnostics.some(message => message.includes('cross-file batches')));

console.log(`Mobile bootstrap checks passed: complete builder batches 20 short notes as 16/4, skips an unchanged rebuild, and refreshes 1 of ${MOBILE_BOOTSTRAP_SEGMENTS} segments after one file changes.`);
