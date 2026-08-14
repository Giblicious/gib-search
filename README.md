# Gib Search

Local semantic search for Obsidian.

Gib Search indexes note content, headings, filenames, and optional folder-path signals. PDFs, images, audio, video, and other vault attachments are searchable by filename and path; Gib Search never reads or embeds their binary contents. Results include compact source excerpts, semantic phrase emphasis, ranking controls, typo tolerance, and search-within-file support.

The optional **Bundle note revisions** setting collapses editions inside user-selected folders into one result while retaining the strongest historical match. Automatic grouping uses dated titles and bounded textual ancestry checks, not topical similarity. Frontmatter can explicitly join or exclude notes with `gib-search-series`, `gib-search-revision-date`, and `gib-search-no-bundle`.

The **Open Similar Notes** command opens a native sidebar that follows the active note. It uses the search result card UI, ranks each note's strongest related passages from the existing local index, and opens at the best passage.

Search and Similar Notes result icons can optionally follow Iconic file or folder icons. The default uses the top-level folder's resolved Iconic icon and color; parent-depth, nearest-decorated-folder, file, file-type, and fixed sticky-note modes are also available. Iconic is never required.

Optional custom quick-filter buttons can be shared by Search and Similar Notes or limited to either surface. Filters can use folders, file kinds or extensions, tags, frontmatter properties, path text, and recent file dates. Conditions within one filter combine as AND; selecting multiple buttons combines their scopes as OR. Scope resolution uses cached Obsidian metadata and runs before semantic ranking without reading files or creating new embeddings.

The experimental Atlas and graph surfaces are temporarily disabled while they are redesigned. Their implementation and saved settings remain intact, but Gib Search does not load their views, run their analysis, or prepare graph caches in this release.

Plugin settings are divided into Status, Search, and Console pages. Status reports the search index and local model independently; Console provides a bounded live account of local work without logging note contents.

## Install with BRAT

1. Install and enable **BRAT** in Obsidian.
2. Open BRAT settings and choose **Add Beta Plugin**.
3. Enter `Giblicious/gib-search`.
4. Enable **Gib Search** under Community plugins.

Gib Search supports Obsidian on desktop and mobile. Its WebAssembly inference engine is bundled with the plugin; Node.js, npm, external services, and runtime installers are not required. Desktop inference runs in an Electron Web Worker to keep the interface responsive.

Each device builds its own local index. The first index can take several minutes, so keep Obsidian open until Settings reports that Gib Search is healthy.

Indexing runs cooperatively: model inference stays in a dedicated background worker, mobile passages are strictly bounded, work yields to Obsidian between units, active interaction receives priority, and indexing pauses while the app is in the background. If a mobile device cannot provide background-worker support, automatic indexing pauses instead of running inference on Obsidian's UI thread. Completed checkpoints are retained so interrupted work can resume safely.

## Privacy and network use

- Notes, queries, embeddings, and indexes remain on the local device.
- Inference runs directly inside Obsidian using the bundled WebAssembly engine.
- BGE Small English v1.5 is downloaded from Hugging Face when it is not already cached.
- After setup, searching and indexing do not require a remote service.
- Gib Search has no telemetry, accounts, advertising, or analytics.

On desktop, the model, index, and diagnostic logs are stored inside the Gib Search plugin directory. On mobile, platform restrictions require device-local WebView storage. Mobile-generated data is not written into the vault.

## Model

Gib Search uses **BGE Small English v1.5**, a compact local embedding model chosen for strong search quality and lower device requirements.

## Commands

- **Semantic search**

## Development

```sh
npm run build
npm run check
```

`npm run build` bundles the shared inference runtime and its compressed WebAssembly binary into `main.js`, allowing BRAT to install the plugin using Obsidian's standard three release assets.

## License

MIT
