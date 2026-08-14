# Gib Search

Local semantic search for Obsidian.

Gib Search indexes note content, headings, filenames, and optional folder-path signals. PDFs, images, audio, video, and other vault attachments are searchable by filename and path; Gib Search never reads or embeds their binary contents. Results include compact source excerpts, semantic phrase emphasis, ranking controls, typo tolerance, and search-within-file support.

The optional **Bundle note revisions** setting collapses editions inside user-selected folders into one result while retaining the strongest historical match. Automatic grouping uses dated titles and bounded textual ancestry checks, not topical similarity. Frontmatter can explicitly join or exclude notes with `gib-search-series`, `gib-search-revision-date`, and `gib-search-no-bundle`.

The **Open Similar Notes** command opens a native sidebar that follows the active note. It uses the search result card UI, ranks each note's strongest related passages from the existing local index, highlights related keywords and compact phrases when semantic highlighting is enabled, and opens at the best passage.

Select text in an editor and choose **Find similar to selection** from the context menu to temporarily reuse that sidebar for passage-level matches with the same keyword and phrase highlighting. Its header shows a short plain-text preview rather than raw Markdown. The selection stays in memory only, excludes its source note, and can be dismissed with Back or Close to resume the usual active-note view.

The optional **Index writing profiles** setting builds a separate persistent local index of each Markdown note's predominant emotion, purpose, and writing form. The **Open Writing Profile** command shows the active note in a companion sidebar with three compact radar charts, calibrated evidence strengths, and expandable supporting passages. A dimension explicitly reports that no clear signal was found instead of forcing a label onto neutral or ambiguous writing. Profiles are content-fingerprinted, so unchanged notes load from cache; changed notes alone return to the queue, and the active note receives priority.

Search and Similar Notes result icons can optionally follow Iconic file or folder icons. The default uses the top-level folder's resolved Iconic icon and color; parent-depth, nearest-decorated-folder, file, file-type, and fixed sticky-note modes are also available. Iconic is never required.

Optional custom quick-filter buttons can be shared by Search and Similar Notes or limited to either surface. Filters can use folders, file kinds or extensions, tags, frontmatter properties, path text, and recent file dates. Conditions within one filter combine as AND. A normal click selects one filter or clears the sole active filter; Shift-click adds or removes filters as OR. Each saved filter has an enable/disable switch so it can be hidden without deleting its definition. Scope resolution uses cached Obsidian metadata and runs before semantic ranking without reading files or creating new embeddings.

The experimental Atlas and graph surfaces are temporarily disabled while they are redesigned. Their implementation and saved settings remain intact, but Gib Search does not load their views, run their analysis, or prepare graph caches in this release.

Plugin settings are divided into Status, Search, and Console pages. Status reports the search index and local model independently; Console provides a bounded live account of local work without logging note contents.

## Install with BRAT

1. Install and enable **BRAT** in Obsidian.
2. Open BRAT settings and choose **Add Beta Plugin**.
3. Enter `Giblicious/gib-search`.
4. Enable **Gib Search** under Community plugins.

Gib Search supports Obsidian on desktop and mobile. Its fallback WebAssembly inference engine is bundled with the plugin; Node.js, npm, external services, and runtime installers are not required. Desktop inference runs in an Electron Web Worker and uses WebGPU when a verified high-performance adapter is available, with automatic fallback to the bundled engine. GPU batches remain bounded and wait for active keyboard, pointer, touch, and scrolling input.

Each device builds its own local index. The first index can take several minutes, so keep Obsidian open until Settings reports that Gib Search is healthy.

Indexing runs cooperatively: model inference stays in a dedicated background worker, mobile passages are strictly bounded, work yields to Obsidian between units, active interaction receives priority, and indexing pauses while the app is in the background. Optional Writing Profile analysis is serialized one note and one signal at a time, waits until the semantic index and live searches are idle, yields between small low-priority model batches, and checkpoints without rewriting its full cache after every note. If a mobile device cannot provide background-worker support, automatic indexing pauses instead of running inference on Obsidian's UI thread. Completed checkpoints are retained so interrupted work can resume safely.

## Privacy and network use

- Notes, queries, embeddings, and indexes remain on the local device.
- Inference runs directly inside Obsidian using desktop WebGPU or the bundled WebAssembly fallback.
- BGE Small English v1.5 is downloaded from Hugging Face when it is not already cached. GPU-capable desktops cache its fp16 model; the fallback engine and mobile cache its q8 model. Enabling Writing Profile indexing also downloads the local MobileBERT MNLI analysis model.
- After setup, searching and indexing do not require a remote service.
- Gib Search has no telemetry, accounts, advertising, or analytics.

On desktop, the model, index, and diagnostic logs are stored inside the Gib Search plugin directory. On mobile, platform restrictions require device-local WebView storage. Mobile-generated data is not written into the vault.

## Model

Gib Search uses **BGE Small English v1.5**, a compact local embedding model chosen for strong search quality and lower device requirements. The optional Writing Profile index uses **MobileBERT MNLI** for local emotion, purpose, and form classification, combined with conservative applicability gates and Markdown-aware structural evidence. Raw model entailment is calibrated before display, and weak evidence can abstain rather than becoming a finding.

## Commands

- **Semantic search**
- **Open Similar Notes**
- **Open Writing Profile**

## Development

```sh
npm run build
npm run check
```

`npm run build` bundles the shared inference runtime and its compressed WebAssembly binary into `main.js`, allowing BRAT to install the plugin using Obsidian's standard three release assets.

## License

MIT
