// V8's "advanced" child-process serialization is not portable between the
// Node version embedded in Electron and our pinned helper. JSON + explicit
// binary envelopes preserves typed vectors without depending on a V8 version.
export function encodeInNoteIpc(value) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const kind = value instanceof ArrayBuffer ? 'buffer' : value instanceof Int8Array ? 'int8' : value instanceof Float32Array ? 'float32' : 'uint8';
    return { __gibBinary: kind, data: globalThis.Buffer.from(bytes).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(encodeInNoteIpc);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeInNoteIpc(item)]));
  return value;
}
export function decodeInNoteIpc(value) {
  if (value && typeof value === 'object' && typeof value.__gibBinary === 'string' && typeof value.data === 'string' && Object.keys(value).length === 2) {
    const bytes = Uint8Array.from(globalThis.Buffer.from(value.data, 'base64'));
    if (value.__gibBinary === 'buffer') return bytes.buffer;
    if (value.__gibBinary === 'int8') return new Int8Array(bytes.buffer);
    if (value.__gibBinary === 'float32') return new Float32Array(bytes.buffer);
    if (value.__gibBinary === 'uint8') return bytes;
    throw new Error('Invalid local inference binary type');
  }
  if (Array.isArray(value)) return value.map(decodeInNoteIpc);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeInNoteIpc(item)]));
  return value;
}
