/**
 * VaultWatcher — watches the vault for file changes and triggers re-indexing.
 *
 * Uses Node.js fs.watch (recursive) with debouncing to avoid
 * excessive re-indexing on rapid file changes.
 */

import fs from 'fs';
import path from 'path';

// Debounce delay (ms) — wait for writes to settle before re-indexing
const DEBOUNCE_MS = 2000;

// Directories to ignore
const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.gib-search']);

// Extensions to watch
const WATCH_EXTENSIONS = new Set(['.md', '.txt', '.markdown']);

export class VaultWatcher {
  constructor(vaultPath, indexer) {
    this.vaultPath = vaultPath;
    this.indexer = indexer;
    this.watcher = null;
    this.pendingFiles = new Map(); // relativePath → timeout ID
  }

  start() {
    try {
      this.watcher = fs.watch(this.vaultPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Normalize path separators
        const normalized = filename.replace(/\\/g, '/');

        // Skip non-indexable paths
        if (this.shouldSkip(normalized)) return;

        this.debounce(normalized);
      });

      this.watcher.on('error', (err) => {
        process.stderr.write(`[gib-search] Watcher error: ${err.message}\n`);
      });
    } catch (err) {
      process.stderr.write(`[gib-search] Failed to start watcher: ${err.message}\n`);
    }
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear pending debounce timers
    for (const timeout of this.pendingFiles.values()) {
      clearTimeout(timeout);
    }
    this.pendingFiles.clear();
  }

  /**
   * Check if a path should be skipped.
   * @param {string} relativePath - Forward-slash separated relative path
   * @returns {boolean}
   */
  shouldSkip(relativePath) {
    // Check extension
    const ext = path.extname(relativePath).toLowerCase();
    if (!WATCH_EXTENSIONS.has(ext)) return true;

    // Check if any path segment is a skipped directory
    const segments = relativePath.split('/');
    for (const seg of segments) {
      if (SKIP_DIRS.has(seg)) return true;
    }

    return false;
  }

  /**
   * Debounce re-indexing for a file.
   * @param {string} relativePath
   */
  debounce(relativePath) {
    // Clear existing timer for this file
    const existing = this.pendingFiles.get(relativePath);
    if (existing) clearTimeout(existing);

    // Set new timer
    const timeout = setTimeout(() => {
      this.pendingFiles.delete(relativePath);
      this.handleChange(relativePath);
    }, DEBOUNCE_MS);

    this.pendingFiles.set(relativePath, timeout);
  }

  /**
   * Handle a file change after debounce.
   * @param {string} relativePath
   */
  async handleChange(relativePath) {
    const absPath = path.join(this.vaultPath, relativePath);

    if (fs.existsSync(absPath)) {
      process.stderr.write(`[gib-search] File changed: ${relativePath}\n`);
      await this.indexer.reindexFile(relativePath);
    } else {
      process.stderr.write(`[gib-search] File deleted: ${relativePath}\n`);
      this.indexer.removeFile(relativePath);
    }
  }
}
