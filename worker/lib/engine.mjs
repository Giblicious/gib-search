/** Embedding engine with explicit, versioned model profiles. */
import { env, pipeline } from '@huggingface/transformers';

export const MODEL_PROFILES = {
  bge: { id: 'Xenova/bge-small-en-v1.5', dimension: 384, dtype: 'q8', queryPrefix: 'Represent this sentence for searching relevant passages: ' },
};

export class EmbeddingEngine {
  constructor(modelsPath, profileName = 'bge') {
    this.modelsPath = modelsPath;
    this.profileName = MODEL_PROFILES[profileName] ? profileName : 'bge';
    this.profile = MODEL_PROFILES[this.profileName];
    this.pipe = null;
  }
  async initialize() {
    env.cacheDir = this.modelsPath;
    env.allowRemoteModels = true;
    this.pipe = await pipeline('feature-extraction', this.profile.id, { dtype: this.profile.dtype });
  }
  isReady() { return this.pipe !== null; }
  getModelId() { return this.profile.id; }
  getProfileName() { return this.profileName; }
  async embed(text) {
    if (!this.pipe) throw new Error('Engine not initialized');
    const output = await this.pipe(`${this.profile.queryPrefix}${text}`, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data);
  }
  async embedBatch(texts) {
    if (!this.pipe) throw new Error('Engine not initialized');
    if (texts.length === 0) return [];
    const batchSize = 48;
    const results = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const outputs = await this.pipe(batch, { pooling: 'mean', normalize: true });
      const dim = outputs.dims[1];
      for (let j = 0; j < batch.length; j++) {
        const start = j * dim;
        results.push(new Float32Array(outputs.data.slice(start, start + dim)));
      }
    }
    return results;
  }
  getDimension() { return this.profile.dimension; }
}
