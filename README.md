# Gib Search

Local semantic search for Obsidian.

Gib Search indexes note content, headings, filenames, and optional folder-path signals. PDFs, images, audio, video, and other vault attachments are searchable by filename and path; Gib Search never reads or embeds their binary contents. Results include compact source excerpts, semantic phrase emphasis, ranking controls, typo tolerance, and search-within-file support.

The optional **Bundle note revisions** setting collapses editions into one search result while retaining the strongest historical match. Give every edition the same `revision-group` frontmatter value for guaranteed flat grouping, even when the files live in different folders. `revision-current: true` can select the current edition and `revision-date` can provide its date; otherwise dated filenames and a single undated `DRAFT`/`WIP` determine the order. Configured folders enable conservative automatic title-and-text ancestry detection, including numbered or decorated root folders. Topical embedding similarity alone never creates a revision group. The older `gib-search-series` and `gib-search-revision-date` properties remain compatible, and `gib-search-no-bundle: true` excludes a note.

The **Open Similar Notes** command opens a native sidebar that follows the active note. It uses the search result card UI, ranks each note's strongest related passages from the existing local index, highlights related keywords and compact phrases when semantic highlighting is enabled, and opens at the best passage. When revision bundling is enabled, other editions appear first in a compact **Versions** history and do not consume or duplicate the normal similarity results.

Select text in an editor and choose **Find similar to selection** from the context menu to temporarily reuse that sidebar for passage-level matches with the same keyword and phrase highlighting. Its header shows a short plain-text preview rather than raw Markdown. The selection stays in memory only, excludes its source note, and can be dismissed with Back or Close to resume the usual active-note view.

The optional **Index writing profiles** setting builds a separate persistent local index of each Markdown note's predominant emotion, purpose, and writing form. The **Open Writing Profile** command shows the active note in a companion sidebar with three compact radar charts, calibrated evidence strengths, and expandable supporting passages. A dimension explicitly reports that no clear signal was found instead of forcing a label onto neutral or ambiguous writing. Profiles are content-fingerprinted, so unchanged notes load from cache; changed notes alone return to the queue, and the active note receives priority. Desktop profile classification uses the same verified WebGPU/fp16 worker and automatic bundled-WASM fallback as semantic indexing, but remains lower priority and yields between bounded batches.

Search and Similar Notes result icons can optionally follow Iconic file or folder icons. The default uses the top-level folder's resolved Iconic icon and color; parent-depth, nearest-decorated-folder, file, file-type, and fixed sticky-note modes are also available. Iconic is never required.

Optional custom quick-filter buttons can be shared by Search and Similar Notes or limited to either surface. Filters can use folders, file kinds or extensions, tags, frontmatter properties, path text, and recent file dates. Conditions within one filter combine as AND. A normal click selects one filter or clears the sole active filter; Shift-click adds or removes filters as OR. Each saved filter has an enable/disable switch so it can be hidden without deleting its definition. Scope resolution uses cached Obsidian metadata and runs before semantic ranking without reading files or creating new embeddings.

The experimental Atlas and graph surfaces are temporarily disabled while they are redesigned. Their implementation and saved settings remain intact, but Gib Search does not load their views, run their analysis, or prepare graph caches in this release.

Plugin settings are divided into Status, Search, and Console pages. Status reports the search index and local model independently; Console provides a bounded live account of local work without logging note contents.

**Search → Index scope** can restrict indexing to selected folders, exclude subtrees, or exclude file extensions. Blank rules retain the whole vault and filename-only attachment search. The preview shows how many files will be included, excluded, removed from the generated index, or newly queued; nothing changes until **Apply scope** is selected. Scope changes affect desktop indexing and mobile bootstrap packages without changing note files. Paused indexes apply saved scope changes when indexing resumes.

Vault search waits for its semantic ranking before displaying results. It does not display an exact-first list and then replace its order with semantic results. Long notes retain up to three strong passages per result while distinct files receive their own result slots.

**Search current file → Meaning** searches the current editor snapshot independently of the vault index, including unsaved Markdown edits. Soft provisional shading narrows from related paragraphs to candidate sentences, then confirmed matches highlight the relevant phrase. Provisional regions do not count as matches, participate in navigation, or move the cursor. Cached paragraph and sentence vectors are reused; the phrase pass reuses contextual token representations instead of embedding every possible phrase. A locally adapted sentence verifier checks factual fragments alongside independent consistency, participant, polarity and predicate evidence. Questions add query-type answerability and location/time checks; other question forms and commands retain answer ranking. Verification uses complete sentences; targets beyond the paired token budget abstain rather than losing an unread qualification. A literal hit cannot suppress paraphrases elsewhere, and findings retain their own source positions. Precise, Balanced, and Broad trade recall for selectivity. Compact English models can still miss paraphrases or confuse related concepts; Meaning is not an exhaustive linguistic guarantee. Exact matching remains available independently.

## Install with BRAT

1. Install and enable **BRAT** in Obsidian.
2. Open BRAT settings and choose **Add Beta Plugin**.
3. Enter `Giblicious/gib-search`.
4. Enable **Gib Search** under Community plugins.

Gib Search supports Obsidian on desktop and mobile. Its fallback WebAssembly inference engine is bundled with the plugin; Node.js, npm, external services, and runtime installers are not required. Desktop inference runs in an Electron Web Worker and uses WebGPU when a verified high-performance adapter is available, with automatic fallback to the bundled engine. GPU batches remain bounded and wait for active keyboard, pointer, touch, and scrolling input.

Each device builds its own local index. The first index can take several minutes, so keep Obsidian open until Settings reports that Gib Search is healthy. On desktop, the semantic index is kept in a vault-keyed operating-system cache outside the vault so OneDrive and vault-sync plugins never process ordinary index checkpoints.

Indexing runs cooperatively: model inference stays in a dedicated background worker, mobile passages are strictly bounded, work yields to Obsidian between units, active interaction receives priority, and indexing pauses while the app is in the background. Changed files are staged into bounded commits instead of rebuilding the in-memory search structures after every note. Desktop checkpoints update only changed integrity-checked segments, keep a complete rollback snapshot, omit persisted zero vectors for filename-only attachments, and avoid repacking the full vector set until search needs it. Checkpoints are flushed before suspension or shutdown, and a warm index uses a short vault-settling path instead of repeating first-run delays. Optional Writing Profile analysis is serialized one note and one signal at a time, waits until the semantic index and live searches are idle, yields between small low-priority model batches, and checkpoints without rewriting its full cache after every note. If a mobile device cannot provide background-worker support, automatic indexing pauses instead of running inference on Obsidian's UI thread.

The release-blocking synthetic performance budgets and local-only runtime measurements are documented in [PERFORMANCE.md](PERFORMANCE.md).

## Privacy and network use

- Notes, queries, embeddings, and indexes remain on the local device.
- Vault inference runs inside Obsidian using desktop WebGPU or the bundled WebAssembly fallback. In-note search uses its own native CPU worker where supported, with a bundled WebAssembly fallback; it does not require a separately installed runtime or local server.
- BGE Small English v1.5 is downloaded from Hugging Face when it is not already cached. GPU-capable desktops cache its fp16 model; the fallback engine and mobile cache its q8 model. Optional Writing Profile indexing uses the lazily downloaded MobileBERT MNLI model in desktop fp16 or fallback/mobile q8 form. These models run in the vault background worker; queries and passages stay on the device.
- Current-file Meaning downloads pinned BGE, MobileBERT, MiniLM L6 relevance and DeBERTa v3 xsmall consistency models from Hugging Face. Its BGE encoder uses full precision to keep cached preparation and live queries consistent; that model is approximately 127 MiB. The other supporting models use q8 weights. The adapted sentence verifier adds approximately 92 MiB of model/tokenizer files from this repository's pinned release tag. Supported desktops also download the matching native CPU libraries from the GitHub Release. Reader files and native libraries are hash-verified and cached locally. Opening Meaning warms the models; cold startup and initial note preparation take longer than warm queries. A separate note-vector cache is capped at 16 MiB and contains note representations, not query history. There is no vault-wide sentence index.
- After setup, searching and indexing do not require a remote service.
- Gib Search has no telemetry, accounts, advertising, or analytics.

On desktop, downloaded models remain in the Gib Search plugin directory, while the semantic index and diagnostic log use a vault-keyed device-local operating-system cache. On mobile, platform restrictions require device-local WebView storage. Index data is not written into the vault unless the optional mobile bootstrap package is explicitly enabled.

## Model

Gib Search uses **BGE Small English v1.5**, a compact local embedding model chosen for strong search quality and lower device requirements. Current-file matching adds a locally adapted **mxbai-rerank-xsmall** sentence verifier, **MobileBERT MNLI**, **MS MARCO MiniLM L6**, and **NLI DeBERTa v3 xsmall** checks. The verifier uses per-token int8 activation ranges so unrelated batch members do not change sentence scores. Its model card, training provenance, input contract and limitations are in [model-assets/in-note-reader/README.md](model-assets/in-note-reader/README.md). The optional Writing Profile index retains its existing MobileBERT and structural checks. Vault search, its models, ranking and highlights are unchanged.

## Commands

- **Semantic search**
- **Search current file**
- **Open Similar Notes**
- **Open Writing Profile**

## Development

```sh
npm run build
npm run check
```

`npm run build` bundles the shared inference runtime and its compressed WebAssembly binary into `main.js`, allowing BRAT to install the plugin using Obsidian's standard three release assets.

Release tags must be reachable from `main`; the release workflow verifies ancestry, the manifest version, the complete check suite, labeled semantic relevance, and the full locked dependency audit before publishing. Native Node-only dependencies used by the development harness are pinned with security overrides; the production browser bundle uses the separate WebAssembly/WebGPU runtime.

`npm run audit:in-file` exercises the same live-source method as the UI, with real local models and both desktop/mobile batch sizes. It protects the existing paraphrase cases and checks all breadth modes against absent concepts, misleading topical matches, negation, reversed relationships, formatting, long sentences, and many independent occurrences. The broader recall benchmark retains conservative misses in its report and requires at least 95% recall; a finite test corpus does not establish perfect accuracy on arbitrary notes. Use `--report=path.json` to save all measured misses and `--diagnostics` to retain candidate scores.

## License

MIT
