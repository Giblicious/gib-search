# Changelog

## 0.43.0

- Replaces repeated global Atlas projection with a live particle field driven directly by cached note-to-note qualities.
- Evaluates every pair across short rolling sweeps so full-vault Views remain interactive without reducing the map to a permanent neighbor sample.
- Makes query relevance a center spring while query-conditioned residual meaning organizes notes around it without fixed angular categories.
- Lets Relationship field, Dynamics, and Cartography controls update the full live preview immediately instead of rebuilding the territory on every adjustment.
- Warms the nonsemantic profiles used by saved Views after indexing and updates their content-fingerprinted cache only for notes whose content changes.
- Removes the expensive multi-pass overlap solve from force-field scenes while retaining collision safety and a dedicated Links simulation.

## 0.42.0

- Rebuilds the Atlas View editor around Territory, Reference frame, Relationship field, Dynamics, and Cartography, with a live preview throughout.
- Blends Meaning, Emotion, Purpose, Position, Form, and authored Links into one normalized distance model before layout and physics.
- Adds free, centered, constellation, and two-pole reference frames without requiring categories to determine the underlying landscape.
- Expands emotional analysis from broad buckets to a continuous 24-landmark affect profile, including nuanced states such as longing, grief, despondency, anxiety, frustration, indignation, guilt, and determination.
- Separates visual encoding from placement, allowing emotional color or profile intensity terrain without silently changing graph physics.
- Migrates existing saved Views to the equivalent relationship field and removes stale controls from earlier View-builder experiments.

## 0.41.0

- Adds distinct Meaning, Emotion, Purpose, Position, and Form signals to the Atlas View builder.
- Keeps meaning on BGE embeddings while using local passage-level inference for expressed emotion, writing purpose, and position toward a claim.
- Combines inference with document structure for more reliable writing-form classification.
- Adds a required reference claim and direct entailment/contradiction analysis to Position Views.
- Caches content-fingerprinted text profiles, checkpoints bounded analysis batches, and reports analysis progress without slowing ordinary search or indexing.
- Grounds map classifications in representative source passages shown on hover.
- Removes the misleading embedding-only emotion, writing-mode, and project-state presets and their stale controls.

## 0.40.0

- Replaces the experimental Atlas View settings with a dedicated three-stage builder and live map preview.
- Turns categorical Views into calibrated multi-anchor semantic fields, allowing notes to match several ideas and settle naturally between them.
- Adds semantic, radial, and directly draggable manual arrangements for category gravity points.
- Adds folder, tag, property, lens, and anchor scope controls alongside category descriptions, keywords, example notes, and individual gravity strength.
- Adds controls for category color, file-size or uniform dots, density terrain, category regions, contrast, cohesion, and unclaimed notes.
- Adds direct View editing from the Atlas toolbar and a compact saved-View manager in settings.

## 0.39.0

- Adds saved Atlas Views with reusable folder, exclusion, tag, lens, and anchor settings.
- Adds guided semantic reference frames: editable category beacons place notes by soft membership, allowing notes to sit between categories instead of becoming hard buckets.
- Includes local templates for emotional tone, writing mode, theological inquiry, and project state.
- Supports optional example notes for teaching each category with material already in the local semantic index.
- Adds a compact View switcher to the Atlas while preserving Natural landscape as the default.

## 0.38.0

- Reimagines the Atlas as a clean center workspace instead of a graph surrounded by internal panels.
- Moves ranked search navigation into a native Obsidian left-sidebar Atlas Navigator and keeps semantic note context in the native right-sidebar Companion.
- Opens the Atlas workspace with both native companions available while preserving their normal Obsidian collapse behavior.
- Adds progressive semantic zoom from vault to region, neighborhood, and note scales.
- Introduces stable community landmarks, map-scale label disclosure, and quieter background notes so the vault reads as geography instead of a uniform dot cloud.
- Reduces community boundaries, manual links, and regional labels until they become useful through focus or zoom.

## 0.37.0

- Rebuilds the dedicated Atlas as one continuous sheet with quiet results and note-annotation margins instead of layered overlays.
- Makes the graph renderer reserve and animate around visible margins, keeping nodes, terrain, zoom, and dragging centered in the actual open field.
- Changes result selection to preview first: single-click selects and annotates, while double-click or Enter opens the note.
- Uses a single bottom margin on narrow screens so results and note content never compete for the map.
- Reduces the search field to a clean coordinate line and removes the previous directional panel fades.

## 0.36.1

- Integrates the dedicated Atlas results and note-preview regions into the landscape instead of presenting them as floating glass cards.
- Removes enclosing borders, rounded containers, shadows, and backdrop blur from both regions.
- Uses quiet rules and directional canvas-colored fades to preserve readability while allowing the graph to flow naturally beneath their edges.
- Softens result hover treatment and spacing so text, nodes, and terrain feel drawn on one continuous surface.

## 0.36.0

- Replaces the old note-neighborhood widget with an adaptive Atlas Companion in Obsidian's native right sidebar.
- Splits the Companion into a resizable visual neighborhood above and a ranked relationship list below.
- Follows the active editor note automatically and supports pinning a context in place.
- Turns the Companion into a semantic loupe while the main Atlas is active, following hover temporarily and locking to selected notes.
- Inherits the main Atlas View, scope, and lens instead of producing an independent interpretation.
- Shares hover state between the visual neighborhood and relationship list.

## 0.35.0

- Introduces a canonical Atlas state built from a saved View, declarative scope, active anchor, lens, and semantic scale.
- Routes vault, query, and active-note maps through one cached Atlas scene engine so every surface receives the same coordinates, relationships, terrain inputs, results, and legend semantics.
- Adds folder, exclusion, tag, property, and file-type rules to saved View scopes without changing the local semantic index.
- Keeps first-time searches fluid with an immediate provisional scene while the refined scene is calculated and cached.
- Reduces the primary Atlas to its search field and landscape; results and note previews now appear only when they are relevant.
- Removes the primary view's experimental scope, grouping, tuning, generation, link, viewport, collapse, and preview action controls.

## 0.5.12

- Removes all terrain, heatmap, contour, ridge, and connecting-line rendering from semantic maps.
- Leaves a clean force-directed field containing only the query, note nodes, and restrained labels.
- Refines note-to-note springs using overall similarity while signed residual similarity adds meaningful separation.
- Scales collision distance with visible node size for more natural spacing.
- Makes hover emphasis reveal related notes through opacity without drawing connections.
- Removes all raster-field work from map animation for a lighter, more responsive interaction.

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
