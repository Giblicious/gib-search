# Changelog

## 0.54.42

- Adds a compact MS MARCO cross-encoder reranker after high-recall BGE retrieval, then combines their relative ranks so exact shared words cannot overwhelm the meaning of the complete query.
- Reranks heading-aware sentences and compact source spans, preserving whole semantic units when relationships are distributed across a grammatical sentence.
- Keeps direct complete-term matches authoritative, uses explicit concept and negation evidence as hard-negative safeguards, and falls back cleanly to dense retrieval if the reranker is unavailable or disagrees without strong evidence.
- Loads the quantized reranker lazily in the background worker, caches bounded results, yields between small mobile batches, and leaves the vault index format and bulk-index workload unchanged.
- Extends the release audit with heading-resolved discourse, distributed relational context, stricter false-positive labels, and repeatable multi-query checks against a supplied note.

## 0.54.41

- Compares each candidate against the complete query and its individual concepts, rejecting shared-entity fragments such as `say that God` for `child of god` while retaining relational paraphrases such as `offspring of God`.
- Searches a bounded beam of strong sentences and compact two-to-seven-word spans, with per-sentence candidate reservations so a misleading top sentence cannot hide a better passage elsewhere in the note.
- Preserves literal in-file queries, distinguishes intensity modifiers from their semantic heads, recognizes exact times in Markdown rules, and keeps compact source wording when scores tie.
- Adds a real-model release gate covering balanced and broad search, q8 production inference, positive paraphrases, and explicit hard negatives; developers can also audit an arbitrary note and query with the same harness.

## 0.54.40

- Prioritizes compact passages containing every meaningful query term even when the wording is reordered or possessive, such as `gods power` matching `power of God`.
- Prevents generic phrase-generation limits from discarding obvious query-anchored wording before semantic scoring.
- Requires stronger evidence from phrases with only partial or no query-term coverage, suppressing loose topical highlights when a complete concept match exists.

## 0.54.39

- Makes in-file semantic highlighting search every sentence in ordinary passages, then refine strong sentences into conservative grammatical clauses and short exact source phrases.
- Keeps clause analysis out of the vault-wide index, with content-fingerprinted local caches and persistent phrase vectors for fast repeat searches without increasing bulk-index cost.
- Rejects weak local matches relative to the strongest result, bounds pathological passages, and cancels superseded work between stages to reduce noise and keep editing responsive.

## 0.54.38

- Gives the in-file search glyph and semantic activity spinner one fixed leading status slot, preventing overlap with the query and result count.
- Replaces the search glyph in place while semantic work is running instead of adding a second inline indicator that can wrap.
- Suppresses Obsidian and browser-provided duplicate search decorations while preserving the plugin's accessible clear control.

## 0.54.37

- Removes the residual native Obsidian focus border and shadow from the compact in-file search input so it behaves like the primary search prompt.
- Uses Obsidian's theme-controlled large and small corner-radius variables for both search surfaces, prompt corners, and toolbar buttons.
- Keeps keyboard focus behavior, caret visibility, semantic loading feedback, and the centered sticky placement intact.

## 0.54.36

- Restyles the compact in-file search card to match Gib Search's primary modal surface, prompt input, spacing, border, and elevation.
- Brings navigation and power controls into the modal's flat icon-button and quiet underlined toolbar language.
- Preserves the centered sticky, non-blocking editor placement across native Obsidian, Butter Editor, and mobile.

## 0.54.35

- Replaces the full-width in-file search strip with a compact sticky card centered at the top of native and Butter editors.
- Keeps advanced exact and meaning controls inside the same card without stretching its chrome across the editor.
- Shows an accessible animated activity indicator while semantic results are being computed, including reduced-motion support.

## 0.54.34

- Prevents weak sentence-level semantic fallbacks from appearing when the query already has a strong local phrase match elsewhere in the note.
- Applies stricter, globally capped sentence fallbacks only when phrase refinement finds nothing, reducing false positives for short semantic queries.
- Keeps the active semantic result purple and the active lexical result yellow so navigation no longer makes semantic matches look lexical.
- Adds regression coverage for suppressing an unrelated sentence while preserving the strong “more study” to “further study” match.

## 0.54.33

- Replaces the in-file toolbar presentation with a compact centered find console inside the full-width editor strip and an attached power-controls shelf.
- Adds local phrase refinement after passage and sentence retrieval so strong paraphrases are highlighted directly instead of being diluted by their surrounding sentence.
- Calibrates the concrete query “more study” to recover “further study,” where the local BGE model measures a strong 0.883 similarity.
- Prefers concise semantic phrases when they are confident and falls back to a related sentence only when no local phrase clears the selected precision level.
- Adds a regression test for local paraphrase selection and guards the alternate compact UI layout.

## 0.54.32

- Corrects Butter Editor layout so the outer find strip spans the full editor while the search controls retain Obsidian's centered readable width.
- Replaces unreliable concept-only in-file semantic matches with a two-stage search that ranks indexed passages and then the actual sentences inside the strongest passages.
- Uses cached sentence vectors, cancellable live queries, and breadth-specific limits so semantic refinement remains responsive on desktop and mobile.
- Preserves raw Markdown and rendered-text variants of semantic findings so highlights and navigation work in both Obsidian source mode and Butter Editor.
- Adds regression coverage for sentence selection, Markdown-aware semantic highlighting, and the full-width-strip/native-width-control layout.

## 0.54.31

- Polishes Search current file into a smoother hybrid find experience with immediate exact results and non-disruptive semantic enrichment.
- Adds optional power controls for Exact and Meaning search, match case, whole words, and precise, balanced, or broad semantic range.
- Separates exact and semantic highlight channels so meaning-based findings are visually distinct, while making the current finding clearer.
- Makes the Butter Editor search bar full-width and balanced across attached and detached toolbar layouts, including responsive mobile controls.
- Tightens semantic passage selection to avoid broad, noisy highlights and preserves the active finding as semantic results arrive.

## 0.54.30

- Fixes Search current file in Butter Editor when Butter's `contentEl` is itself the editor surface, including the default attached top-toolbar layout.
- Prevents the search bar from trying to insert itself before its own parent element, which previously raised a DOM `NotFoundError` before anything became visible.
- Adds a release regression gate for Butter's real self-hosted editor topology while preserving detached-toolbar placement below Butter's toolbar stack.

## 0.54.29

- Detects and reports partial BRAT installations whose manifest and executable bundle versions do not agree, rather than allowing commands to fail silently.
- Routes every Search current file entry point through visible error reporting so unexpected editor-mount failures produce an actionable notice and diagnostic entry.
- Keeps recovery styling for the older in-file-search markup so the control remains visible if BRAT updates the stylesheet before replacing the large executable bundle.

## 0.54.28

- Rebuilds Search current file with Obsidian's native document-search structure, input treatment, match counter, clear control, navigation buttons, no-match state, spacing, and responsive behavior.
- Places search in the editor's document-search row instead of a floating card that covers content.
- Keeps the search row below Butter Editor's top toolbar in attached, detached, and integrated layouts, above bottom toolbars, and automatically repositions it when Butter's toolbar settings change.

## 0.54.27

- Replaces the Search current file modal with a compact native-style find bar attached to the active editor.
- Shows exact lexical matches immediately, then enriches the same result set with semantically related phrases and passages without discarding lexical results if semantic retrieval is unavailable.
- Highlights every finding directly in the document, supports next/previous navigation, and preserves the active result while semantic matches arrive.
- Supports both Obsidian's CodeMirror editor and Butter Editor's ProseMirror surface without modifying document content.

## 0.54.26

- Adds a Search current file command that performs hybrid lexical and semantic passage retrieval inside the active Markdown note.
- Adds Search current file to the editor context menu and Search within file to Markdown file context menus on desktop and mobile.
- Shows the fixed file scope and Words + meaning mode in the search modal, highlights exact query wording alongside semantic phrases, and exposes lexical contribution in score details.
- Applies the file constraint before retrieval and ranking so matching passages from other vault files cannot leak into in-file results.

## 0.54.25

- Adds a compact profile bloom above the Writing Profile assessment, using independent radial petals to visualize meaningful Purpose, Form, and Emotion scores without implying relationships between adjacent dimensions.
- Limits the bloom to above-threshold findings and leaves abstained sectors visibly empty, keeping the visualization consistent with the panel's reliability rules.
- Adds exact-score hover labels, a complete screen-reader description, responsive sizing, theme-derived colors, and a reduced-motion fallback.

## 0.54.24

- Restyles Writing Profile to use the same flat, quiet visual language as Gib Search results and Similar Notes, removing bespoke gradients, colored cards, and badge treatments.
- Replaces every fixed Writing Profile text size with Obsidian UI font tokens and keeps all panel text at the readable small UI size or larger.
- Enlarges interactive disclosure and settings controls, with consistent hover and keyboard-focus states.

## 0.54.23

- Replaces the Writing Profile radar charts with compact ranked cards and readable horizontal confidence bars designed for a narrow sidebar.
- Adds a predominant-profile summary that combines the note's clearest purpose and form while explicitly abstaining when no expressed emotion is supported.
- Distinguishes Strong, Moderate, Tentative, and Unclear classifications, with concise explanations for structural evidence, mixed findings, and insufficient evidence.
- Shows only meaningful predominant and secondary findings by default, while keeping every diagnostic score available in a closed Full analysis disclosure.
- Uses text-centered labels such as Persuasive purpose, Narrative form, and Grief-related expression so classifications describe the writing rather than the writer.

## 0.54.22

- Adds an optional, disabled-by-default mobile bootstrap package that desktop can build inside a configurable vault-relative folder for any existing sync tool to carry.
- Builds the package with mobile-sized passages and the exact q8 mobile embedding model, while reusing unchanged files from the prior package and keeping the work in the low-priority inference queue.
- Publishes immutable compressed segments and an atomic manifest with byte counts and SHA-256 hashes, so mobile ignores partial, corrupt, incompatible, or not-yet-synced packages.
- Lets mobile begin normal indexing when no package exists, then pause between files and merge a package that arrives later without overwriting newer local progress.
- Validates package entries against current note representations, imports only matching files, preserves locally indexed mismatches, and resumes normal indexing for the remainder.

## 0.54.21

- Runs desktop Writing Profile emotion, purpose, and form classification through the verified WebGPU/fp16 worker when available.
- Warms and validates the profile classifier before use, and automatically retries through the bundled q8 WASM engine if GPU initialization or inference fails.
- Keeps profile classification below semantic queries and indexing, and now admits queued higher-priority work between bounded low-priority classification batches.
- Keeps mobile on q8 WASM in its existing background worker and does not add system dependencies, installers, services, or native runtimes.
- Extends the isolated worker smoke test to verify normalized WebGPU output from both the semantic and profile models.

## 0.54.20

- Uses a verified high-performance WebGPU adapter for desktop BGE embeddings, with fp16 inference and bounded batches that can make practical use of modern discrete GPUs.
- Falls back automatically to the bundled q8 WASM engine when WebGPU is absent, initialization fails, or the GPU device is lost during inference; mobile remains on its existing conservative worker path.
- Waits for active keyboard, pointer, touch, and scrolling input to become quiet before dispatching another desktop indexing batch, while preserving interactive search priority.
- Reports the active WebGPU or WASM backend in local health diagnostics and adds an isolated browser-worker GPU smoke test without touching a real vault.
- Remains self-contained: no CUDA, Python, native service, driver, or system dependency is installed.

## 0.54.19

- Makes desktop semantic indexing hardware-aware, using additional WASM threads when Electron permits them while reserving CPU capacity for Obsidian.
- Batches passages across notes with adaptive latency and memory limits instead of paying one worker round trip and two idle waits for every passage.
- Keeps desktop indexing productive while Obsidian is hidden, shortens activity backoff, and preserves interactive search priority between bounded inference batches.
- Reads rebuild candidates in small groups, commits each completed file immediately, and writes periodic resumable checkpoints so a restart loses little completed work.
- Keeps mobile on its strict one-passage, single-threaded profile and adds regression coverage for hardware scaling, bounded batching, interruption recovery, and empty-note stability.

## 0.54.18

- Replaces vault-wide rescans after every edit with a coalesced dirty-file queue that reads, embeds, and retries only changed notes while preserving the last searchable copy on failure.
- Stores the mobile index in 64 independently updated buckets with transactional manifests and one-generation rollback, and delays/coalesces persistence so routine edits do not rewrite one giant index object.
- Adds incremental field-weighted BM25 retrieval alongside semantic similarity, including body phrases, headings, paths, and selected metadata, while preserving semantic ranking and filename-only attachment behavior.
- Renders ranked search results immediately and progressively enriches only the visible results with semantic phrase highlighting without changing their order or scroll position.
- Improves Similar Notes with asynchronously prepared multi-centroid note representations and diverse source-passage matching, avoiding mean-vector topic collapse and unnecessary sidebar graph work.
- Improves passage boundaries, revision-bundle overfetch and signature caching, quick-filter scopes, and beginning/end coverage for Writing Profile analysis.
- Serializes all worker inference through an interactive-first priority queue, removes the synchronous `compromise` parser from the runtime, and adds indexing, retrieval, recovery, relevance, and performance regression checks.

## 0.54.17

- Uses explicit `type`, `form`, `kind`, and note-type frontmatter as first-class writing-form evidence, including reliable recognition of essays, journals, conversations, reference notes, narratives, and outlines.
- Makes Analytical essay dominant for declared essays while retaining genuinely reflective Journal writing as a bounded secondary finding.
- Requires chronological cues plus event language for Narrative, so logical uses of words such as “then” no longer turn analytical prose into a story.
- Separates dated filenames from journal-folder evidence and removes bare logical connectives as automatic proof of persuasive purpose.
- Grounds structural findings in the metadata, headings, or passages that caused them and invalidates older profile caches so corrected assessments rebuild automatically.
- Defers a note when Obsidian's metadata cache is still loading, avoiding a premature profile without rereading the note or delaying semantic search.

## 0.54.16

- Calibrates Writing Profile scores instead of presenting raw NLI entailment as confidence.
- Allows emotion, purpose, and form to abstain with a neutral radar state when a note does not contain enough reliable evidence for a finding.
- Adds an explicit emotion-applicability gate so schedules, instructions, reference material, and other neutral structures do not inherit spurious negative emotions.
- Makes form and purpose structure-aware: schedules, rules, checklists, and action lists establish Planning and Outline without letting weak model guesses overpower clear Markdown evidence.
- Suppresses unsupported Narrative classifications when strong outline structure is present, while retaining explicit emotional writing and genuinely narrative prose.
- Invalidates older profile caches so enabled devices rebuild the corrected profiles politely in the background.

## 0.54.15

- Adds an optional persistent Writing Profile index for emotion, purpose, and writing form, disabled by default.
- Adds an active-note companion sidebar with stable radar charts, top findings, evidence strength, and expandable evidence passages.
- Reuses content fingerprints and indexed passages so unchanged notes load from cache and only changed notes return to the analysis queue.
- Keeps profile work behind semantic indexing and live search, prioritizes the active note, runs one note and one signal at a time, uses worker-only mobile inference, and yields between low-priority model batches.
- Checkpoints the compact profile cache separately and updates it across note changes, renames, and deletions without delaying semantic search readiness.

## 0.54.14

- Replaces raw Markdown in the similar-to-selection sidebar header with a short plain-text preview.
- Keeps the original selection intact for semantic matching while stripping display-only formatting, links, embeds, and callout markers.

## 0.54.13

- Adds keyword and compact-phrase highlighting to Similar Notes and Find similar to selection results.
- Reuses indexed highlight candidates so the sidebar does not add embedding work, note reads, or indexing activity.
- Respects the existing Semantic highlighting setting and maximum-phrases preference.

## 0.54.12

- Adds **Find similar to selection** to the editor context menu when text is selected.
- Reuses the Similar Notes sidebar for temporary passage-level results without reindexing or persisting the selection.
- Adds Back and Close controls to return to the normal active-note view and keeps quick filters available in selection mode.

## 0.54.11

- Gives Search-modal quick filters a quieter tab-style treatment that fits the modal toolbar.
- Keeps the compact filled-button styling in Similar Notes unchanged.

## 0.54.10

- Restores the active visual state when Similar Notes rebuilds its filter bar after applying a filter.
- Keeps `aria-pressed` and the visible active class synchronized on both initial render and later selection changes.

## 0.54.9

- Keeps Similar Notes anchored to its current note when its sidebar filter controls receive focus.
- Makes normal filter clicks exclusive toggles and reserves Shift-click for additive OR selection.
- Removes inherited Obsidian borders, shadows, focus highlights, gradients, and filters from every quick-filter button state.

## 0.54.8

- Restyles quick-filter buttons as compact, flat controls that match the plugin's existing toolbars and tabs.
- Replaces pill outlines with subtle four-pixel corners and native hover/active backgrounds.

## 0.54.7

- Adds an enable/disable switch for every saved quick filter.
- Keeps disabled filter definitions intact while hiding them from Search and Similar Notes.
- Migrates existing quick filters as enabled so the new switch does not change current behavior.

## 0.54.6

- Adds optional custom quick-filter buttons shared by semantic search and Similar Notes.
- Filters candidates before ranking by folders, file kinds or extensions, tags, frontmatter properties, path text, and recent creation or modification dates.
- Combines selected buttons as OR while keeping each filter's conditions strict, and safely supports empty scopes without falling back to the whole vault.
- Caches metadata-only scopes and yields during vault scans so filtering does not add inference, file reads, or disruptive mobile work.

## 0.54.5

- Adds optional Iconic-aware result icons to semantic search and Similar Notes.
- Adds file, immediate parent, parent ×2, parent ×3, top-level folder, and nearest decorated folder modes.
- Defaults results to the top-level folder's resolved Iconic icon and color, with file-type and sticky-note fallbacks when Iconic is unavailable.

## 0.54.4

- Prevents Similar Notes from rebuilding when scrolling or merely moving focus between workspace leaves.
- Ignores index status notifications unless the underlying indexed data changed.
- Preserves the sidebar scroll position across legitimate same-note index refreshes.

## 0.54.3

- Redesigns Similar Notes with the same result-card hierarchy as semantic search, including folder paths, note similarity, passage excerpts, and passage relevance scores.
- Opens a related note at its strongest matching passage.
- Ranks passages cooperatively from existing vectors without rereading vault files or running new inference.

## 0.54.2

- Adds optional, folder-scoped revision bundling that keeps every edition searchable while showing one result per writing series.
- Detects revision ancestry from normalized dated titles, explicit series properties, or bounded textual-overlap signatures—never topical embedding similarity.
- Ranks a bundle by its strongest matching edition, opens the newest edition by default, preserves the older matching passage, and provides controls for opening the match or any edition.
- Adds a native Similar Notes sidebar that follows the active note and ranks neighbors from cached note vectors without vault reads or new inference.
- Keeps revision detection disabled by default and yields its bounded analysis work to Obsidian in small batches.

## 0.54.1

- Makes PDFs, images, audio, video, and every other vault attachment searchable by filename and path.
- Stores only lightweight filename metadata for non-text files without reading binary contents or running embedding inference.
- Ignores attachment content-modification events because binary changes cannot affect filename search, while create, rename, and delete events remain indexed.
- Opens attachment results through Obsidian using a file result that does not pretend to have a note-content snippet.

## 0.54.0

- Rebuilds the semantic index one note and one inference passage at a time instead of retaining the contents of every changed note in memory.
- Yields indexing work to Obsidian's idle periods, backs off while the user is typing or touching the interface, and pauses expensive progress while the app is in the background.
- Moves mobile indexing inference into a dedicated Web Worker, bounds mobile passages to 1,000 characters, and never falls back to blocking UI-thread inference for background work.
- Pauses mobile indexing with a clear health message if the device cannot provide background-worker support while preserving any previously searchable index.
- Makes pause and cancellation responsive between passages, coalesces vault changes into quieter update windows, and reduces high-frequency progress updates.
- Keeps completed checkpoint work private until a consistent index snapshot is ready, then retries notes that encounter transient read or inference failures.

## 0.53.0

- Temporarily disables Atlas, Search Map, Navigator, Companion, and View analysis while those features are redesigned.
- Stops automatic graph-evidence, topic-label, and writing-quality preparation so search does not pay graph-related startup or indexing costs.
- Keeps the Atlas implementation and saved settings intact for a later return.
- Retains local BGE semantic search, ranking, snippets, highlighting, folder-path boosting, and mobile support.

## 0.52.0

- Rebuilds map terrain as a multiscale relief model derived from the active View instead of drawing one rounded density hill around every note.
- Makes coherent regions form broad ranges, distinctive notes form anchored summits, positive relationships form ridges, and weak or negative boundaries form valleys and cliffs.
- Adds restrained hillshade, natural relief color, configurable contours, and terrain-derived rivers and lakes.
- Separates note arrangement from landscape elevation, so Meaning, Emotion, Purpose, Position, Form, Links, relevance, density, and distinctiveness can each shape a View without hijacking its layout.
- Reorganizes the View builder around Scope, Arrange notes by, Landscape, Anchors, Map marks, Territories, and Physics, with live controls for regional scale, relief, local detail, ridges, valleys, cliffs, passes, erosion, water, contours, and prominence.
- Builds terrain in stable world coordinates, uses adaptive working and settled resolutions, skips unchanged fields, and crossfades updates so pan, zoom, and live searches remain responsive.
- Adds numerical regression coverage for ridges, valleys, summit alignment, deterministic terrain, edge cases, basins, downhill drainage, and acyclic rivers.

## 0.51.0

- Replaces decorative community outlines with configurable topographic territories that participate in the force layout.
- Adds territory membership, minimum-size, separation, cohesion, padding, display, and label controls to every Atlas View.
- Adds a dynamic map key that names visible territories, shows their colors, and reports their note counts.
- Adds an Atlas signature to Companion with a five-axis quality compass and readable emotion, purpose, form, position, and link evidence.
- Makes resolved Atlas searches remove non-results instead of leaving a blurred sea of background dots.
- Keeps surrounding notes legible during hover and selection while emphasizing the selected note, its territory, and its strongest relationships.
- Removes the superseded boundary-repulsion experiment and migrates existing community-zone Views to the new territory renderer.

## 0.50.0

- Removes the legacy Similarity, Topics, and Links graph engines; every View now uses one force-directed relationship model.
- Replaces arbitrary quality-to-force rules with weighted relationship springs, optional idea anchors, and standard spring, charge, gravity, collision, and damping controls.
- Makes pure Emotion, Purpose, Position, and Form Views function without requiring Meaning to be enabled.
- Treats authored links as ordinary weighted springs instead of switching to a separate Link layout.
- Adds an expandable map key and makes community zones and labels independent visual mappings.
- Smooths live topography updates in the WebGL renderer and avoids blank community regions when a group lacks a dense core.

## 0.49.0

- Replaces overlapping Frame, Scale, and tuning controls with explicit Scope, Forces, Visuals, and Environment primitives.
- Adds composable vault filters for paths, filenames, extensions, tags, properties, authored links, dates, and file size.
- Adds ordered force recipes with relationship sources, force types, strengths, ranges, optional idea anchors, and automatic migration of existing Views.
- Adds visual mappings and an automatically derived map key for color, size, terrain, communities, labels, and link lines.
- Keeps neighborhoods inside a soft boundary by translating whole relationship groups rather than compressing their internal shape.
- Separates 20â€“40 Hz physics from interpolated 60 FPS drawing for smoother motion without increasing analysis cost.

## 0.48.0

- Compiles contrastive relationship matrices into compact spring, bridge, and targeted-separation edges before animation.
- Replaces repeated all-pair and local-only spacing work with Barnes–Hut global charge for faster, clearer neighborhood formation.
- Reinforces mutually distinctive relationships while retaining weaker one-sided bridges and degree-safe organic motion.
- Adds per-View Grouping, Separation, Selectivity, Mutual boost, Bridge pull, and Response speed controls directly to the Atlas.

## 0.47.0

- Replaces raw pair distances with a scope-relative contrastive field that removes each note's ordinary relationship baseline.
- Keeps only locally distinctive positive and negative relationships; the unremarkable middle now exerts no force.
- Lets exceptional similarity attract, exceptional dissimilarity separate, and genuinely unstructured notes remain as outliers.
- Drives vault terrain height from distinctive activity in the selected View and uses bounded local charge to keep neighborhoods spatially legible.
- Removes frozen force-field snapshots and continues the selected View at a bounded low-energy cadence with subtle ambient flow.

## 0.46.0

- Rebuilds non-Link View placement as a continuous pair-distance stress field instead of thresholded attraction and short-range repulsion.
- Blends every enabled quality into one desired note-to-note distance and applies complete, deterministic force sweeps.
- Preserves weak or uniform signals as weak evidence rather than stretching them into artificial extremes.
- Treats missing wikilinks as neutral and removes the circular corral that packed unrelated Views into evenly spaced disks.

## 0.45.1

- Fixes non-Link Atlas Views continuing to apply full relationship forces after settling, which made completed quality-aware maps appear to boil.
- Cools relationship forces with the simulation and preserves settled positions for subtle ambient motion.

## 0.45.0

- Splits plugin settings into compact Status, Search, Views, and Console pages.
- Replaces the ambiguous single health indicator with separate Search index, Atlas qualities, and Local models states.
- Shows structured Atlas-analysis progress so active quality work keeps the overall state visibly in progress.
- Adds a bounded live Console for indexing, model, Atlas-analysis, topic-label, relationship, and error activity.

## 0.44.0

- Replaces the separate Atlas View editor with compact, live controls directly on the Atlas.
- Introduces six universal standard Views: Meaning, Topics, Emotion, Purpose, Writing form, and Links.
- Uses the same selected View in the primary Atlas, search popup, Atlas Navigator, and Atlas Companion.
- Removes user-facing legacy lens and grouping controls so a View is the single reusable map recipe.
- Adds in-place territory, orientation, scale, arrangement, relationship, dynamics, beacon, and cartography controls with automatic saving, preset reset, and custom View creation.

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
