---
license: apache-2.0
base_model: mixedbread-ai/mxbai-rerank-xsmall-v1
language: en
pipeline_tag: text-classification
---

# Gib Search sentence verifier

This model scores a query against one complete source sentence. It is used only
by in-note search. It does not generate an answer or source offsets. The plugin
checks sentence consistency, participants, polarity and content before selecting
a display phrase from the existing BGE token representations.

The Apache-2.0 base is [Mixedbread's mxbai-rerank-xsmall-v1](https://huggingface.co/mixedbread-ai/mxbai-rerank-xsmall-v1/tree/b5c6e9da73abc3711f593f705371cdbe9e0fe422).
The tokenizer, twelve-layer DeBERTa encoder, pooler and scalar classification head
are retained. The encoder and head were adapted locally; vocabulary embeddings
were frozen. No private vault content was used or transmitted.

## Training

Training combined authored contrasts, locally generated and reviewed examples,
and public training splits from [SNLI](https://nlp.stanford.edu/projects/snli/),
[PAWS-Wiki](https://github.com/google-research-datasets/paws),
[SQuAD](https://rajpurkar.github.io/SQuAD-explorer/),
[HANS](https://github.com/tommccoy1/hans/tree/7299f6f657089ce06a0f98e7e81f8d0f5b7741ce)
and single-sentence [NevIR](https://github.com/orionw/NevIR) contrasts.
SNLI is credited to Bowman, Angeli, Potts and Manning (2015), CC BY-SA 4.0;
PAWS to Zhang, Baldridge and He (2019), under Google's dataset terms;
SQuAD to Rajpurkar and colleagues (2016), CC BY-SA 4.0;
HANS to McCoy, Pavlick and Linzen (2019), MIT;
NevIR to Orion Weller and colleagues, MIT.
No dataset text or training checkpoint is distributed with the plugin.

The final training mixture contains 181,732 rows, with 4,345 development rows.
Its training JSONL SHA-256 is
`6afeca222d5d1b939a3fdcca3e5aaed3fff8d6cc35ad83723019bcea46ca289b`.
The final adaptation ran for 1,800 steps with batch size 24 and learning rate
3e-6, after fragment and contextual adaptation. Development macro F1 selected
the checkpoint. In-note regression and whole-note evaluation sets were excluded
from training. Several authored evaluation sets informed system development;
they must not be described as independent final tests.

Multi-sentence NevIR document labels were excluded from sentence training:
a document's retrieval label does not reliably label every fact it contains.
ANLI was excluded. The official HANS evaluation split was reserved for testing.

## Inference contract

Input is the original query paired with `Target: <complete sentence>\nContext: `.
Paragraph vectors retrieve candidates; unrelated paragraph text cannot supply
the selected sentence's truth. The scalar sigmoid is a relevance score, not a
calibrated probability. The model alone is insufficient to establish a hit.

The ONNX graph uses per-row int8 embedding weights, per-output int8 linear
weights and per-token dynamic int8 activations. The final adaptation simulated
these quantizers. Per-token activation ranges prevent unrelated batch members
from changing the scale of a sentence. **Set ONNX Runtime graph optimization to
`basic`**; extended fusion assumes scalar activation ranges and changes results.
Use the packaged `model_quantized.onnx`, not a separately re-quantized graph.

Inference accepts at most 512 paired tokens. Over-budget targets abstain;
they are never accepted after dropping an unread qualification. Sentence checks
remain intact when display attribution narrows a highlight to a phrase.

`asset-manifest.json` records exact packaged sizes and SHA-256 hashes. The plugin
verifies these files when loading the local cache and when downloading them.
Weights are pinned to the immutable 0.54.67 tag. Base and runtime license copies
are in `licenses/` and the built plugin's third-party notices.

## Limits

Compact English models still miss some paraphrases and can confuse related
objects, word senses, implicit participants, dates and indirect descriptions.
Question retrieval combines query-type answerability checks and answer ranking;
commands retain their separately tested ranking path.
Sentence corroboration, grammar and attribution reduce errors; none is a proof
that arbitrary natural-language claims are equivalent. Use Exact when literal
wording is the intended criterion.
