// In-note inference has its own workers and does not change vault inference.
export class InNoteEngine {
  constructor({ browserSource, nativeSource, runtime, readerAssets, wasmGzip, wasmModuleGzip, modelCache, nativeDirectory, requestAsset, mobile = false, cores = 2, activity = () => {} }) {
    Object.assign(this, { browserSource, nativeSource, runtime, readerAssets, wasmGzip, wasmModuleGzip, modelCache, nativeDirectory, requestAsset, mobile, cores, activity });
    this.pending = new Map(); this.nextId = 0; this.worker = null; this.backend = ''; this.stopped = false;
  }
  async nativeWorker() {
    if (this.mobile || this.nativeFailed || !this.nativeDirectory) return null;
    let node;
    try { node = { Worker: require('node:worker_threads').Worker, fs: require('node:fs').promises, path: require('node:path'), crypto: require('node:crypto'), platform: process.platform, arch: process.arch }; } catch { return null; }
    const key = `${node.platform}-${node.arch}`, files = this.runtime.runtimes[key]; if (!files) return null;
    const parent = node.path.resolve(this.nativeDirectory), directory = node.path.resolve(parent, this.runtime.version, key);
    if (!directory.startsWith(parent + node.path.sep)) throw new Error('Invalid local inference directory');
    await node.fs.mkdir(directory, { recursive: true });
    for (const file of files) {
      if (!/^[\w.-]+$/u.test(file.name) || !/^[\w.-]+$/u.test(file.asset)) throw new Error('Invalid local inference asset name');
      const destination = node.path.join(directory, file.name), valid = data => data.byteLength === file.bytes && node.crypto.createHash('sha256').update(data).digest('hex') === file.sha256;
      try { if (valid(await node.fs.readFile(destination))) continue; } catch {}
      this.activity('Preparing local search engine');
      const data = new Uint8Array(await this.requestAsset(`https://github.com/Giblicious/gib-search/releases/download/${this.runtime.release}/${file.asset}`));
      if (!valid(data)) throw new Error('Local inference asset failed integrity verification');
      const temporary = destination + `.download-${node.crypto.randomUUID()}`;
      try { await node.fs.writeFile(temporary, data, { flag: 'wx' }); await node.fs.rename(temporary, destination); }
      finally { await node.fs.unlink(temporary).catch(() => {}); }
    }
    const worker = new node.Worker(this.nativeSource, { eval: true, workerData: { bindingPath: node.path.join(directory, 'onnxruntime_binding.node') } });
    this.backend = 'native-cpu'; return worker;
  }
  async start() {
    if (this.stopped) throw new Error('In-note inference stopped');
    if (this.worker) return;
    if (this.starting) return this.starting;
    const run = (async () => {
      let worker;
      try { worker = await this.nativeWorker(); } catch (error) { this.nativeFailed = true; this.activity(`Native search unavailable; using browser inference (${error.message})`); }
      if (this.stopped) { worker?.terminate(); throw new Error('In-note inference stopped'); }
      if (worker) {
        this.worker = worker;
        worker.on('message', message => { if (this.worker === worker) this.receive(message); }); worker.on('error', error => { if (this.worker === worker) this.fail(error); });
        worker.on('exit', code => { if (this.worker === worker && !this.stopped) this.fail(new Error(`Local inference worker exited (${code})`)); });
      } else {
        this.backend = 'wasm';
        this.workerUrl = URL.createObjectURL(new Blob([this.browserSource], { type: 'text/javascript' }));
        worker = new Worker(this.workerUrl, { name: 'gib-search-in-note' }); this.worker = worker;
        worker.onmessage = event => { if (this.worker === worker) this.receive(event.data); }; worker.onerror = event => { if (this.worker === worker) this.fail(new Error(event.message || 'In-note worker failed')); };
      }
      await this.send('init', { mobile: this.mobile, cores: this.cores, readerAssets: this.readerAssets, wasmGzip: this.wasmGzip, wasmModuleGzip: this.wasmModuleGzip });
      this.activity('Local search engine ready');
    })();
    this.starting = run;
    try { return await run; } finally { if (this.starting === run) this.starting = null; }
  }
  async receive(message) {
    for (const pending of this.pending.values()) pending.lastActivity = Date.now();
    if (message.type === 'progress') { this.activity(`Preparing local search model: ${Math.round(message.progress)}%`); return; }
    if (message.type === 'cache') {
      const worker = this.worker;
      try {
        if (message.action === 'match') { const response = await this.modelCache.match(message.key), buffer = response ? await response.arrayBuffer() : null; worker?.postMessage({ type: 'cache-result', id: message.id, ...(buffer ? { buffer } : {}) }, buffer ? [buffer] : []); }
        else if (message.action === 'put') { await this.modelCache.put(message.key, new Response(message.buffer)); worker?.postMessage({ type: 'cache-result', id: message.id }); }
      } catch (error) { worker?.postMessage({ type: 'cache-result', id: message.id, error: error.message }); }
      return;
    }
    const pending = this.pending.get(message.id); if (!pending) return;
    this.pending.delete(message.id); clearTimeout(pending.timer);
    message.type === 'error' ? pending.reject(new Error(message.message)) : pending.resolve(message.value);
  }
  send(type, payload = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, lastActivity: Date.now(), timer: null };
      const check = () => { if (this.pending.get(id) !== pending) return; const remaining = 180000 - (Date.now() - pending.lastActivity); if (remaining > 0) pending.timer = setTimeout(check, remaining); else this.fail(new Error('Local in-note inference timed out')); };
      pending.timer = setTimeout(check, 180000); this.pending.set(id, pending);
      try { this.worker.postMessage({ type, id, ...payload }); } catch (error) { clearTimeout(pending.timer); this.pending.delete(id); reject(error); }
    });
  }
  async request(type, payload = {}) {
    try { await this.start(); return await this.send(type, payload); }
    catch (error) {
      if (!this.stopped && this.backend === 'native-cpu' && !this.nativeFailed) { this.nativeFailed = true; this.activity(`Native search unavailable; using browser inference (${error.message})`); this.fail(error); await this.start(); return this.send(type, payload); }
      throw error;
    }
  }
  async embed(texts) { const result = await this.request('embed', { texts }); return result.buffers.map((buffer, index) => { const vector = new Float32Array(buffer); vector.focus = result.focus[index]; return vector; }); }
  fail(error) {
    const worker = this.worker; this.worker = null; worker?.terminate();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl); this.workerUrl = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear();
  }
  stop() { this.stopped = true; this.fail(new Error('In-note inference stopped')); }
}
