// Exercise the actual desktop host: renderer -> packaged Node IPC -> CPU ONNX,
// with IndexedDB and no note/model preparation before the first query.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const modelRoot = argument('model-root') || path.join(root, 'node_modules/@huggingface/transformers/.cache');
const temporary = await fs.mkdtemp(path.join(root, 'build/electron-check-'));
const models = [
  ['bge-small-en-v1.5', 'ea104dacec62c0de699686887e3f920caeb4f3e3', 'model.onnx'],
  ['mobilebert-uncased-mnli', '8b0ea66ab7b190bba77418ba03b67d69cfc9a1ee', 'model_quantized.onnx'],
  ['ms-marco-MiniLM-L-6-v2', 'a09144355adeed5f58c8ed011d209bf8ee5a1fec', 'model_quantized.onnx'],
  ['nli-deberta-v3-xsmall', '2a4f614a701367a02d51389039afc998faeda637', 'model_quantized.onnx'],
];
async function link(from, to) { await fs.mkdir(path.dirname(to), { recursive: true }); try { await fs.link(from, to); } catch { await fs.copyFile(from, to); } }
try {
  for (const [name, revision, onnx] of models) {
    let base = path.join(modelRoot, 'Xenova', name);
    try { await fs.access(path.join(base, revision, 'config.json')); base = path.join(base, revision); } catch {}
    const files = (await fs.readdir(base, { withFileTypes: true })).filter(entry => entry.isFile() && /\.(json|txt)$/u.test(entry.name)).map(entry => entry.name);
    files.push('onnx/' + onnx);
    for (const file of files) await link(path.join(base, file), path.join(temporary, 'models/Xenova', name, 'resolve', revision, file));
  }
  // Preserve the reader's independent weight revision when the plugin bumps.
  for (const file of Object.keys(JSON.parse(await fs.readFile(path.join(root, 'model-assets/in-note-reader/asset-manifest.json'))))) await link(path.join(root, 'model-assets/in-note-reader', file), path.join(temporary, 'models/Giblicious/gib-search/0.54.67/model-assets/in-note-reader', file));
  await fs.writeFile(path.join(temporary, 'config.json'), JSON.stringify({ root, temporary }));
  await build({ entryPoints: [path.join(root, 'scripts/in-note-electron-renderer.js')], bundle: true, platform: 'browser', format: 'cjs', outfile: path.join(temporary, 'renderer.cjs'), conditions: ['browser', 'module', 'import'], external: ['node:*', 'electron'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' } });
  await fs.writeFile(path.join(temporary, 'index.html'), '<!doctype html><meta charset="utf-8"><script>require("./renderer.cjs")</script>');
  await fs.copyFile(path.join(root, 'scripts/in-note-electron-host.cjs'), path.join(temporary, 'host.cjs'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  process.env.electron_config_cache = path.join(root, 'build/electron-downloads');
  const executable = createRequire(import.meta.url)('electron');
  const code = await new Promise((resolve, reject) => { const child = spawn(executable, ['--no-sandbox', path.join(temporary, 'host.cjs')], { env, stdio: 'inherit', windowsHide: true }); child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0, 'Electron first-search check failed');
  const report = JSON.parse(await fs.readFile(path.join(temporary, 'report.json')));
  if (argument('report')) await fs.writeFile(path.resolve(argument('report')), JSON.stringify(report, null, 2) + '\n');
  console.log(`Electron desktop check passed: ${report.rows.length} queries, ${report.findings} checked findings, cold cached-model query ${Math.round(report.rows[0].ms)} ms, fresh-query p95 ${Math.round(report.p95)} ms.`);
} finally {
  if (!temporary.startsWith(path.resolve(root, 'build') + path.sep)) throw new Error('Invalid disposable Electron test directory');
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
