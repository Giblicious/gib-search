# Changelog

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
