const SEARCH_RESULT_OPEN_MODE = Object.freeze({
  CURRENT: 'current',
  TAB: 'tab',
  WINDOW: 'window',
  SPLIT: 'split',
});

function searchResultOpenMode(event = {}) {
  if (event.shiftKey) return SEARCH_RESULT_OPEN_MODE.WINDOW;
  if (event.ctrlKey || event.metaKey) return SEARCH_RESULT_OPEN_MODE.TAB;
  if (event.altKey) return SEARCH_RESULT_OPEN_MODE.SPLIT;
  return SEARCH_RESULT_OPEN_MODE.CURRENT;
}

function searchResultLeafTarget(mode, isMobile = false) {
  if (mode === SEARCH_RESULT_OPEN_MODE.CURRENT) return false;
  if (isMobile && (mode === SEARCH_RESULT_OPEN_MODE.WINDOW || mode === SEARCH_RESULT_OPEN_MODE.SPLIT)) return 'tab';
  if (mode === SEARCH_RESULT_OPEN_MODE.TAB) return 'tab';
  if (mode === SEARCH_RESULT_OPEN_MODE.WINDOW) return 'window';
  if (mode === SEARCH_RESULT_OPEN_MODE.SPLIT) return 'split';
  return false;
}

export { SEARCH_RESULT_OPEN_MODE, searchResultLeafTarget, searchResultOpenMode };
