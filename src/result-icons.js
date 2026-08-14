const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const AUDIO_EXTENSIONS = new Set(['3gp', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav']);

function ancestorPaths(filePath) {
  const parts = String(filePath || '').split('/').filter(Boolean); parts.pop(); const values = [];
  while (parts.length) { values.push(parts.join('/')); parts.pop(); }
  return values;
}

function resultIconTargets(filePath, source = 'iconic-top-level') {
  if (source === 'iconic-file') return [{ path: filePath, category: 'file' }];
  if (!source.startsWith('iconic-')) return [];
  const ancestors = ancestorPaths(filePath); if (!ancestors.length) return [];
  if (source === 'iconic-nearest') return ancestors.map(path => ({ path, category: 'folder' }));
  let selected = 0;
  if (source === 'iconic-top-level') selected = ancestors.length - 1;
  else { const match = source.match(/^iconic-parent-(\d+)$/); selected = Math.min(ancestors.length - 1, Math.max(0, Number(match?.[1] || 1) - 1)); }
  return [ancestors[selected], ...ancestors.slice(0, selected)].map(path => ({ path, category: 'folder' }));
}

function fileTypeResultIcon(filePath) {
  const extension = String(filePath || '').split('.').pop().toLowerCase();
  if (extension === 'pdf') return 'file-text';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'file-audio';
  if (extension === 'canvas') return 'layout-dashboard';
  if (extension && extension !== 'md') return 'file';
  return 'sticky-note';
}

function resolveIconicResult(iconic, filePath, source) {
  if (!iconic) return null;
  for (const target of resultIconTargets(filePath, source)) {
    try { const base = iconic.getFileItem?.(target.path), rule = iconic.ruleManager?.checkRuling?.(target.category, target.path), item = rule || base, icon = item?.icon || (rule ? item?.iconDefault : null); if (icon) return { icon, color: item?.color || null, target: target.path }; } catch {}
  }
  return null;
}

export { ancestorPaths, resultIconTargets, fileTypeResultIcon, resolveIconicResult };
