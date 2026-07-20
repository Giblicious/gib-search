# Security

Please report security issues privately through GitHub's security advisory form for this repository. Do not open a public issue for an unpatched vulnerability.

Gib Search reads Markdown and text files from the active vault, writes generated models and indexes inside its plugin directory, and binds its search service to the loopback interface only. Runtime dependencies are pinned by `worker/package-lock.json`.

Before reporting an unexpected network request, note that first-run setup downloads the pinned runtime from npm and the selected embedding model from Hugging Face.
