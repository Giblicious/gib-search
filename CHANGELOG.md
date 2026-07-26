# Changelog

## 0.5.11

- Replaces literal triangulated terrain with an adaptive semantic heat field.
- Uses result relevance as heat intensity and local note spacing as each influence's natural spread.
- Elongates note influence toward positive semantic neighbors, forming organic ridges without arbitrary control points.
- Reinforces positive residual relationships and subtracts negative residual relationships to create meaningful saddles and valleys.
- Draws six smooth contours from the normalized field without background shading.

## 0.5.10

- Adds local typo tolerance for semantic queries using vocabulary derived from the indexed vault.
- Corrects high-confidence, single-edit misspellings before query embedding so tokenizer fragmentation cannot eliminate otherwise relevant results.
- Retains both the entered and corrected terms for filename and folder matching.
- Keeps correction entirely offline and refreshes its vocabulary with the semantic index.

## 0.5.9

- Replaces stacked boundary envelopes with contours cut through one continuous semantic elevation surface.
- Uses only the query and visible notes as elevated terrain controls; note height remains its displayed relevance.
- Derives a tight zero-elevation ground skirt from the result footprint so contours close without filling the map panel.
- Preserves the living semantic physics while allowing real slopes, ridges, saddles, and valleys to emerge between notes.

## 0.5.8

- Replaces circular node-and-corridor envelopes with padded concave hulls around each relevance group.
- Keeps every contour grounded in the qualifying note positions while allowing the boundary to shrink naturally between them.
- Stitches raster contour fragments into complete paths and curve-smooths them for a cleaner topographic appearance.
- Refines the six-line visual hierarchy from a quiet outer boundary to subtly stronger inner contours.

## 0.5.7

- Removes the continuous elevation field and all synthetic terrain control points.
- Recasts the six relevance bands as independent semantic envelopes around notes meeting each threshold.
- Connects envelopes only along positive, selected note relationships.
- Ensures every lobe and connection corresponds directly to a visible query, note, or measured semantic edge.

## 0.5.6

- Makes the query a draggable, unpinned participant in the same physics simulation as result notes.
- Uses query-to-file relevance, overall file similarity, and signed query-conditioned residual similarity as distinct force layers.
- Recenters the complete settled system without fixing any individual node to the canvas center.
- Replaces ten contours with six simple relevance bands: five internal boundaries and the terrain's outer edge.
- Connects terrain only along supported query and positive residual-semantic relationships without inventing ridge elevation.

## 0.5.5

- Stops treating the map container as the terrain boundary.
- Replaces global interpolation with compact local influence around the query, notes, and semantic ridges.
- Lets elevation fall naturally to zero beyond the result structure, preserving empty space around the landscape.
- Produces irregular, result-shaped terrain outlines instead of stretching contours to fill the panel.

## 0.5.4

- Groups results by the semantic meaning remaining after their shared query relationship is removed.
- Uses only each note's three strongest residual-semantic neighbors as attractive springs.
- Adds full-plane repulsion so unrelated notes and subtopics can separate into distinct lobes.
- Shapes terrain with raised control points along strong semantic relationships, producing meaningful ridges and cluster shoulders.
- Draws exactly ten evenly spaced contours across the normalized visible elevation range.

## 0.5.3

- Replaces the fixed radial settlement with a continuous, damped semantic spring simulation.
- Lets note similarity pull and separate notes while relevance remains the dominant radial force.
- Uses a smooth elevation interpolation for curved, high-resolution landscape contours.
- Adds a low-elevation perimeter so contour lines close naturally inside the map instead of clipping at the data boundary.
- Extends the living terrain and semantic forces to the Note Neighborhood pane.

## 0.5.2

- Grounds map distance and elevation in the same total relevance score shown beside each search result.
- Uses note-to-note semantic similarity as a physical clustering force while preserving relevance-based distance from the query.
- Replaces generated hills with contours interpolated directly between the query and result elevations.
- Sizes note markers by their file size across the whole vault, with logarithmic scaling for readable differences.
- Adds fluid note dragging and removes terrain shading, decorative hover rings, and the map background tint.

## 0.5.1

- Replaces the radial node layout with an embedding-derived topographical semantic terrain.
- Uses contour lines, elevation, and ridges to express result relevance, density, and semantic neighborhoods without graph edges.
- Correctly mounts the map beside Obsidian's current desktop prompt result container.
- Adds a visible Map control to the search field and introduces the desktop terrain in its expanded state.
- Keeps the terrain query-local and reuses the query embedding already produced by search.

## 0.5.0

- Adds an optional semantic map beside search results, with relevance expressed by distance and result relationships expressed spatially.
- Links hover and selection between result cards and map nodes without adding another embedding pass.
- Adds a live, pinnable Note Neighborhood side pane for exploring notes related to the active note.
- Adapts the map into a dedicated view on narrow mobile screens.

## 0.4.5

- Precomputes semantic phrase vectors during indexing so highlighted search results require no additional phrase inference.
- Stores the phrase-vector index locally on desktop and mobile alongside the passage index.
- Upgrades existing indexes in place while keeping old passages searchable until their replacements are ready.
- Shows the indexed highlight-phrase count in semantic index health details.

## 0.4.4

- Waits for an existing desktop index and its directory when they are briefly unavailable during startup.
- Fails safely instead of treating a transient desktop index read failure as an empty index to rebuild.
- Keeps existing searchable entries available until each refreshed note has been embedded and replaced.
- Waits for Obsidian's vault file list to settle before checking for deleted or changed notes.
- Renders search results once, with semantic highlights already applied, instead of visibly adding highlights afterward.

## 0.4.3

- Replaced unsupported Node worker threads with an Electron-compatible Web Worker on desktop.
- Keeps BGE inference off Obsidian's UI thread without launching another process or requiring Node.js.
- Removed the duplicate model warm-up that could still stall Obsidian's UI before a desktop search.
- Serialized background inference so indexing and semantic highlighting cannot race over the model.
- Prevented the highlighter cache from evicting phrases still needed by the active result pass.
- Kept every active highlight vector in a pass-local map, even when a large result set exceeds the global cache limit.
- Added content fingerprints so sync tools changing file timestamps do not force unnecessary reindexing.
- Verifies synced notes with uncached vault reads so external sync events cannot compare against stale text.
- Retries and validates desktop index loading when a sync tool briefly replaces or locks the metadata/vector pair.
- Ignores empty sentence candidates instead of aborting the entire semantic highlight pass.

## 0.4.2

- Restored bounded, worker-optimized desktop inference batches so semantic highlighting does not wait on one oversized request or excessive small requests.
- Highlights the top result passages first, then completes the remaining visible highlights progressively.

## 0.4.1

- Moved desktop BGE inference into a dedicated background worker so indexing and semantic highlighting do not block Obsidian's interface.
- Kept the existing mobile inference path and shared ranking and highlighting behavior unchanged.

## 0.4.0

- Replaced isolated n-gram highlighting with query-aware contextual span attribution.
- Selects the strongest sentence first, then discovers semantic seed words and readable one-to-three-word spans within it.
- Uses lexical roots only to support obvious inflections and complete phrases; exact words are no longer highlighted independently.
- Verifies finalist spans against their sentence context and supports semantic expressions such as scriptural idioms.
- Added a bundled phrase-structure pass to reject incomplete or grammatically weak highlights.
- Removed cross-result phrase propagation so every highlight is validated in its own context.

## 0.3.4

- Coalesced vault file events into one serialized index update instead of launching overlapping full scans.
- Reduced background embedding batches so Obsidian can repaint between inference work.
- Loads the model on demand when an existing index is already current.
- Deduplicated concurrent model initialization.

## 0.3.3

- Bundled the browser-only ONNX loader and prevented Electron from importing Node worker modules during WASM startup.

## 0.3.2

- Fixed ONNX startup inside Obsidian's Electron renderer by selecting the bundled browser inference runtime at build time.

## 0.3.1

- Fixed startup in Obsidian desktop by allowing the bundled inference runtime to select its supported local device.

## 0.3.0

- Added semantic-only live search with a short input debounce and latest-query scheduling.
- Keeps existing results visible until the next semantic result set is ready.
- Defers semantic phrase highlighting so it does not delay ranked results.
- Caches recent query vectors and results and scans a packed vector index.
- Uses WebGPU acceleration when available, with the bundled WebAssembly engine as fallback.

## 0.2.9

- Replaced the Node.js/npm worker with one bundled WebAssembly inference engine shared by desktop and mobile.
- Embedded the inference binary so startup no longer installs dependencies or downloads a runtime from a CDN.
- Restored desktop models, indexes, and diagnostic logs to the Gib Search plugin directory.
- Automatically restores data moved by 0.2.8 and removes obsolete runtime files and processes.
- Retained live progress and added 30-second index checkpoints to the in-process indexer.

## 0.2.8

- Moved desktop runtime dependencies, model files, indexes, and diagnostic logs to a device-local cache outside the vault.
- Moved mobile indexes and diagnostics to device-local browser storage.
- Migrates existing generated data with size verification before removing the old in-vault copies.
- Prevents vault sync plugins from uploading Gib Search models and other generated files.

## 0.2.7

- Isolated runtime dependencies from BRAT-managed plugin files to prevent locked or partially removed installs.
- Stops superseded workers during reload instead of adopting outdated processes.
- Removes obsolete runtime code and dependencies while preserving models and indexes.
- Reports signed npm error details instead of opaque Windows exit numbers.

## 0.2.6

- Moved result thumbnails to the left of snippet text while preserving the quote rail position.

## 0.2.5

- Added compact thumbnails for local images associated with search-result passages.
- Added optional external image thumbnails, disabled by default for privacy and performance.
- Chooses the image nearest the query-relevant text and opens thumbnails on click.

## 0.2.4

- Detects stale or unexpectedly stopped index workers instead of showing indefinite indexing.
- Saves resumable index checkpoints every 30 seconds during large first builds.
- Adds optional verbose diagnostic logging with per-file size, chunk count, timing, lifecycle, checkpoint, and error details.

## 0.2.3

- Fixed first-run runtime installation on Windows with Node.js 24.

## 0.2.2

- Added live indexing phases, exact file progress, elapsed time, current-file feedback, and last-success timestamps.
- Added index and model-cache storage reporting plus a visible retry action when startup fails.
- Improved pause and restart behavior while preserving completed indexes.

## 0.2.1

- Fixed release packaging for the bundled mobile runtime.

## 0.2.0

- Added native Obsidian Mobile support using local BGE inference through WebAssembly.
- Added a mobile-safe, per-device semantic index with automatic note-change updates.
- Kept the existing Node.js worker on desktop for faster indexing.
- Made search, semantic highlighting, settings health, and the similarity graph available on mobile.

## 0.1.2

- Removed stale internal terminology from the packaged worker.
- Expanded public-release checks for legacy project text.

## 0.1.1

- Standardized indexing and search on BGE Small English v1.5.
- Removed the model selector and model-specific settings split.
- Preserved existing BGE indexes and tuning during migration.

## 0.1.0

- Initial public beta.
- Local semantic search with BGE Small English v1.5.
- Ranking and highlighting controls.
- Folder-path ranking boost.
- Multi-passage result cards and similarity graph.
- BRAT-compatible first-run runtime setup.
