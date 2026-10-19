import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { indexedDB } from 'fake-indexeddb';
import { MobileSearchRuntime } from '../src/mobile-runtime.js';
import { DesktopIndexStore, desktopIndexBucket } from '../src/desktop-index-store.js';
import { normalizeIndexScope, indexScopeIncludes, indexScopePreview } from '../src/index-scope.js';
import { resolveQuickFilterPaths } from '../src/quick-filters.js';

const vector = (a = 1, b = 0) => { const result = new Float32Array(384); result[0] = a; result[1] = b; return result; };
const note = (name, mtime = 1) => ({ path: name, extension: name.split('.').pop(), stat: { mtime, ctime: 1, size: 30 } });
const metadata = (file, text, mtime = 1) => ({ file, text, mtime, heading: '', lineStart: 0, lineEnd: 0, contentHash: `hash:${text}`, passageVersion: 3, highlightVersion: 1, highlightCandidates: [], graphVersion: 1, entities: [] });
let sequence = 0;
function fixture(values = [], mobile = false) {
  const files = new Map(values.map(file => [file.path, file])), bodies = new Map(values.map(file => [file.path, `Content of ${file.path}`])), reads = [];
  const plugin = { isMobile: mobile, atlasEnabled: false, settings: {}, manifest: { id: 'gib-search' }, recordActivity() {}, logDiagnostic() {}, reportOnce() {}, app: { vault: { adapter: { getBasePath: () => `hardening-${++sequence}` }, configDir: '.obsidian', getName: () => 'hardening', getFiles: () => [...files.values()], getAbstractFileByPath: name => files.get(name), read: async file => { reads.push(file.path); return bodies.get(file.path) || ''; } }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) }, workspace: { getActiveFile: () => null } } };
  const runtime = new MobileSearchRuntime(plugin); runtime.enabled = true; runtime.lastSuccessfulIndexAt = 1; runtime.indexingTurn = async () => {}; runtime.embedIndexChunks = async texts => texts.map(() => vector()); runtime.queueIndexSave = () => {}; runtime.saveIndex = async () => {}; runtime.flushIndexSave = async () => {}; runtime.scheduleWritingProfileSync = () => {};
  return { runtime, plugin, files, bodies, reads, close() { runtime.enabled = false; clearTimeout(runtime.updateTimer); } };
}

// A concurrent edit cannot stamp old content with the new TFile timestamp.
{
  const file = note('Race.md'), value = fixture([file]); value.bodies.set(file.path, 'Original apple content.');
  let changed = false; value.runtime.embedIndexChunks = async texts => { if (!changed) { changed = true; value.bodies.set(file.path, 'Edited banana content.'); file.stat.mtime = 2; } return texts.map(() => vector()); };
  await value.runtime.performDirtyIndexUpdate(false, new Set([file.path]));
  assert.ok(!value.runtime.meta.some(item => item.mtime === 2 && item.text.includes('Original')));
  await value.runtime.performDirtyIndexUpdate(false, new Set([file.path]));
  assert.equal(value.reads.length, 2); assert.ok(value.runtime.meta[0].text.includes('banana')); assert.equal(value.runtime.meta[0].mtime, 2); value.close();
}

// Check again after staging: a checkpoint may be minutes after the file read.
{
  const file = note('Staged.md'), value = fixture([file]), prepared = await value.runtime.materializeIndexEntry({ file });
  const replacements = await value.runtime.materializedIndexReplacements([prepared]); file.stat.mtime++;
  value.runtime.replaceIndexedFiles(replacements); assert.equal(value.runtime.meta.length, 0); assert.ok(value.runtime.dirtyPaths.has(file.path)); value.close();
}

// Rename/delete during inference and changes during reads keep the old version honest.
for (const action of ['rename', 'delete', 'read']) {
  const file = note('Before.md'), value = fixture([file]);
  if (action === 'read') value.plugin.app.vault.read = async () => { file.stat.mtime++; return 'obsolete'; };
  else value.runtime.embedIndexChunks = async texts => { value.files.delete('Before.md'); if (action === 'rename') { file.path = 'After.md'; value.files.set(file.path, file); } return texts.map(() => vector()); };
  await value.runtime.performDirtyIndexUpdate(false, new Set(['Before.md']));
  assert.equal(value.runtime.meta.length, 0, `${action} committed obsolete metadata`); assert.ok(value.runtime.dirtyPaths.has('Before.md')); if (action === 'rename') assert.ok(value.runtime.dirtyPaths.has('After.md')); value.close();
}

// Bootstrap embeddings and imports use the same captured file version.
{
  const file = note('Bootstrap.md'), value = fixture([file]), prepared = await value.runtime.materializeMobileBootstrapFile(file);
  file.stat.mtime++; assert.throws(() => value.runtime.bootstrapReplacement(prepared, prepared.chunks.map(() => vector())), /File changed while indexing/); value.close();
}

// File events detect same-timestamp, same-size edits too.
{
  const file = note('Timestamp.md'), value = fixture([file]), callbacks = new Map(); value.plugin.registerEvent = () => {}; value.plugin.app.vault.on = (name, callback) => { callbacks.set(name, callback); return {}; }; value.runtime.watch();
  await value.runtime.performDirtyIndexUpdate(false, new Set([file.path])); value.bodies.set(file.path, 'A same-timestamp edit.'); callbacks.get('modify')(file);
  await value.runtime.performDirtyIndexUpdate(false, new Set([file.path])); assert.ok(value.runtime.meta[0].text.includes('same-timestamp')); value.close();
}

// A recovered desktop snapshot remains the base after an unrelated write and restart.
{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-search-hardening-'));
  try {
    const store = new DesktopIndexStore(directory, { fs, path, crypto }), a = 'Alpha.md'; let b = 'Beta.md'; while (desktopIndexBucket(a) === desktopIndexBucket(b)) b = `x-${b}`;
    await store.put({ meta: [metadata(a, 'old'), metadata(b, 'beta')], vectorList: [vector(), vector(0, 1)] }, { force: true });
    const second = await store.put({ meta: [metadata(a, 'new', 2), metadata(b, 'beta')], vectorList: [vector(), vector(0, 1)] }, { dirtyFiles: [a] }), descriptor = second.current.buckets[desktopIndexBucket(a)], target = path.join(directory, 'segments', `${descriptor.id}.vectors.bin`), damaged = fs.readFileSync(target); damaged[0] ^= 1; fs.writeFileSync(target, damaged);
    const recovered = await store.get(); assert.equal(recovered.meta.find(item => item.file === a).text, 'old');
    const packed = new Float32Array(recovered.vectors); await store.put({ meta: recovered.meta.map(item => item.file === b ? { ...item, text: 'updated beta' } : item), vectorList: recovered.meta.map((_, index) => packed.subarray(index * 384, (index + 1) * 384)) }, { dirtyFiles: [b] });
    const restarted = await new DesktopIndexStore(directory, { fs, path, crypto }).get(); assert.equal(restarted.meta.find(item => item.file === a).text, 'old'); assert.equal(restarted.meta.find(item => item.file === b).text, 'updated beta');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

// Exercise real IndexedDB transactions, including save after fallback on mobile.
{
  const prior = globalThis.indexedDB; globalThis.indexedDB = indexedDB; const value = fixture([], true), runtime = value.runtime;
  const get = async key => { const database = await runtime.openDatabase(); return new Promise((resolve, reject) => { const request = database.transaction('indexes').objectStore('indexes').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); };
  const put = async (key, data) => { const database = await runtime.openDatabase(); return new Promise((resolve, reject) => { const transaction = database.transaction('indexes', 'readwrite'); transaction.objectStore('indexes').put(data, key); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); };
  try {
    await runtime.databasePut({ meta: [metadata('A.md', 'old'), metadata('B.md', 'beta')], vectorList: [vector(), vector(0, 1)] }, { force: true });
    runtime.markIndexFilesDirty(['A.md']); await runtime.databasePut({ meta: [metadata('A.md', 'new', 2), metadata('B.md', 'beta')], vectorList: [vector(), vector(0, 1)] });
    const manifest = await get(`${runtime.indexKey}:manifest`), currentOnly = Object.values(manifest.current.buckets).find(id => !Object.values(manifest.previous.buckets).includes(id)); await put(`${runtime.indexKey}:segment:${currentOnly}`, { meta: [], vectors: new ArrayBuffer(1) });
    const recovered = await runtime.databaseGet(); assert.equal(recovered.meta.find(item => item.file === 'A.md').text, 'old');
    const packed = new Float32Array(recovered.vectors); runtime.indexDirtyBuckets.clear(); runtime.markIndexFilesDirty(['B.md']); await runtime.databasePut({ meta: recovered.meta.map(item => item.file === 'B.md' ? { ...item, text: 'updated beta' } : item), vectorList: recovered.meta.map((_, index) => packed.subarray(index * 384, (index + 1) * 384)) });
    runtime.mobileVerifiedSequence = null; const restarted = await runtime.databaseGet(); assert.equal(restarted.meta.find(item => item.file === 'A.md').text, 'old'); assert.equal(restarted.meta.find(item => item.file === 'B.md').text, 'updated beta');
  } finally { runtime.database?.close(); globalThis.indexedDB = prior; value.close(); }
}

// Queries retain a consistent snapshot across an indexing commit and never poison its cache.
{
  const value = fixture(), runtime = value.runtime; runtime.isMobile = true;
  runtime.meta = Array.from({ length: 400 }, (_, index) => metadata(`Original-${index}.md`, 'astronomy')); runtime.vectors = runtime.meta.map(() => vector()); runtime.refreshLexical(); runtime.embed = async () => vector();
  const previousRaf = globalThis.requestAnimationFrame, previousDocument = globalThis.document; globalThis.document = { hidden: false }; let changed = false;
  globalThis.requestAnimationFrame = callback => { if (!changed) { changed = true; runtime.commitIndex([metadata('New-only.md', 'unrelated')], [vector(0, 1)], new Set(runtime.meta.map(item => item.file))); } callback(); };
  try { const results = await runtime.search('astronomy', 40, .5); assert.equal(results.length, 40); assert.ok(results.every(item => item.file.startsWith('Original-'))); assert.deepEqual(await runtime.search('astronomy', 40, .5), []); }
  finally { globalThis.requestAnimationFrame = previousRaf; globalThis.document = previousDocument; value.close(); }
}

// Long notes cannot consume the entire distinct-file result budget.
{
  const value = fixture(), runtime = value.runtime; runtime.meta = Array.from({ length: 1200 }, (_, index) => ({ ...metadata('Long essay.md', `Astronomy ${index}`), lineStart: index, lineEnd: index })); runtime.vectors = runtime.meta.map(() => vector(.9, Math.sqrt(1 - .9 ** 2)));
  for (let index = 0; index < 12; index++) { runtime.meta.push(metadata(`Other-${index}.md`, 'Astronomy reference')); runtime.vectors.push(vector(.8, .6)); } runtime.refreshLexical(); runtime.embed = async () => vector();
  const passages = await runtime.search('astronomy', 40, .5), files = await runtime.search('astronomy', 10, .5, { distinctFiles: true }); assert.equal(new Set(passages.map(item => item.file)).size, 1); assert.equal(new Set(files.map(item => item.file)).size, 10); assert.equal(files.filter(item => item.file === 'Long essay.md').length, 3); value.close();
}

// Semantic results remain withheld until inference completes; no exact-first swap.
{
  const value = fixture(), runtime = value.runtime; runtime.meta = [metadata('Known.md', 'known words')]; runtime.vectors = [vector()]; runtime.refreshLexical(); let finish, displayed = false;
  runtime.queryVector = () => new Promise(resolve => { finish = resolve; }); const pending = runtime.search('known', 10, .5).then(results => { displayed = true; return results; });
  await Promise.resolve(); assert.equal(displayed, false); finish(vector()); assert.equal((await pending)[0].file, 'Known.md'); value.close();
}

// Incremental commits reuse all unchanged passage text and preserve spelling/BM25 deletion.
let commitMs;
{
  const value = fixture(), runtime = value.runtime; let unchangedReads = 0;
  runtime.meta = Array.from({ length: 25000 }, (_, index) => ({ ...metadata(`Notes/${Math.floor(index / 4)}.md`, ''), get text() { unchangedReads++; return (`Passage ${index} records project decisions and observations. `).repeat(28); } })); runtime.vectors = runtime.meta.map(() => vector()); runtime.refreshLexical(); unchangedReads = 0;
  const started = performance.now(); runtime.replaceIndexedFiles(new Map([['Notes/0.md', { meta: [metadata('Notes/0.md', 'new unique quantum phrase')], vectors: [vector()] }]])); commitMs = performance.now() - started;
  assert.equal(unchangedReads, 0, 'One-file commit reread unchanged passage text'); assert.ok(commitMs < 200, `Complete incremental commit took ${commitMs.toFixed(1)} ms`); assert.equal(runtime.bm25.search('quantum', 10)[0].payload.file, 'Notes/0.md');
  runtime.replaceIndexedFiles(new Map([['Notes/0.md', { meta: [metadata('Notes/0.md', 'updated without the special word')], vectors: [vector()] }]])); assert.equal(runtime.bm25.search('quantum', 10).length, 0); value.close();
}

// Relative-date scope membership and its result-cache identity expire without vault events.
{
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'), start = source.indexOf('  async quickFilterPaths('), end = source.indexOf('\n  async revisionCatalog(', start), method = source.slice(start, end).trim().replace('async quickFilterPaths(', 'async function quickFilterPaths('), resolve = vm.runInNewContext(`(${method})`, { resolveQuickFilterPaths, Set, JSON, Date, window: { setTimeout } }), now = Date.now(), file = note('Recent.md', now), filter = { id: 'recent', name: 'Recent', enabled: true, modifiedWithinDays: 1 }, host = { quickFilterScopeGeneration: 0, quickFilterScopeCache: new Map(), settings: { quickFilters: [filter] }, app: { vault: { getFiles: () => [file] }, metadataCache: { getFileCache: () => ({}) } } }, first = await resolve.call(host, new Set(['recent']), 'search'), originalNow = Date.now;
  try { Date.now = () => now + 86400001; const expired = await resolve.call(host, new Set(['recent']), 'search'); assert.equal(expired.size, 0); assert.notEqual(first.scopeKey, expired.scopeKey); } finally { Date.now = originalNow; }
}

// Default scope is unchanged; applying exclusions prunes generated data without reading it.
{
  const included = note('Writings/Keep.md'), excluded = note('Archive/Skip.md'), attachment = note('Writings/scan.pdf'), sibling = note('Writings-old/Unrelated.md'), value = fixture([included, excluded, attachment, sibling]);
  assert.equal(value.runtime.files().length, 4); const scope = normalizeIndexScope({ indexIncludedFolders: ['Writings'], indexExcludedFolders: 'Archive', indexExcludedExtensions: '.pdf' }); assert.ok(indexScopeIncludes(included, scope)); assert.ok(!indexScopeIncludes(sibling, scope));
  value.runtime.meta = [metadata(excluded.path, 'old')]; value.runtime.vectors = [vector()]; const preview = indexScopePreview([...value.files.values()], value.runtime.meta, scope); assert.deepEqual(preview, { included: 1, excluded: 3, removed: 1, added: 1 }); Object.assign(value.plugin.settings, scope);
  await value.runtime.performDirtyIndexUpdate(); assert.deepEqual(value.reads, [included.path]); assert.deepEqual(value.runtime.meta.map(item => item.file), [included.path]); value.close();
}

console.log(`Audit hardening checks passed: edit/rename/delete races, desktop and mobile rollback writes, consistent searches, file diversity, stable publication, scope expiry/exclusions; complete 25,000-passage incremental commit ${commitMs.toFixed(1)} ms.`);
