// A verifier selects an existing sentence. It never generates source text or
// offsets, and an over-budget sentence is never accepted after truncation.
export function sentenceReaderInputs(tokenizer, pairs, maxTokens = 512) {
  const selected = [], passages = [];
  pairs.forEach((pair, index) => {
    if (!Number.isInteger(pair.targetFrom) || !Number.isInteger(pair.targetTo) || pair.targetFrom < 0 || pair.targetTo <= pair.targetFrom || pair.targetTo > String(pair.passage || '').length) throw new Error('Invalid in-note sentence boundaries');
    const target = pair.passage.slice(pair.targetFrom, pair.targetTo), passage = pair.contextual ? pair.passage : `Target: ${target}\nContext: `;
    if (tokenizer.encode(pair.query).length + tokenizer.encode(passage).length > maxTokens) return;
    selected.push(index); passages.push(passage);
  });
  return { selected, inputs: selected.length ? tokenizer(selected.map(index => pairs[index].query), { text_pair: passages, padding: true, truncation: false }) : null };
}

export function sentenceReaderResults(pairs, selected, logits) {
  const results = pairs.map(() => ({ probability: 0, binaryProbability: 0, complete: false, spans: [] }));
  if (!selected.length) return results;
  const values = logits.to('float32').data;
  if (values.length !== selected.length || !values.every(Number.isFinite)) throw new Error('In-note sentence verifier returned invalid scores');
  selected.forEach((index, row) => {
    const pair = pairs[index], probability = 1 / (1 + Math.exp(-values[row]));
    results[index] = { probability, binaryProbability: probability, complete: true, spans: [{ from: pair.targetFrom, to: pair.targetTo, sentenceFrom: pair.targetFrom, sentenceTo: pair.targetTo, sentenceProbability: probability }] };
  });
  return results;
}
