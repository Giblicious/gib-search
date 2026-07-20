/**
 * StatusWriter — writes a status.json file for the plugin to read.
 *
 * status.json is the only communication channel from worker → plugin.
 * It includes the HTTP port so the plugin knows where to send queries.
 */

import fs from 'fs';
import path from 'path';

const STATUS_FILE = 'status.json';

export class StatusWriter {
  constructor(indexPath) {
    this.indexPath = indexPath;
    this.statusPath = path.join(indexPath, STATUS_FILE);
    this.startTime = Date.now();
    this.httpPort = null;
    this._lastDetails = {};
    try {
      const previous = JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
      this.lastSuccessfulIndexAt = Number(previous.lastSuccessfulIndexAt) || null;
    } catch {
      this.lastSuccessfulIndexAt = null;
    }
  }

  /**
   * Set the HTTP port (called once after server starts listening).
   * All subsequent status writes will include it.
   */
  setHttpPort(port) {
    this.httpPort = port;
    this.write(this._lastPhase || 'starting', this._lastDetails);
  }

  /**
   * Write current status to disk.
   * @param {string} phase
   * @param {object} [details]
   */
  write(phase, details = {}) {
    if (phase !== this._lastPhase) this.phaseStartedAt = Date.now();
    this._lastPhase = phase;
    this._lastDetails = details;

    const status = {
      phase,
      pid: process.pid,
      httpPort: this.httpPort,
      startedAt: this.startTime,
      phaseStartedAt: this.phaseStartedAt || this.startTime,
      updatedAt: Date.now(),
      lastSuccessfulIndexAt: this.lastSuccessfulIndexAt,
      ...details,
    };

    try {
      if (!fs.existsSync(this.indexPath)) {
        fs.mkdirSync(this.indexPath, { recursive: true });
      }
      fs.writeFileSync(this.statusPath, JSON.stringify(status, null, 2));
    } catch (err) {
      process.stderr.write(`[gib-search] Failed to write status: ${err.message}\n`);
    }
  }

  starting() {
    this.write('starting', { message: 'Starting the local semantic indexer...' });
  }

  downloadingModel() {
    this.write('downloading_model', {
      message: 'Downloading BGE Small English v1.5 (first run only)...',
    });
  }

  loadingModel() {
    this.write('loading_model', {
      message: 'Loading embedding model...',
    });
  }

  indexing(fileCount, totalFiles, currentFile = '') {
    this.write('indexing', {
      message: currentFile
        ? `Indexing ${fileCount} of ${totalFiles}: ${currentFile}`
        : `Indexing vault... (${fileCount}/${totalFiles} files)`,
      fileCount,
      processedFiles: fileCount,
      totalFiles,
      currentFile,
    });
  }

  ready(indexedFiles, totalChunks, totalFiles = indexedFiles) {
    this.lastSuccessfulIndexAt = Date.now();
    this.write('ready', {
      message: `Ready (${indexedFiles} files, ${totalChunks} chunks indexed)`,
      indexedFiles,
      totalChunks,
      processedFiles: totalFiles,
      totalFiles,
      lastSuccessfulIndexAt: this.lastSuccessfulIndexAt,
    });
  }

  error(errorMessage) {
    this.write('error', {
      message: errorMessage,
      errorAt: Date.now(),
    });
  }
}
