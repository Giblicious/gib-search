# Security

Please report security issues privately through GitHub's security advisory form for this repository. Do not open a public issue for an unpatched vulnerability.

Gib Search reads Markdown and text files from the active vault and keeps generated indexes on the current device. Desktop search binds its local service to the loopback interface only. Mobile search runs in-process and stores its model in the WebView's browser cache. Runtime dependencies are pinned by the repository lockfiles.

Before reporting an unexpected network request, note that desktop first-run setup downloads the pinned runtime from npm, mobile downloads the WebAssembly runtime from jsDelivr, and both platforms download BGE Small English v1.5 from Hugging Face.
