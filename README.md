# Gib Search

Local semantic search and a similarity graph for Obsidian.

Gib Search indexes note content, headings, filenames, entities, and optional folder-path signals. Search results include compact source excerpts, semantic phrase emphasis, ranking controls, and a living graph of related notes.

Plugin settings are divided into Status, Search, Views, and Console pages. Status reports the Search index, Atlas-quality analysis, and local models independently; Console provides a bounded live account of current local work without logging note contents.

One View definition now controls the Atlas, search map, and Atlas Companion. The included Views are **Meaning**, **Topics**, **Emotion**, **Purpose**, **Writing form**, and **Links**. Choose the same View anywhere without translating between separate lens, grouping, and graph-mode controls.

The living map combines semantic relationships, authored links, and local writing analysis in a cached particle field. For each View and scope, Gib Search subtracts the ordinary relationship baseline and retains only locally distinctive attraction or separation. The unremarkable middle exerts no force, while real neighborhoods, bridges, and outliers remain free to emerge. Deterministic sweeps settle the structure, then continue at a bounded low-energy cadence so the Atlas stays alive.

Map terrain and nodes are GPU-accelerated with WebGL 2 while preserving the established flat topographic design. Devices without WebGL 2 automatically retain the Canvas renderer.

The dedicated Atlas begins with the full vault and includes its own semantic search bar. Once a query reaches three characters, the query becomes a temporary center particle. Search score controls each result's preferred radius, while the active View determines the relationships and arrangement around it. Nonmatches remain as subdued spatial context, and ranked excerpts appear in the native Atlas Navigator pane.

Saved Atlas Views are built as a readable map formula:

- **Territory** selects which notes exist in the landscape.
- **Reference frame** leaves the map free, centers it on an idea, orients it with a constellation or two-pole axis.
- **Relationship field** blends Meaning, Emotion, Purpose, Form, and authored Links into one normalized note-to-note distance model.
- **Dynamics** controls contrast, cohesion, and spacing without inventing new relationships.
- **Cartography** assigns color, dot size, terrain, and optional beacon regions independently from placement.

The relationship field can use five measurements:

- **Meaning** maps what the writing is about using semantic embeddings.
- **Emotion** reads a continuous profile across 24 affective landmarks, including joy, gratitude, awe, longing, grief, despondency, anxiety, frustration, indignation, guilt, and determination. A note can express several at once.
- **Purpose** distinguishes questioning, explaining, reflecting, persuading, comparing, planning, and summarizing.
- **Form** combines local language inference with document structure to distinguish journals, essays, conversations, reference notes, narratives, and plans.
- **Links** makes authored wikilinks contribute directly to distance alongside any analytical measurements.

View controls live directly on the Atlas. Territory, orientation, scale, arrangement, relationship weights, dynamics, and cartography update the active landscape without opening a separate editor. Standard Views can be tuned or reset, and **Save as new view** creates a reusable custom View. Nonsemantic Views analyze representative passages in bounded batches, save progress between batches, and reuse content-fingerprinted profiles until a note changes.

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
- MobileBERT MNLI is downloaded the first time a nonsemantic View needs it. It runs locally and its judgments and text profiles are cached on the device.
- After setup, searching and indexing do not require a remote service.
- Gib Search has no telemetry, accounts, advertising, or analytics.

On desktop, the model, index, and diagnostic logs are stored inside the Gib Search plugin directory. On mobile, platform restrictions require device-local WebView storage. Mobile-generated data is not written into the vault.

## Model

Gib Search uses **BGE Small English v1.5**, a compact local embedding model chosen for strong search quality and lower device requirements. A quantized **MobileBERT MNLI** model handles passage-level relationship, emotion, purpose, position, and form judgments. Form analysis also uses local document structure. Work is bounded and cached so ordinary search and indexing do not wait for analytical Views.

## Commands

- **Semantic search**
- **Open Gib Search map**

## Development

```sh
npm run build
npm run check
```

`npm run build` bundles the shared inference runtime and its compressed WebAssembly binary into `main.js`, allowing BRAT to install the plugin using Obsidian's standard three release assets.

## License

MIT
