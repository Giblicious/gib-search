const FORMAT = 'gib-search-desktop-index';
const FORMAT_VERSION = 4;
const DIMENSION = 384;
const BUCKETS = 1024;

function indexBucket(file, count = BUCKETS) {
  let hash = 2166136261;
  for (const character of String(file || '')) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % count;
}

function sliceBuffer(bytes) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }

class DesktopIndexStore {
  constructor(directory, dependencies) { this.directory = directory; this.fs = dependencies.fs; this.path = dependencies.path; this.crypto = dependencies.crypto; }
  segmentDirectory() { return this.path.join(this.directory, 'segments'); }
  generationDirectory() { return this.path.join(this.directory, 'generations'); }
  checksum(value) { return this.crypto.createHash('sha256').update(value).digest('hex'); }
  async readJson(target) { return JSON.parse(await this.fs.promises.readFile(target, 'utf8')); }
  async manifest() { try { return await this.readJson(this.path.join(this.directory, 'index.current.json')); } catch { return null; } }
  async readLegacyGeneration(generation) {
    if (!generation) return null;
    const directory = this.generationDirectory(), metadataSource = await this.fs.promises.readFile(this.path.join(directory, `${generation}.meta.json`), 'utf8'), meta = JSON.parse(metadataSource), data = await this.fs.promises.readFile(this.path.join(directory, `${generation}.vectors.bin`));
    if (data.byteLength !== meta.length * DIMENSION * 4) throw new Error(`Index generation ${generation} is incomplete (${meta.length} passages, ${data.byteLength} vector bytes)`);
    let state = {}; try { state = await this.readJson(this.path.join(directory, `${generation}.state.json`)); } catch {}
    if (state.integrity?.metadataSha256 && state.integrity.metadataSha256 !== this.checksum(metadataSource)) throw new Error(`Index generation ${generation} metadata checksum failed`);
    if (state.integrity?.vectorsSha256 && state.integrity.vectorsSha256 !== this.checksum(data)) throw new Error(`Index generation ${generation} vector checksum failed`);
    return { meta, vectors: sliceBuffer(data), generation, needsSegmentMigration: true, ...state };
  }
  async readSegment(descriptor) {
    if (!descriptor?.id) throw new Error('Index segment descriptor is missing');
    const directory = this.segmentDirectory(), metadataSource = await this.fs.promises.readFile(this.path.join(directory, `${descriptor.id}.meta.json`), 'utf8'), meta = JSON.parse(metadataSource), data = await this.fs.promises.readFile(this.path.join(directory, `${descriptor.id}.vectors.bin`));
    const semanticRecords = meta.reduce((count, item) => count + (item?.filenameOnly ? 0 : 1), 0), expectedBytes = semanticRecords * DIMENSION * 4;
    if (!Array.isArray(meta) || meta.length !== Number(descriptor.records) || semanticRecords !== Number(descriptor.semanticRecords) || data.byteLength !== expectedBytes || data.byteLength !== Number(descriptor.vectorBytes)) throw new Error(`Index segment ${descriptor.id} is incomplete`);
    if (descriptor.metadataSha256 && descriptor.metadataSha256 !== this.checksum(metadataSource)) throw new Error(`Index segment ${descriptor.id} metadata checksum failed`);
    if (descriptor.vectorsSha256 && descriptor.vectorsSha256 !== this.checksum(data)) throw new Error(`Index segment ${descriptor.id} vector checksum failed`);
    const dense = new Float32Array(sliceBuffer(data)), vectors = new Float32Array(meta.length * DIMENSION); let semanticIndex = 0;
    for (let index = 0; index < meta.length; index++) if (!meta[index]?.filenameOnly) { vectors.set(dense.subarray(semanticIndex * DIMENSION, (semanticIndex + 1) * DIMENSION), index * DIMENSION); semanticIndex++; }
    return { meta, vectors };
  }
  async readSnapshot(snapshot) {
    if (!snapshot?.buckets) throw new Error('Index snapshot is missing');
    const descriptors = Object.entries(snapshot.buckets).sort((first, second) => Number(first[0]) - Number(second[0])).map(([, descriptor]) => descriptor), segments = [];
    for (let offset = 0; offset < descriptors.length; offset += 32) segments.push(...await Promise.all(descriptors.slice(offset, offset + 32).map(descriptor => this.readSegment(descriptor))));
    const meta = [], vectors = new Float32Array(segments.reduce((sum, segment) => sum + segment.meta.length, 0) * DIMENSION); let recordOffset = 0;
    for (const segment of segments) { meta.push(...segment.meta); vectors.set(segment.vectors, recordOffset * DIMENSION); recordOffset += segment.meta.length; }
    return { meta, vectors: vectors.buffer, metadataBytes: Number(snapshot.metadataBytes || descriptors.reduce((sum, descriptor) => sum + Number(descriptor.metadataBytes || 0), 0)), lastSuccessfulIndexAt: snapshot.lastSuccessfulIndexAt || null, generation: snapshot.sequence || null };
  }
  async get() {
    let existingDirectory = this.fs.existsSync(this.directory);
    for (let attempt = 0; !existingDirectory && attempt < 4; attempt++) { await new Promise(resolve => setTimeout(resolve, 250)); existingDirectory = this.fs.existsSync(this.directory); }
    if (!existingDirectory) return undefined;
    const candidates = () => this.fs.existsSync(this.path.join(this.directory, 'index.current.json')) || this.fs.existsSync(this.path.join(this.directory, 'index.meta.json')) || this.fs.existsSync(this.path.join(this.directory, 'index.vectors.bin')); let hasCandidate = candidates();
    for (let attempt = 0; !hasCandidate && attempt < 4; attempt++) { await new Promise(resolve => setTimeout(resolve, 250)); hasCandidate = candidates(); }
    if (!hasCandidate) return undefined;
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const manifest = await this.manifest();
        if (manifest?.format === FORMAT && manifest.version === FORMAT_VERSION) {
          for (const snapshot of [manifest.current, manifest.previous].filter(Boolean)) try { return await this.readSnapshot(snapshot); } catch (error) { lastError = error; }
          throw lastError || new Error('No complete desktop index snapshot is available');
        }
        if (manifest?.current) for (const generation of [manifest.current, manifest.previous].filter(Boolean)) try { const value = await this.readLegacyGeneration(generation); if (value) return value; } catch (error) { lastError = error; }
        const meta = await this.readJson(this.path.join(this.directory, 'index.meta.json')), data = await this.fs.promises.readFile(this.path.join(this.directory, 'index.vectors.bin'));
        if (data.byteLength !== meta.length * DIMENSION * 4) throw new Error(`Index pair is incomplete (${meta.length} passages, ${data.byteLength} vector bytes)`);
        let state = {}; try { state = await this.readJson(this.path.join(this.directory, 'index.state.json')); } catch {}
        let legacyHighlights = false; try { legacyHighlights = (await this.fs.promises.stat(this.path.join(this.directory, 'index.highlights.bin'))).size > 0; } catch {}
        return { meta, vectors: sliceBuffer(data), legacyHighlights, needsSegmentMigration: true, ...state };
      } catch (error) { lastError = error; if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 150)); }
    }
    throw lastError || new Error('Could not load the semantic index');
  }
  async writeSegment(bucket, group, sequence) {
    const id = `${sequence}-${String(bucket).padStart(4, '0')}-${this.crypto.randomBytes(4).toString('hex')}`, directory = this.segmentDirectory(), metadataSource = JSON.stringify(group.meta), semantic = [];
    group.meta.forEach((item, index) => { if (!item?.filenameOnly) semantic.push(group.vectors[index]); });
    const packed = new Float32Array(semantic.length * DIMENSION); semantic.forEach((vector, index) => packed.set(vector, index * DIMENSION)); const vectorData = Buffer.from(packed.buffer);
    await this.fs.promises.writeFile(this.path.join(directory, `${id}.meta.json`), metadataSource); await this.fs.promises.writeFile(this.path.join(directory, `${id}.vectors.bin`), vectorData);
    return { id, records: group.meta.length, semanticRecords: semantic.length, metadataBytes: Buffer.byteLength(metadataSource), vectorBytes: vectorData.byteLength, metadataSha256: this.checksum(metadataSource), vectorsSha256: this.checksum(vectorData) };
  }
  async put(value, options = {}) {
    this.fs.mkdirSync(this.directory, { recursive: true }); const segments = this.segmentDirectory(); this.fs.mkdirSync(segments, { recursive: true }); const previousManifest = await this.manifest(), incremental = previousManifest?.format === FORMAT && previousManifest.version === FORMAT_VERSION, sequence = Math.max(1, Number(previousManifest?.sequence || 0) + 1), dirtyFiles = new Set(options.dirtyFiles || []), force = Boolean(options.force) || !incremental, dirtyBuckets = force ? null : new Set([...dirtyFiles].map(file => indexBucket(file))), sourceVectors = value.vectorList || null, packed = sourceVectors ? null : new Float32Array(value.vectors || new ArrayBuffer(0)), groups = new Map();
    value.meta.forEach((item, index) => { const bucket = indexBucket(item.file); if (dirtyBuckets && !dirtyBuckets.has(bucket)) return; const group = groups.get(bucket) || { meta: [], vectors: [] }; group.meta.push(options.packMeta ? options.packMeta(item) : item); group.vectors.push(sourceVectors ? sourceVectors[index] : packed.subarray(index * DIMENSION, (index + 1) * DIMENSION)); groups.set(bucket, group); });
    const currentBuckets = incremental ? { ...(previousManifest.current?.buckets || {}) } : {}, bucketsToWrite = force ? new Set([...Array(BUCKETS).keys()]) : dirtyBuckets;
    const writes = [...bucketsToWrite].filter(bucket => groups.get(bucket)?.meta.length); for (const bucket of bucketsToWrite) if (!groups.get(bucket)?.meta.length) delete currentBuckets[bucket];
    for (let offset = 0; offset < writes.length; offset += 16) { const batch = writes.slice(offset, offset + 16), descriptors = await Promise.all(batch.map(bucket => this.writeSegment(bucket, groups.get(bucket), sequence))); batch.forEach((bucket, index) => { currentBuckets[bucket] = descriptors[index]; }); }
    const descriptors = Object.values(currentBuckets), current = { sequence, buckets: currentBuckets, records: descriptors.reduce((sum, descriptor) => sum + Number(descriptor.records || 0), 0), metadataBytes: descriptors.reduce((sum, descriptor) => sum + Number(descriptor.metadataBytes || 0), 0), vectorBytes: descriptors.reduce((sum, descriptor) => sum + Number(descriptor.vectorBytes || 0), 0), lastSuccessfulIndexAt: value.lastSuccessfulIndexAt || null, committedAt: Date.now() }, previous = incremental ? previousManifest.current : null, manifest = { format: FORMAT, version: FORMAT_VERSION, sequence, bucketCount: BUCKETS, dimension: DIMENSION, current, previous }, target = this.path.join(this.directory, 'index.current.json'), temporary = `${target}.${sequence}.download`;
    await this.fs.promises.writeFile(temporary, JSON.stringify(manifest)); await this.fs.promises.rename(temporary, target); await this.cleanup(manifest, !incremental); return manifest;
  }
  async cleanup(manifest, removeLegacy) {
    const keep = new Set([...Object.values(manifest.current?.buckets || {}), ...Object.values(manifest.previous?.buckets || {})].map(descriptor => descriptor.id));
    try { for (const entry of await this.fs.promises.readdir(this.segmentDirectory())) { const id = entry.replace(/\.(?:meta\.json|vectors\.bin)$/, ''); if (!keep.has(id)) await this.fs.promises.unlink(this.path.join(this.segmentDirectory(), entry)); } } catch {}
    if (!removeLegacy) return;
    for (const target of [this.generationDirectory(), this.path.join(this.directory, 'index.meta.json'), this.path.join(this.directory, 'index.vectors.bin'), this.path.join(this.directory, 'index.state.json'), this.path.join(this.directory, 'index.highlights.bin')]) try { if (this.fs.existsSync(target)) await this.fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch {}
  }
  async readCache(name, fallback) { try { return await this.readJson(this.path.join(this.directory, name)); } catch { return fallback; } }
  async writeCache(name, value) { this.fs.mkdirSync(this.directory, { recursive: true }); const target = this.path.join(this.directory, name), temporary = `${target}.download`; await this.fs.promises.writeFile(temporary, JSON.stringify(value)); await this.fs.promises.rename(temporary, target); }
  async getRelations() { return this.readCache('index.relationships.json', []); }
  async putRelations(entries) { return this.writeCache('index.relationships.json', entries); }
  async getTopicLabels() { return this.readCache('index.topic-labels.json', []); }
  async putTopicLabels(entries) { return this.writeCache('index.topic-labels.json', entries); }
  async getTextAnalysis() { return this.readCache('index.text-analysis.json', []); }
  async putTextAnalysis(entries) { return this.writeCache('index.text-analysis.json', entries); }
  async getWritingProfiles() { return this.readCache('index.writing-profiles.json', []); }
  async putWritingProfiles(entries) { return this.writeCache('index.writing-profiles.json', entries); }
  async getHighlightCache() { try { const metadata = await this.readJson(this.path.join(this.directory, 'index.highlight-cache.json')), data = await this.fs.promises.readFile(this.path.join(this.directory, 'index.highlight-cache.bin')), phrases = Array.isArray(metadata.phrases) ? metadata.phrases : [], bytes = DIMENSION * 2; if (metadata.version !== 1 || data.byteLength !== phrases.length * bytes) return []; return phrases.map((phrase, index) => [phrase, new Int16Array(data.buffer.slice(data.byteOffset + index * bytes, data.byteOffset + (index + 1) * bytes))]); } catch { return []; } }
  async putHighlightCache(entries) { this.fs.mkdirSync(this.directory, { recursive: true }); const metadataTarget = this.path.join(this.directory, 'index.highlight-cache.json'), binaryTarget = this.path.join(this.directory, 'index.highlight-cache.bin'), metadataTemporary = `${metadataTarget}.download`, binaryTemporary = `${binaryTarget}.download`, valid = entries.filter(([, vector]) => vector?.length === DIMENSION); await this.fs.promises.writeFile(metadataTemporary, JSON.stringify({ version: 1, phrases: valid.map(([phrase]) => phrase) })); await this.fs.promises.writeFile(binaryTemporary, Buffer.concat(valid.map(([, vector]) => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)))); await this.fs.promises.rename(binaryTemporary, binaryTarget); await this.fs.promises.rename(metadataTemporary, metadataTarget); }
  async getGraphEvidence() { try { const metadata = await this.readJson(this.path.join(this.directory, 'index.graph.json')), data = await this.fs.promises.readFile(this.path.join(this.directory, 'index.graph.bin')), count = Number(metadata.files?.length || 0), matrixBytes = count * count * 4; if (!count || data.byteLength !== matrixBytes * 2) return null; return { ...metadata, scores: data.buffer.slice(data.byteOffset, data.byteOffset + matrixBytes), entities: data.buffer.slice(data.byteOffset + matrixBytes, data.byteOffset + data.byteLength) }; } catch { return null; } }
  async putGraphEvidence(value) { this.fs.mkdirSync(this.directory, { recursive: true }); const metadataTarget = this.path.join(this.directory, 'index.graph.json'), binaryTarget = this.path.join(this.directory, 'index.graph.bin'), metadataTemporary = `${metadataTarget}.download`, binaryTemporary = `${binaryTarget}.download`, scores = Buffer.from(value.scores), entities = Buffer.from(value.entities); await this.fs.promises.writeFile(metadataTemporary, JSON.stringify({ version: value.version, signature: value.signature, files: value.files, fingerprints: value.fingerprints, tuning: value.tuning, builtAt: value.builtAt, rootTopology: value.rootTopology || null, rootGraph: value.rootGraph || null })); await this.fs.promises.writeFile(binaryTemporary, Buffer.concat([scores, entities])); await this.fs.promises.rename(binaryTemporary, binaryTarget); await this.fs.promises.rename(metadataTemporary, metadataTarget); }
}

export { BUCKETS as DESKTOP_INDEX_BUCKETS, DesktopIndexStore, FORMAT_VERSION as DESKTOP_INDEX_FORMAT_VERSION, indexBucket as desktopIndexBucket };
