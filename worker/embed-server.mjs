/**
 * BC Embed Server — HTTP server for semantic search over an Obsidian vault.
 *
 * Runs as a long-lived child process of the plugin (not the SDK).
 * Provides HTTP endpoints for search and status.
 * The agent's semantic_search tool is served via an in-process SDK MCP server
 * in the plugin, which proxies to this HTTP server.
 *
 * Usage:
 *   node embed-server.mjs --vault <path> --models <path> --index <path>
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

import { EmbeddingEngine } from './lib/engine.mjs';
import { VaultIndexer } from './lib/indexer.mjs';
import { StatusWriter } from './lib/status.mjs';
import { VaultWatcher } from './lib/watcher.mjs';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const VAULT_PATH = args.vault;
const MODELS_PATH = args.models;
const INDEX_PATH = args.index;
const MODEL_PROFILE = args.model || 'nomic';

if (!VAULT_PATH || !MODELS_PATH || !INDEX_PATH) {
  process.stderr.write(
    'Usage: node embed-server.mjs --vault <path> --models <path> --index <path>\n'
  );
  process.exit(1);
}

for (const dir of [MODELS_PATH, INDEX_PATH]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Initialize components
// ---------------------------------------------------------------------------

const status = new StatusWriter(INDEX_PATH);
const engine = new EmbeddingEngine(MODELS_PATH, MODEL_PROFILE);
const indexer = new VaultIndexer(engine, VAULT_PATH, INDEX_PATH);
const watcher = new VaultWatcher(VAULT_PATH, indexer);

// Update status.json whenever the index changes (live re-indexing)
indexer.onIndexChanged = ({ indexedFiles, totalChunks }) => {
  status.ready(indexedFiles, totalChunks);
};

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/search') {
      const query = url.searchParams.get('q');
      if (!query) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing q parameter' }));
        return;
      }

      const topK = parseInt(url.searchParams.get('top_k') || '10', 10);
      const minScore = parseFloat(url.searchParams.get('min_score') || '0.3');
      const scoreWindow = parseFloat(url.searchParams.get('score_window') || '1');
      const folderBoost = Math.min(0.2, Math.max(0, parseFloat(url.searchParams.get('folder_boost') || '0') || 0));
      const includeHighlights = url.searchParams.get('semantic_highlights') === '1';
      const clamp = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
      const highlightOptions = includeHighlights ? {
        resultMinScore: clamp(url.searchParams.get('highlight_result_min'), 0.6, 0, 1),
        singleWordMinScore: clamp(url.searchParams.get('highlight_word_min'), 0.65, 0, 1),
        phraseMinScore: clamp(url.searchParams.get('highlight_phrase_min'), 0.3, 0, 1),
        maxPhrases: Math.round(clamp(url.searchParams.get('highlight_max'), 3, 1, 5)),
      } : null;
      const fileFilter = url.searchParams.get('file') || null;

      const results = await indexer.search(query, topK, minScore, highlightOptions, fileFilter, scoreWindow, folderBoost);
      res.writeHead(200);
      res.end(JSON.stringify({ results }));
      return;
    }

    if (url.pathname === '/graph-edges') {
      const k = parseInt(url.searchParams.get('k') || '5', 10);
      const maxEdges = parseInt(url.searchParams.get('max_edges') || '2000', 10);
      const useDict = url.searchParams.get('use_dict') === '1';
      const mutual = url.searchParams.get('mutual') === '1';

      const result = indexer.getFileEdges(k, maxEdges, useDict, mutual);
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === '/query-file-scores') {
      const query = url.searchParams.get('q');
      if (!query) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing q parameter' }));
        return;
      }

      const scores = await indexer.queryFileScores(query);
      res.writeHead(200);
      res.end(JSON.stringify({ scores }));
      return;
    }

    if (url.pathname === '/similar') {
      const file = url.searchParams.get('file');
      if (!file) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing file parameter' }));
        return;
      }
      const topN = parseInt(url.searchParams.get('top_n') || '20', 10);
      const results = indexer.getSimilarFiles(file, topN);
      res.writeHead(200);
      res.end(JSON.stringify({ results }));
      return;
    }

    if (url.pathname === '/status') {
      const idx = indexer.getStatus();
      res.writeHead(200);
      res.end(JSON.stringify({
        indexedFiles: idx.indexedFiles,
        totalChunks: idx.totalChunks,
        vaultFiles: idx.vaultFiles,
        staleFiles: idx.staleFiles,
        isIndexing: idx.isIndexing,
        modelLoaded: engine.isReady(),
        modelProfile: MODEL_PROFILE,
        modelId: engine.getModelId(),
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    process.stderr.write(`[gib-search] HTTP error: ${err.message}\n`);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main() {
  process.stderr.write(`[gib-search] Starting with vault: ${VAULT_PATH}\n`);
  status.starting();

  // Start HTTP server on random port
  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const port = httpServer.address().port;
      process.stderr.write(`[gib-search] HTTP server on 127.0.0.1:${port}\n`);
      status.setHttpPort(port);
      resolve();
    });
  });

  // Load model
  status.loadingModel();
  process.stderr.write(`[gib-search] Loading model: ${engine.getModelId()}\n`);

  const modelCacheDir = path.join(MODELS_PATH, engine.getModelId());
  if (!fs.existsSync(modelCacheDir)) {
    status.downloadingModel();
    process.stderr.write('[gib-search] Model not cached, downloading...\n');
  }

  await engine.initialize();
  process.stderr.write('[gib-search] Model loaded\n');

  // Build/load index
  const vaultFiles = indexer.scanVault();
  status.indexing(0, vaultFiles.size);
  await indexer.initialize();
  const idxStatus = indexer.getStatus();
  process.stderr.write(`[gib-search] Index ready (${idxStatus.indexedFiles} files)\n`);

  // Start watching for changes
  watcher.start();
  process.stderr.write('[gib-search] Watching vault for changes\n');

  // Mark ready
  status.ready(idxStatus.indexedFiles, idxStatus.totalChunks);
  process.stderr.write('[gib-search] Ready\n');
}

main().catch((err) => {
  process.stderr.write(`[gib-search] Fatal: ${err.message}\n${err.stack}\n`);
  status.error(err.message);
  process.exit(1);
});
