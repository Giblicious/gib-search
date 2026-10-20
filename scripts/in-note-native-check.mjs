import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const modelRoot = argument('model-root') || path.join(root, 'node_modules/@huggingface/transformers/.cache');
const output = path.join(root, 'build/in-note-runtime');
await build({ entryPoints: [path.join(root, 'src/in-note-engine.js')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(output, 'client-check.cjs') });
const { InNoteEngine } = createRequire(import.meta.url)(path.join(output, 'client-check.cjs'));
const runtime = JSON.parse(await fs.readFile(path.join(output, 'runtime-manifest.json')));
const temporary = await fs.mkdtemp(path.join(output, 'native-check-'));
const previousDirectory = process.cwd();
process.chdir(temporary);
let downloads = 0;
const modelCache = {
  async match(key) {
    if (!String(key).startsWith('https://')) return undefined;
    const url = new URL(key); let candidates;
    if (url.hostname === 'raw.githubusercontent.com') candidates = [path.join(root, 'model-assets/in-note-reader', url.pathname.split('/model-assets/in-note-reader/')[1] || 'missing')];
    else if (url.hostname === 'huggingface.co') {
      const [owner, model, , revision, ...parts] = url.pathname.slice(1).split('/');
      candidates = [path.join(modelRoot, owner, model, revision, ...parts), path.join(modelRoot, owner, model, ...parts)];
    } else throw new Error('Unexpected model host');
    for (const filename of candidates) { try { return new Response(await fs.readFile(filename)); } catch {} }
  },
  async put() { throw new Error('Native smoke expected prepared, offline model assets'); },
};
const engine = new InNoteEngine({ nativeSource: await fs.readFile(path.join(output, 'worker-native.cjs'), 'utf8'), runtime, readerAssets: JSON.parse(await fs.readFile(path.join(root, 'model-assets/in-note-reader/asset-manifest.json'))), modelCache, nativeDirectory: temporary, cores: 2, requestAsset: async url => { downloads++; return fs.readFile(path.join(output, new URL(url).pathname.split('/').at(-1))); } });
try {
  await engine.request('warm'); assert.equal(engine.backend, 'native-cpu');
  assert.equal(downloads, runtime.runtimes[`${process.platform}-${process.arch}`].length);
  const vectors = await engine.embed(['liked people', 'Maya enjoyed the company of strangers.']);
  assert.ok(vectors.every(vector => vector.length === 384 && vector.every(Number.isFinite) && vector.focus?.words?.length));
  const [singleVector] = await engine.embed(['liked people']);
  assert.ok(singleVector.every((value, index) => Math.abs(value - vectors[0][index]) < .00001), 'Preparation batch changed a query embedding');
  assert.deepEqual(singleVector.focus.vectors, vectors[0].focus.vectors, 'Preparation batch changed word attribution');
  const query = 'liked people', targets = ['Maya enjoyed the company of strangers.', 'I think it was in 2014.'];
  const pairs = targets.map(passage => ({ query, passage, targetFrom: 0, targetTo: passage.length }));
  const scores = await engine.request('read', { pairs });
  assert.ok(scores[0].probability > .95 && scores[1].probability < .05);
  for (let index = 0; index < pairs.length; index++) {
    const [single] = await engine.request('read', { pairs: [pairs[index]] });
    assert.ok(Math.abs(single.probability - scores[index].probability) < .001, 'Unrelated batch members changed a sentence decision');
  }
  const passage = 'A sentence without its final qualification. '.repeat(200);
  const [oversized] = await engine.request('read', { pairs: [{ query, passage, targetFrom: 0, targetTo: passage.length }] });
  assert.equal(oversized.complete, false); assert.equal(oversized.probability, 0);
  console.log('Native in-note worker passed: locked binary hashes, offline model bridge, embeddings, factual discrimination, batch stability and complete-sentence limits.');
} finally {
  engine.stop();
  process.chdir(previousDirectory);
  if (!temporary.startsWith(path.resolve(root, 'build') + path.sep)) throw new Error('Invalid disposable native test directory');
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
