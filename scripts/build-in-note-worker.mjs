import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildInNoteWorkers() {
  const entry = path.join(root, 'src/in-note-inference-worker.js');
  const browser = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2020', conditions: ['browser', 'module', 'import'], define: { __GIB_NATIVE_IN_NOTE__: 'false', global: 'globalThis', 'process.env.NODE_ENV': '"production"', 'process.release.name': '"browser"' }, logLevel: 'silent', legalComments: 'none' });
  const native = await build({
    entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs', target: 'node18',
    define: { __GIB_NATIVE_IN_NOTE__: 'true', 'import.meta.url': '__gibWorkerUrl' },
    banner: { js: 'const __gibWorkerUrl=require("node:url").pathToFileURL(require("node:path").resolve(__filename)).href; const {parentPort}=require("node:worker_threads"); const self={postMessage:(message,transfers)=>parentPort.postMessage(message,transfers||[]),onmessage:null}; parentPort.on("message",data=>self.onmessage?.({data})); globalThis.crypto ||= require("node:crypto").webcrypto;' },
    plugins: [{ name: 'self-contained-text-runtime', setup(builder) {
      // Text-only pipelines never process images. Sharp would otherwise look
      // for machine-installed native image packages after a BRAT installation.
      builder.onResolve({ filter: /^sharp$/ }, () => ({ path: 'text-only-images', namespace: 'gib-in-note' }));
      builder.onLoad({ filter: /.*/, namespace: 'gib-in-note' }, () => ({ contents: 'export default function unavailableImageInput(){throw new Error("In-note search accepts text only");}', loader: 'js' }));
      builder.onLoad({ filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ }, args => {
        const source = fs.readFileSync(args.path, 'utf8'), marker = 'require(`../bin/napi-v3/${process.platform}/${process.arch}/onnxruntime_binding.node`)';
        if (!source.includes(marker)) throw new Error('Native binding loader changed; review packaging');
        return { contents: source.replace(marker, 'require(require("node:worker_threads").workerData.bindingPath)'), loader: 'js', resolveDir: path.dirname(args.path) };
      });
    } }], logLevel: 'silent', legalComments: 'none',
  });
  for (const output of Object.values(native.metafile.outputs)) for (const dependency of output.imports) if (dependency.external && !builtinModules.includes(dependency.path.replace(/^node:/u, ''))) throw new Error(`Unbundled native runtime dependency: ${dependency.path}`);
  const output = path.join(root, 'build/in-note-runtime'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'worker-native.cjs'), native.outputFiles[0].text); fs.writeFileSync(path.join(output, 'worker-browser.js'), browser.outputFiles[0].text);
  const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/onnxruntime-node/package.json'), 'utf8')), release = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version, runtimes = {};
  const base = path.join(root, 'node_modules/onnxruntime-node/bin/napi-v3');
  for (const platform of fs.readdirSync(base).sort()) for (const architecture of fs.readdirSync(path.join(base, platform)).sort()) {
    const directory = path.join(base, platform, architecture), files = [];
    for (const name of fs.readdirSync(directory).sort()) {
      if (!/\.(?:node|dll|dylib)$|\.so(?:\.[\d.]+)?$/u.test(name) || /providers_(?:cuda|tensorrt)/u.test(name)) continue;
      const data = fs.readFileSync(path.join(directory, name)), asset = `ort-${packageInfo.version}-${platform}-${architecture}-${name}`;
      fs.writeFileSync(path.join(output, asset), data); files.push({ name, asset, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
    }
    if (files.some(file => file.name === 'onnxruntime_binding.node')) runtimes[`${platform}-${architecture}`] = files;
  }
  const metadata = { version: packageInfo.version, release, runtimes };
  fs.writeFileSync(path.join(output, 'runtime-manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
  return { browser: browser.outputFiles[0].text, native: native.outputFiles[0].text, metadata };
}
if (process.argv.includes('--standalone')) { const result = await buildInNoteWorkers(); console.log(`Built local in-note workers and ${Object.keys(result.metadata.runtimes).length} runtime packages.`); }
