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
  }

  /**
   * Set the HTTP port (called once after server starts listening).
   * All subsequent status writes will include it.
   */
  setHttpPort(port) {
    this.httpPort = port;
    // Re-write current status with port
    this.write(this._lastPhase || 'starting');
  }

  /**
   * Write current status to disk.
   * @param {string} phase
   * @param {object} [details]
   */
  write(phase, details = {}) {
    this._lastPhase = phase;

    const status = {
      phase,
      pid: process.pid,
      httpPort: this.httpPort,
      startedAt: this.startTime,
      updatedAt: Date.now(),
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
    this.write('starting');
  }

  downloadingModel() {
    this.write('downloading_model', {
      message: 'Downloading embedding model (~270MB, first run only)...',
    });
  }

  loadingModel() {
    this.write('loading_model', {
      message: 'Loading embedding model...',
    });
  }

  indexing(fileCount, totalFiles) {
    this.write('indexing', {
      message: `Indexing vault... (${fileCount}/${totalFiles} files)`,
      fileCount,
      totalFiles,
    });
  }

  ready(indexedFiles, totalChunks) {
    this.write('ready', {
      message: `Ready (${indexedFiles} files, ${totalChunks} chunks indexed)`,
      indexedFiles,
      totalChunks,
    });
  }

  error(errorMessage) {
    this.write('error', {
      message: errorMessage,
    });
  }
}
