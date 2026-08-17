import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesktopIndexStore, DESKTOP_INDEX_BUCKETS, DESKTOP_INDEX_FORMAT_VERSION, desktopIndexBucket } from '../src/desktop-index-store.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-search-index-'));
const vector = value => { const result = new Float32Array(384); result[0] = value; result[383] = value / 2; return result; };
const valueAt = (stored, file) => { const index = stored.meta.findIndex(item => item.file === file); assert.ok(index >= 0, `Missing ${file}`); return new Float32Array(stored.vectors, index * 384 * 4, 384); };
try {
  const directory = path.join(root, 'segmented'), store = new DesktopIndexStore(directory, { fs, path, crypto }), firstPath = 'Notes/Alpha.md'; let secondPath = 'Notes/Beta.md';
  while (desktopIndexBucket(firstPath) === desktopIndexBucket(secondPath)) secondPath = `Notes/x-${secondPath}`;
  const attachmentPath = 'Media/lecture.mp4', initialMeta = [{ file: firstPath, text: 'alpha old' }, { file: secondPath, text: 'beta' }, { file: attachmentPath, filenameOnly: true }], initialVectors = [vector(1), vector(2), vector(0)];
  const first = await store.put({ meta: initialMeta, vectorList: initialVectors, lastSuccessfulIndexAt: 100 }, { force: true });
  assert.equal(first.format, 'gib-search-desktop-index'); assert.equal(first.version, DESKTOP_INDEX_FORMAT_VERSION); assert.equal(first.bucketCount, DESKTOP_INDEX_BUCKETS); assert.equal(first.current.records, 3); assert.equal(first.current.vectorBytes, 2 * 384 * 4, 'Filename-only attachments must not consume a persisted semantic vector');
  const loaded = await store.get(); assert.equal(loaded.meta.length, 3); assert.equal(valueAt(loaded, firstPath)[0], 1); assert.equal(valueAt(loaded, secondPath)[383], 1); assert.ok(valueAt(loaded, attachmentPath).every(number => number === 0)); assert.equal(loaded.lastSuccessfulIndexAt, 100);
  const firstBuckets = first.current.buckets, changedMeta = initialMeta.map(item => item.file === firstPath ? { ...item, text: 'alpha new' } : item), second = await store.put({ meta: changedMeta, vectorList: [vector(9), vector(2), vector(0)], lastSuccessfulIndexAt: 200 }, { dirtyFiles: new Set([firstPath]) });
  const firstBucket = desktopIndexBucket(firstPath), secondBucket = desktopIndexBucket(secondPath); assert.notEqual(second.current.buckets[firstBucket].id, firstBuckets[firstBucket].id); assert.equal(second.current.buckets[secondBucket].id, firstBuckets[secondBucket].id, 'An unchanged bucket was rewritten');
  const currentChanged = second.current.buckets[firstBucket]; fs.writeFileSync(path.join(directory, 'segments', `${currentChanged.id}.vectors.bin`), Buffer.from([1])); const recovered = await store.get(); assert.equal(recovered.meta.find(item => item.file === firstPath)?.text, 'alpha old', 'A corrupt current segment did not fall back to the previous complete snapshot'); assert.equal(recovered.lastSuccessfulIndexAt, 100);

  const legacyDirectory = path.join(root, 'legacy'), generations = path.join(legacyDirectory, 'generations'), generation = 'legacy-one'; fs.mkdirSync(generations, { recursive: true }); fs.writeFileSync(path.join(generations, `${generation}.meta.json`), JSON.stringify([{ file: 'Legacy.md', text: 'legacy' }])); fs.writeFileSync(path.join(generations, `${generation}.vectors.bin`), Buffer.from(vector(7).buffer)); fs.writeFileSync(path.join(generations, `${generation}.state.json`), JSON.stringify({ lastSuccessfulIndexAt: 50 })); fs.writeFileSync(path.join(legacyDirectory, 'index.current.json'), JSON.stringify({ version: 2, current: generation }));
  const legacyStore = new DesktopIndexStore(legacyDirectory, { fs, path, crypto }), legacy = await legacyStore.get(); assert.equal(valueAt(legacy, 'Legacy.md')[0], 7); await legacyStore.put({ meta: legacy.meta, vectorList: [valueAt(legacy, 'Legacy.md')], lastSuccessfulIndexAt: 50 }, { force: true }); const migratedManifest = JSON.parse(fs.readFileSync(path.join(legacyDirectory, 'index.current.json'), 'utf8')); assert.equal(migratedManifest.version, DESKTOP_INDEX_FORMAT_VERSION); assert.ok(!fs.existsSync(generations), 'Legacy whole-index generations were not retired after an atomic segmented commit');

  const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'), runtimeSource = fs.readFileSync(new URL('../src/mobile-runtime.js', import.meta.url), 'utf8');
  assert.ok(mainSource.includes("path.join(plugin.cacheRoot, 'indexes', plugin.vaultCacheKey"), 'Desktop indexes can still be written inside the synced vault'); assert.ok(mainSource.includes('migrateDirectory(legacyVaultIndexDir(plugin), externalIndex, plugin)'), 'Existing vault-local desktop indexes are not migrated to local cache storage'); assert.ok(runtimeSource.includes('checkpointFiles: cores >= 12 ? 384 : 256') && runtimeSource.includes('checkpointMs: 120000'), 'Desktop resumable checkpoints are still too frequent'); assert.ok(runtimeSource.includes('filenameOnly: true, mtime: item.mtime') && runtimeSource.includes('packForSearch = false'), 'Filename-only metadata or checkpoint vector packing is not compact');
  console.log('Desktop index checks passed: local segmented persistence rewrites only dirty buckets, omits attachment vectors, recovers the previous snapshot, and migrates legacy generations.');
} finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
