const VERSION = 'bge-small-mean-word-focus-1';
const entryBytes = entry => entry.text.length * 2 + entry.vector.byteLength + (entry.focus?.vectors?.byteLength || 0) + (entry.focus?.words?.length || 0) * 64;

export class InNoteVectorStore {
  constructor({ open, key, maxBytes = 16 * 1024 * 1024, maxEntries = 2048 }) { this.open = open; this.key = `${key}:in-note:${VERSION}`; this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.pending = Promise.resolve(); }
  async load() {
    const database = await this.open(), saved = await new Promise((resolve, reject) => { const request = database.transaction('indexes', 'readonly').objectStore('indexes').get(this.key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    if (saved?.version !== VERSION || !Array.isArray(saved.entries)) return [];
    const entries = []; let bytes = 0;
    for (const entry of saved.entries.slice(-this.maxEntries)) {
      if (typeof entry?.text !== 'string' || entry.text.length > 8192 || !(entry.vector instanceof Float32Array) || entry.vector.length !== 384 || !entry.vector.every(Number.isFinite)) continue;
      const focus = entry.focus;
      if (focus && (!(focus.vectors instanceof Int8Array) || focus.dimension !== 384 || !Array.isArray(focus.words) || focus.words.length > 512 || focus.vectors.length !== focus.words.length * 384 || focus.words.some(word => typeof word.text !== 'string' || !Number.isInteger(word.from) || !Number.isInteger(word.to) || word.from < 0 || word.to <= word.from || word.to > entry.text.length))) continue;
      bytes += entryBytes(entry); if (bytes > this.maxBytes) break;
      entry.vector.focus = focus || null; entries.push([entry.text, entry.vector]);
    }
    return entries;
  }
  save(vectors, allowed) {
    const entries = []; let bytes = 0;
    for (const [text, value] of [...vectors].reverse()) {
      if (!allowed.has(text)) continue;
      const entry = { text, vector: value, focus: value.focus || null }, size = entryBytes(entry);
      if (bytes + size > this.maxBytes || entries.length >= this.maxEntries) break;
      // Typed-array custom properties are not part of the IndexedDB clone.
      entries.push({ ...entry, vector: new Float32Array(value) }); bytes += size;
    }
    entries.reverse();
    const write = async () => { const database = await this.open(); await new Promise((resolve, reject) => { const transaction = database.transaction('indexes', 'readwrite'); transaction.objectStore('indexes').put({ version: VERSION, entries, bytes }, this.key); transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Could not save in-note cache')); }); };
    this.pending = this.pending.catch(() => {}).then(write); return this.pending;
  }
}
