import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ipcRenderer } from 'electron';
import { InNoteEngine } from '../src/in-note-engine.js';
import { MobileSearchRuntime } from '../src/mobile-runtime.js';
import { inNoteLiveCases } from './in-note-live-cases.mjs';
const report = value => ipcRenderer.send('report', value);
let engine, search;
(async () => {
  const { root, temporary } = JSON.parse(await fs.readFile(path.join(__dirname, 'config.json')));
  const output = path.join(root, 'build/in-note-runtime'), runtime = JSON.parse(await fs.readFile(path.join(output, 'runtime-manifest.json'))), loadedModels = new Set();
  engine = new InNoteEngine({ runtime, nativeSource: await fs.readFile(path.join(output, 'worker-native.cjs'), 'utf8'), readerAssets: JSON.parse(await fs.readFile(path.join(root, 'model-assets/in-note-reader/asset-manifest.json'))), nativeDirectory: path.join(temporary, 'runtime'), modelDirectory: path.join(temporary, 'models'), cores: 2,
    modelCache: { match() { throw new Error('Native cache must read model files inside the helper'); }, put() { throw new Error('Offline check attempted a model download'); } },
    requestAsset: async url => fs.readFile(path.join(output, new URL(url).pathname.split('/').at(-1))), activity: message => { report({ activity: message }); if (message.startsWith('Loading local ')) loadedModels.add(message); },
  });
  const createWorker = engine.nativeWorker.bind(engine);
  engine.nativeWorker = async () => { const child = await createWorker(); child?.stderr?.on('data', data => report({ helperError: String(data) })); return child; };
  const plugin = { isMobile: false, settings: {}, manifest: { id: 'gib-search' }, recordActivity() {}, logDiagnostic() {}, reportOnce() {}, app: { vault: { adapter: { getBasePath: () => 'electron-disposable-check' }, getName: () => 'electron-disposable-check' } }, desktopEmbedder: { embedInNote: texts => engine.embed(texts), readInNote: pairs => engine.request('read', { pairs }), inNotePairs: (pairs, kind) => engine.request(kind, { pairs }) } };
  search = new MobileSearchRuntime(plugin);
  const rows = []; let findings = 0;
  async function check(test, source = test.source) {
    const start = performance.now(), stages = [], result = await search.searchInNote(test.query, source, { diagnostics: test.diagnostics, onProgress: progress => stages.push({ stage: progress.stage, ms: performance.now() - start }) }), matches = result.matches || result, ms = performance.now() - start;
    for (const expected of test.expected || []) if (!test.optional?.some(pattern => pattern.source === expected.source)) assert.ok(matches.some(match => expected.test(match.sourcePhrase)), `${test.name} missed ${expected}`);
    for (const match of matches) {
      assert.equal(source.slice(match.from, match.to), match.sourcePhrase); assert.equal(source.slice(match.highlight.from, match.highlight.to), match.highlight.sourcePhrase);
      assert.ok(!test.forbidden?.some(pattern => pattern.test(match.sourcePhrase)), `${test.name} false match: ${match.sourcePhrase}`);
      if (test.exhaustive) assert.ok([...(test.expected || []), ...(test.ambiguous || [])].some(pattern => pattern.test(match.sourcePhrase)), `${test.name} unsupported match: ${match.sourcePhrase}`);
    }
    if (test.empty) assert.equal(matches.length, 0, test.name);
    findings += matches.length; const row = { name: test.name, query: test.query, characters: source.length, ms, ...(test.diagnostics ? { candidates: result.candidates.length } : {}), findings: matches.map(match => ({ sentence: match.sourcePhrase, phrase: match.highlight.phrase })), stages }; rows.push(row); report(row); return row;
  }
  const longNote = '# Workshop handbook\n\n' + Array.from({ length: 200 }, (_, i) => `## Record ${i + 1}\n\nThe team inspected the equipment and filed the records for project ${i + 1}. During project ${i + 1}, fresh filters and new batteries were checked against the maintenance log. The coordinator confirmed that the delivery schedule for project ${i + 1} matched the printed forms. No equipment faults were recorded in project ${i + 1}, and the next inspection was scheduled for the following month.`).join('\n\n') + '\n\n## Visitors\n\nMaya enjoyed the company of strangers and welcomed every new arrival.';
  const first = await check({ name: 'unprepared large note', query: 'liked people', expected: [/Maya enjoyed/u], exhaustive: true }, longNote);
  assert.equal(engine.backend, 'native-cpu'); assert.ok(engine.worker.pid, 'Electron silently fell back from the standalone helper');
  assert.ok(engine.worker.spawnfile.includes(`node-${runtime.nodeVersion}`));
  assert.ok(![...loadedModels].some(name => /meaning|relevance/u.test(name)), 'Factual first search eagerly loaded unused models');
  assert.ok(first.ms < 30000, 'Cached-model first search exceeded 30 s on the test host');
  await check({ name: 'new absent query', query: 'allergic to peanuts', empty: true, diagnostics: true }, longNote);
  const cached = await check({ name: 'result cache', query: 'liked people', expected: [/Maya enjoyed/u], exhaustive: true }, longNote); assert.ok(cached.ms < 250);
  // Realistic notes and short queries, expanded past the lazy retrieval boundary.
  const filler = '\n\n## Maintenance appendix\n\n' + Array.from({ length: 65 }, (_, i) => `Inspection ${i + 1} recorded the current shelf number and the printed serial code.`).join('\n\n');
  for (const test of inNoteLiveCases) await check(test, test.source + filler);
  // Adaptive expansion must keep all findings beyond the initial shortlist.
  const many = Array.from({ length: 80 }, (_, i) => `Visitor ${i + 1} enjoyed the company of strangers.`).join('\n\n');
  const occurrences = await check({ name: '80 independent occurrences', query: 'liked people' }, many); assert.equal(occurrences.findings.length, 80);
  let active = true, sawProgress = false;
  await assert.rejects(search.searchInNote('people enjoyed company', longNote, { isCurrent: () => active, onProgress() { sawProgress = true; active = false; } }), { name: 'AbortError' }); assert.ok(sawProgress);
  // Real Chromium structured cloning must preserve optional word attribution.
  const matcher = search.inNoteMatcher, allowed = new Set([...matcher.sources.values()].flatMap(note => note.representations));
  await matcher.cache.save(matcher.vectors, allowed); assert.ok((await matcher.cache.load()).some(([, vector]) => vector.focus?.words?.length));
  const fresh = rows.filter(row => row.name !== 'result cache').map(row => row.ms).sort((a, b) => a - b), p95 = fresh[Math.ceil(fresh.length * .95) - 1];
  assert.ok(p95 < 15000, 'Fresh-query p95 exceeded 15 s on the test host');
  const child = engine.worker; const exited = new Promise(resolve => child.once('exit', resolve)); engine.stop(); await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('CPU helper did not stop')), 5000))]);
  matcher.dispose(); await fs.writeFile(path.join(temporary, 'report.json'), JSON.stringify({ backend: 'native-cpu', electron: process.versions.electron, findings, p95, rows })); ipcRenderer.send('done', { ok: true });
})().catch(error => { search?.inNoteMatcher?.dispose(); engine?.stop(); ipcRenderer.send('done', { ok: false, error: error.stack }); });
