# Gib Search

Local semantic search and a similarity graph for Obsidian.

Gib Search indexes note content, headings, filenames, entities, and optional folder-path signals. Search results include compact source excerpts, semantic phrase emphasis, ranking controls, and a living graph of related notes.

The search popup includes four coordinated lenses. **Relevance** gives the strongest overall matches, **Concepts** groups distinct facets, **Arguments** separates support and tension, and **Context** favors notes connected to the wider vault. A lens changes both result ordering and the map layout; Relevance is the default and can be changed in settings.

The note-neighborhood pane offers the same lenses with the active note as its semantic center. Arguments compares relevant neighboring notes pairwise; it does not treat the first result or the active note as an authoritative claim.

When Arguments finds a confident alignment or tension, its result card shows the exact query-relevant passage pair used for that judgment and names the counterpart note. These are source excerpts, not generated explanations.

The optional magic graph combines a stable topic compass, semantic communities, shared entities, query-conditioned relationships, and local natural-language inference. These signals form one multi-relational distance model that is reduced into a query-conditioned 2D layout. Hue represents semantic direction, while lightweight physics animates and gently relaxes the calculated geometry.

## Install with BRAT

1. Install and enable **BRAT** in Obsidian.
2. Open BRAT settings and choose **Add Beta Plugin**.
3. Enter `Giblicious/gib-search`.
4. Enable **Gib Search** under Community plugins.

Gib Search supports Obsidian on desktop and mobile. Its WebAssembly inference engine is bundled with the plugin; Node.js, npm, external services, and runtime installers are not required. Desktop inference runs in an Electron Web Worker to keep the interface responsive.

Each device builds its own local index. The first index can take several minutes, so keep Obsidian open until Settings reports that Gib Search is healthy.

## Privacy and network use

- Notes, queries, embeddings, and indexes remain on the local device.
- Inference runs directly inside Obsidian using the bundled WebAssembly engine.
- BGE Small English v1.5 is downloaded from Hugging Face when it is not already cached.
- If relationship intelligence is enabled, MobileBERT MNLI is downloaded the first time the Arguments lens needs it. It runs locally and its judgments are cached on the device.
- After setup, searching and indexing do not require a remote service.
- Gib Search has no telemetry, accounts, advertising, or analytics.

On desktop, the model, index, and diagnostic logs are stored inside the Gib Search plugin directory. On mobile, platform restrictions require device-local WebView storage. Mobile-generated data is not written into the vault.

## Model

Gib Search uses **BGE Small English v1.5**, a compact local embedding model chosen for strong search quality and lower device requirements. Optional support/contrast classification uses a quantized **MobileBERT MNLI** model only on a bounded set of visible graph connections.

## Commands

- **Semantic search**
- **Open semantic graph**

## Development

```sh
npm run build
npm run check
```

`npm run build` bundles the shared inference runtime and its compressed WebAssembly binary into `main.js`, allowing BRAT to install the plugin using Obsidian's standard three release assets.

## License

MIT
