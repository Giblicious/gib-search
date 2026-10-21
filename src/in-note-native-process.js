// Use the plugin's verified helper runtime. Obsidian disables RunAsNode, so
// launching process.execPath would not provide a usable Node child process.
import { encodeInNoteIpc, decodeInNoteIpc } from './in-note-ipc.js';
export async function nativeProcess(node, directory, source, bindingPath, executable) {
  if (!executable) throw new Error('The native search helper runtime is missing');
  const digest = node.crypto.createHash('sha256').update(source).digest('hex'), filename = node.path.join(directory, `inference-${digest.slice(0, 16)}.cjs`);
  let valid = false;
  try { valid = node.crypto.createHash('sha256').update(await node.fs.readFile(filename)).digest('hex') === digest; } catch {}
  if (!valid) {
    const temporary = filename + `.${node.crypto.randomUUID()}.download`;
    try { await node.fs.writeFile(temporary, source, { flag: 'wx' }); await node.fs.rename(temporary, filename); }
    finally { await node.fs.unlink(temporary).catch(() => {}); }
  }
  const environment = { ...node.env, GIB_IN_NOTE_BINDING_PATH: bindingPath };
  delete environment.ELECTRON_RUN_AS_NODE; delete environment.NODE_OPTIONS;
  const child = node.fork(filename, [], { execPath: executable, execArgv: [], env: environment, serialization: 'json', silent: true, windowsHide: true, cwd: directory });
  const bridge = new (require('node:events').EventEmitter)();
  child.on('message', message => { try { bridge.emit('message', decodeInNoteIpc(message)); } catch (error) { bridge.emit('error', error); } });
  child.on('error', error => bridge.emit('error', error)); child.on('exit', code => bridge.emit('exit', code));
  // Drain stderr/stdout without putting note/query text in diagnostics.
  child.stdout?.resume(); child.stderr?.resume();
  bridge.postMessage = message => { if (!child.connected) throw new Error('Native search process disconnected'); child.send(encodeInNoteIpc(message), error => { if (error) bridge.emit('error', error); }); };
  bridge.terminate = () => { child.kill(); };
  bridge.pid = child.pid; bridge.spawnfile = child.spawnfile; bridge.stderr = child.stderr;
  return bridge;
}
