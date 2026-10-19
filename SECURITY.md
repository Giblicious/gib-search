# Security

Please report security issues privately through GitHub's security advisory form for this repository. Do not open a public issue for an unpatched vulnerability.

Gib Search reads included Markdown and text files from the active vault and keeps generated indexes on the current device. Other included vault files are indexed by filename without reading their binary content. Index scope rules can exclude folders and file types. Inference runs in a background worker using desktop WebGPU when available or the bundled WebAssembly runtime; mobile indexing remains in its WebView worker.

Downloaded models remain inside the desktop plugin directory. The semantic index, writing-profile caches, and diagnostic log use a vault-keyed operating-system cache outside the vault. Mobile-generated data uses device-local WebView storage. The optional mobile bootstrap feature deliberately writes a mobile-compatible package into the configured vault folder for the user's sync tool to carry; it is disabled by default.

Hugging Face supplies BGE Small English v1.5 when uncached. Optional Writing Profile indexing also downloads MobileBERT MNLI. Search in the current file lazily downloads the q8 MS MARCO TinyBERT L2 passage reranker. All inference remains local after download; note content, queries and embeddings are not sent to those services. The experimental Atlas surfaces and their topic-label preparation remain disabled.

The inference runtime is bundled and does not use npm or a runtime CDN. External image thumbnails are disabled by default; enabling them permits fetching image URLs referenced by notes. Runtime dependencies are locked, including packages declared as development dependencies that are incorporated into the browser bundle. Release checks audit the entire dependency tree rather than treating `npm audit --omit=dev` as a browser-runtime security assessment.

The native `sharp` and Node proxy-agent packages are development-only dependencies of Transformers.js and are excluded by the browser build conditions. Their patched versions are enforced with explicit overrides so the Node-based local and CI inference harness is covered too.
