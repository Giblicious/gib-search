# Performance contract

Gib Search treats responsiveness and index integrity as release requirements.

`npm run check` enforces deterministic synthetic ceilings for:

- replacing 1,200 files inside a 40,000-record index without per-file whole-index rebuilding;
- scanning 25,000 packed 384-dimensional passage vectors;
- twenty warm hybrid lexical candidate searches across 20,000 documents;
- bounded runtime timing histories that cannot grow without limit.

Runtime diagnostics retain only local, aggregate timing samples. They include rolling median, 95th-percentile, and maximum search, index-update, commit, and persistence times. No note content or telemetry leaves the device.

Mobile indexing remains single-passage inference, waits for quiet UI turns, pauses while Obsidian is backgrounded, commits work in bounded groups, and persists a checkpoint before suspension or shutdown. Desktop indexing scales inference to detected hardware while keeping interactive worker requests ahead of background indexing.
