# In-note search 0.54.67 validation

The change is confined to current-note retrieval, verification, cached vectors
and display attribution. Vault indexing, query ranking, models and highlights
retain their 0.54.66 implementation. The vault inference worker is unchanged.

## Architecture

Paragraph and sentence BGE representations shortlist occurrences. Factual
fragments then pass a locally adapted complete-sentence reader, independent
consistency checks, logical participant/polarity checks and token evidence.
Location, time, cause and Boolean questions use declarative consistency checks
plus answer-slot and content checks. Other question forms and commands retain
their answer-ranking path. Phrase attribution
narrows a verified sentence using existing token states. It cannot add hits.
Oversized sentences abstain rather than losing an unread qualification.

The reader uses quantization-aware training and per-token int8 activation
ranges. BGE uses independent full-precision inputs: ordinary dynamic int8
embedding batches changed scores when preparation and live queries had different
padding. The in-note cache format changes accordingly. Neither change touches
vault embeddings. A native worker uses at most two CPU threads; the WebAssembly
fallback uses one. No query, passage, training example or user note is sent to
a remote inference service. First setup downloads public model/runtime files.

## Required gates

- `npm run check`: build, public-content/version checks, search regressions,
  role/polarity/phrase checks, Unicode/Markdown offsets, cancellation, bounded
  caches, native client fallback and shutdown, indexing, hotkeys and other
  existing product checks all pass.
- `npm run audit:in-file`: 138 cases, all three breadth modes, desktop and mobile
  batch profiles. Each profile finds 318 of 324 labeled Balanced/Broad
  occurrences, with zero forbidden hits and 298 phrase-span checks. Required
  expectations, occurrence counts and original optional labels are unchanged;
  five question regressions extend the original 133-case corpus.
- The same 138-case corpus runs through the actual bundled browser worker,
  embedded WASM and model-cache bridge: all required expectations and phrase
  checks pass, with zero forbidden hits. Balanced/Broad finds 318/324; all three
  modes together find 468/486, including the deliberately stricter Precise mode.
- `node scripts/in-note-native-check.mjs`: downloads/caches the exact build's
  native libraries into a disposable directory, verifies their hashes, loads
  all five models offline, and checks discrimination, batch-independent reader
  decisions, embedding/word-state consistency and over-budget abstention.
- `npm audit --audit-level=moderate`: zero vulnerabilities. The suite structural
  audit has zero errors; its four pre-existing warnings concern legacy private
  projects outside this release.

The release workflow repeats the product, model-backed accuracy and native
worker gates before publishing any assets. It uses the locked CPU runtime
package and skips unrelated CUDA installation. Model text files use canonical
LF bytes; model hashes are verified before building. The native worker bundles
its JavaScript dependencies and excludes unused native image-processing packages.

## Timing and broader diagnostics

On the development Windows desktop (Ryzen 5 7600, two inference threads), 34
queries over four authored whole notes find 22/23 expected passages with zero
unexpected hits. With models and note representations prepared, median query
completion is 294 ms and p95 is 437 ms. Cached model startup is about 3.8 s.
These are measurements on this machine, not a device-independent promise.
First download and initial preparation are excluded from warm-query timings.
Browser tests use desktop Chrome's single-thread WASM fallback; physical mobile
hardware was not benchmarked.

A larger authored handbook has 158,008 characters and 1,503 search units.
Initial note preparation takes 23.2 s; three different warm queries complete
in 174-374 ms and recover both expected answers while abstaining on an absent
concept. Cancellation takes 46 ms. Cached vectors and optional token states
remain below 16 MiB, including after word-state eviction and recovery. Initial
preparation is background work and is distinct from warm-query latency.

Several additional authored contrast sets were used during development. They
are not independent estimates of production accuracy. A 30-query contrast set
finds 29/30 expected passages with two additional findings (a rent/let word-sense
ambiguity and speech confused with silence). A 42-query adversarial set finds
25/40 expected passages with one additional finding involving an implicit
participant/time anchor. A further 22-query whole-note set finds 14/14 expected
passages with zero additional findings. These results retain conservative
labels and misses; they are not hidden by the required-suite result. Compact local models
still confuse related objects or viewpoints; this release does not establish
NotebookLM-equivalent retrieval or perfect logical equivalence.

## Release contract

Version 0.54.67 publishes the normal BRAT `main.js`, `manifest.json`, `styles.css`,
plus `runtime-manifest.json`, `in-note-notices.txt`, the platform-specific
`ort-*` libraries, `reader-asset-manifest.json` and `in-note-reader.onnx`.
Reader configuration/tokenizer files and weights are also pinned to the tag
under `model-assets/in-note-reader/`. Downloaded release assets must match the
tested build's sizes and hashes. BRAT owns real-vault installation and activation.
