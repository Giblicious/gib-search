import { mean_pooling } from '@huggingface/transformers';
import { packInNoteFocus } from './in-note-focus.js';

export async function embedInNote(extractor, texts) {
  // Identical tokenization, forward pass, pooling and normalization to the
  // feature-extraction pipeline; reuse its hidden states for display attribution.
  const inputs = extractor.tokenizer(texts, { padding: true, truncation: true }), output = await extractor.model(inputs);
  const hidden = output.last_hidden_state ?? output.logits ?? output.token_embeddings, pooled = mean_pooling(hidden, inputs.attention_mask), normalized = pooled.normalize(2, -1);
  const [, length, dimension] = hidden.dims;
  return texts.map((text, row) => {
    const vector = new Float32Array(normalized.data.slice(row * dimension, (row + 1) * dimension));
    // A display-attribution failure must not change or suppress a verified match.
    try {
      const ids = Array.from(inputs.input_ids.data.slice(row * length, (row + 1) * length)), pieces = extractor.tokenizer.model.convert_ids_to_tokens(ids);
      vector.focus = packInNoteFocus(text, pieces, hidden.data.subarray(row * length * dimension, (row + 1) * length * dimension), pooled.data.subarray(row * dimension, (row + 1) * dimension), dimension);
    } catch { vector.focus = null; }
    return vector;
  });
}
