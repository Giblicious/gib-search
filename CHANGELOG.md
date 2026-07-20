# Changelog

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
