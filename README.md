# Gib Search

Local semantic search and a similarity graph for Obsidian.

Gib Search indexes note content, headings, filenames, and optional folder-path signals. Search results include compact source excerpts, semantic phrase emphasis, ranking controls, and a graph of related notes.

## Install with BRAT

1. Install and enable **BRAT** in Obsidian.
2. Open BRAT settings and choose **Add Beta Plugin**.
3. Enter `Giblicious/gib-search`.
4. Enable **Gib Search** under Community plugins.

Gib Search is currently desktop-only and requires Node.js 18 or newer with npm available on the system path. On first launch, it installs its pinned local inference runtime and downloads BGE Small English v1.5. The initial setup may take several minutes.

## Privacy and network use

- Notes, queries, embeddings, and indexes remain on the local device.
- Search requests are served over a loopback-only local connection (`127.0.0.1`).
- The first setup connects to the npm registry for the pinned inference runtime.
- BGE Small English v1.5 is downloaded from Hugging Face when it is not already cached.
- After setup, searching and indexing do not require a remote service.
- Gib Search has no telemetry, accounts, advertising, or analytics.

Generated indexes and downloaded models are stored inside the plugin directory. They are not intended to be synchronized between devices.

## Model

Gib Search uses **BGE Small English v1.5**, a compact local embedding model chosen for strong search quality and lower device requirements.

## Commands

- **Semantic search**
- **Open semantic graph**

## Development

```sh
npm run build
npm run check
```

`npm run build` embeds the audited worker sources into `main.js`, allowing BRAT to install the plugin using Obsidian's standard three release assets.

## License

MIT
