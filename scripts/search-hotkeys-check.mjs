import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEARCH_RESULT_OPEN_MODE, searchResultLeafTarget, searchResultOpenMode } from '../src/search-result-open.js';

assert.equal(searchResultOpenMode({}), SEARCH_RESULT_OPEN_MODE.CURRENT);
assert.equal(searchResultOpenMode({ ctrlKey: true }), SEARCH_RESULT_OPEN_MODE.TAB);
assert.equal(searchResultOpenMode({ metaKey: true }), SEARCH_RESULT_OPEN_MODE.TAB);
assert.equal(searchResultOpenMode({ shiftKey: true }), SEARCH_RESULT_OPEN_MODE.WINDOW);
assert.equal(searchResultOpenMode({ altKey: true }), SEARCH_RESULT_OPEN_MODE.SPLIT);
assert.equal(searchResultOpenMode({ ctrlKey: true, shiftKey: true }), SEARCH_RESULT_OPEN_MODE.WINDOW, 'Shift must take precedence for the explicit new-window gesture');
assert.equal(searchResultLeafTarget(SEARCH_RESULT_OPEN_MODE.CURRENT), false);
assert.equal(searchResultLeafTarget(SEARCH_RESULT_OPEN_MODE.TAB), 'tab');
assert.equal(searchResultLeafTarget(SEARCH_RESULT_OPEN_MODE.WINDOW), 'window');
assert.equal(searchResultLeafTarget(SEARCH_RESULT_OPEN_MODE.SPLIT), 'split');
assert.equal(searchResultLeafTarget(SEARCH_RESULT_OPEN_MODE.WINDOW, true), 'tab', 'Mobile must not request an unsupported popout window');
assert.equal(searchResultLeafTarget(SEARCH_RESULT_OPEN_MODE.SPLIT, true), 'tab', 'Mobile must not request an unsupported split');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const modal = source.slice(source.indexOf('class SemanticSearchModal'), source.indexOf('class SemanticInNoteSearch'));
if (!modal.includes("event.key === 'Enter'") || !modal.includes("mode === SEARCH_RESULT_OPEN_MODE.CURRENT") || !modal.includes('selectedSearchResult()') || !modal.includes('searchResultLeafTarget(mode, this.plugin.isMobile)')) throw new Error('Vault-search modifier hotkeys are not wired through selected-result and workspace-target handling');
if (!modal.includes("command: 'Ctrl/Cmd+Enter'") || !modal.includes("command: 'Shift+Enter'") || !modal.includes("command: 'Alt+Enter'")) throw new Error('Vault-search modifier hotkeys are not discoverable in the prompt instructions');
if (!modal.includes("getLeaf('split', 'vertical')") || !modal.includes("closest?.('button, select, a')")) throw new Error('Right-split targeting or focused-control keyboard safety is missing');

console.log('Vault-search hotkey checks passed.');
