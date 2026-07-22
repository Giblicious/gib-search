# Security

Please report security issues privately through GitHub's security advisory form for this repository. Do not open a public issue for an unpatched vulnerability.

Gib Search reads Markdown and text files from the active vault and keeps generated indexes on the current device. Inference uses a bundled WebAssembly runtime; desktop runs it in a local worker thread and mobile runs it within the WebView. Desktop data stays within the plugin directory; mobile data uses device-local WebView storage. Runtime dependencies are pinned by the repository lockfile.

Before reporting an unexpected network request, note that BGE Small English v1.5 is downloaded from Hugging Face on first use. The inference runtime is bundled and does not use npm or a runtime CDN.
