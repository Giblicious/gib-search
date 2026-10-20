import { pipeline } from '@huggingface/transformers';
import { embedInNote } from '../src/in-note-embedding.js';
import { sentenceReaderInputs, sentenceReaderResults } from '../src/in-note-sentence-codec.js';

export async function auditModels(readerRoot) {
  const options = { dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } }, models = [];
  async function load(task, id, extra = {}) { const model = await pipeline(task, id, { ...options, ...extra }); models.push(model); return model; }
  const embedder = await load('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'fp32', revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3' });
  const classifier = await load('text-classification', 'Xenova/mobilebert-uncased-mnli', { revision: '8b0ea66ab7b190bba77418ba03b67d69cfc9a1ee' });
  const guard = await load('text-classification', 'Xenova/nli-deberta-v3-xsmall', { revision: '2a4f614a701367a02d51389039afc998faeda637' });
  const ranker = await load('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', { revision: 'a09144355adeed5f58c8ed011d209bf8ee5a1fec' });
  const reader = await load('text-classification', readerRoot, { local_files_only: true, session_options: { ...options.session_options, graphOptimizationLevel: 'basic' } });
  if (!reader.model.config.reader_sentence_check) throw new Error('The reader must retain sentence evidence checks');
  async function classify(model, pairs, batchSize) {
    const results = [];
    for (let offset = 0; offset < pairs.length; offset += batchSize) {
      const batch = pairs.slice(offset, offset + batchSize), inputs = model.tokenizer(batch.map(pair => pair.premise), { text_pair: batch.map(pair => pair.hypothesis), padding: true, truncation: true, max_length: 512 });
      const values = (await model.model(inputs)).logits.to('float32').data;
      batch.forEach((pair, row) => { const logits = Array.from(values.slice(row * 3, row * 3 + 3)), exps = logits.map(value => Math.exp(value - Math.max(...logits))), sum = exps.reduce((a, b) => a + b); results.push(Object.fromEntries(exps.map((value, index) => [model.model.config.id2label[index].toLowerCase(), value / sum]))); });
    }
    return results;
  }
  return {
    async embed(texts) { const vectors = []; for (const text of texts) vectors.push(...await embedInNote(embedder, [text])); return vectors; },
    classify: (pairs, mobile) => classify(classifier, pairs, mobile ? 6 : 24),
    guard: pairs => classify(guard, pairs, 1),
    async rank(pairs) { if (!pairs.length) return []; const inputs = ranker.tokenizer(pairs.map(pair => pair.query), { text_pair: pairs.map(pair => pair.passage), padding: true, truncation: true, max_length: 512 }); return Array.from((await ranker.model(inputs)).logits.to('float32').data); },
    async read(pairs) { const { selected, inputs } = sentenceReaderInputs(reader.tokenizer, pairs); return sentenceReaderResults(pairs, selected, inputs ? (await reader.model(inputs)).logits : null); },
    dispose: () => Promise.all(models.map(model => model.dispose())),
  };
}
