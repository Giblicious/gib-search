# Performance contract

Gib Search treats responsiveness and index integrity as release requirements.

`npm run check` enforces deterministic synthetic ceilings for:

- replacing 1,200 files inside a 40,000-record index without per-file whole-index rebuilding;
- scanning 25,000 packed 384-dimensional passage vectors;
- twenty warm hybrid lexical candidate searches across 20,000 documents;
- segmented desktop persistence that rewrites only dirty buckets, omits filename-only zero vectors, and recovers the previous complete snapshot after corruption;
- bounded runtime timing histories that cannot grow without limit.
- complete one-file commits in a 25,000-passage index with realistic passage text, including lexical maintenance, without rereading unchanged passage text.

Lexical maintenance caches unchanged passage keys, path features and entity sets and adjusts per-file spelling counts and BM25 entries only for changed or deleted notes. Queries hold a consistent metadata/vector/lexical snapshot across cooperative yields. Vault-wide retrieval reserves result slots for distinct files before selecting their strongest passages; semantic ranking completes before the result list is displayed.

Runtime diagnostics retain only local, aggregate timing samples. They include rolling median, 95th-percentile, and maximum search, index-update, commit, and persistence times. No note content or telemetry leaves the device.

Mobile indexing remains single-passage inference, waits for quiet UI turns, pauses while Obsidian is backgrounded, commits work in bounded groups, and persists a checkpoint before suspension or shutdown. Desktop indexing scales inference to detected hardware while keeping interactive worker requests ahead of background indexing. Desktop checkpoints live outside the vault, use 1,024 stable file buckets, write only buckets affected by changed paths, and retain one rollback snapshot without duplicating unchanged segments.

In-note Meaning search prepares bounded paragraph windows (at most six sentence units and 900 characters) and sentence representations for the active note. Warm queries reuse these vectors and cached token representations for phrase attribution. Sentence verification starts with twelve distinct statements and continues through relevant tails or dense ties; repeated occurrences share their statement's checks. Answer-rich notes can expand beyond that initial batch. This is approximate semantic retrieval, so finite accuracy tests do not guarantee exhaustive matches on arbitrary text.

In 0.54.68, notes exceeding 48 sentence units prepare coarse blocks first; sentence encoding follows the query shortlist. Lexical candidates join dense candidates, and answer-rich/tied tails still expand. Small notes retain their previous retrieval path. Optional IndexedDB startup can delay inference by at most 750 ms. Desktop inference uses the release's own verified Node CPU process because Electron renderers can reject Node worker threads and Obsidian can disable RunAsNode. Its JSON/binary-envelope IPC works across different Electron and helper V8 versions.

The new release gate runs a real Electron renderer, the packaged CPU process and Chromium IndexedDB without pre-warming models or note vectors. On the Windows audit host, the 77,763-character synthetic note's first query took 7.17 seconds with model files already downloaded, including helper extraction from local release assets. The next query first needed an additional model and took 5.66 seconds. Seventeen subsequent short queries on three varied 6.1–6.7 KB notes and two heading traps took 72–984 ms; 80 independent occurrences were all found in 2.14 seconds. An identical completed query took about 1 ms. The complete fresh-query p95 including startup was 5.66 seconds. These figures exclude network downloads, typing debounce and UI paint, and are host-specific; first use is still not instant. The native path also passed in Electron 37; the permanent regression gate uses a current audited Electron dependency. No real vault was installed or modified for these checks.

Local 0.54.66 browser measurements on 19 October 2026 used separate CPU/WASM and WebGPU runs. Five warm queries on a varied 12,197-character technical note took 410–1,126 ms with WASM; five on a 1,650-character interview note took 92–552 ms with WebGPU embeddings. Provisional stages arrived after roughly 8–24 ms. These engine timings exclude the existing 180 ms typing debounce, UI paint frames, cold model startup, and note preparation. Cold preparation takes seconds and the first model download is a separate cost. Repeated-query cache hits are reported separately from fresh queries. Hardware, note structure, and candidate density affect results; these observations are not universal latency guarantees.

The browser smoke harness checks meaning, negation, relationship direction, complete source offsets, provisional shading, YAML-safe repeated occurrences, stable navigation, and final phrase spans on both backends. Run `npm run smoke:webgpu -- --benchmark` (add `--wasm` for the fallback engine); `--source=note.md` and quoted `--query=short wording` arguments select a separate note and query set.
