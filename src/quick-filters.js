const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba']);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm']);
const ARCHIVE_EXTENSIONS = new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'zip']);

function cleanList(values, transform = value => value) {
  const source = Array.isArray(values) ? values : String(values || '').split(',');
  return [...new Set(source.map(value => transform(String(value).trim())).filter(Boolean))];
}

function normalizedPath(value) { return String(value || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''); }
function filterId(value = 'filter') { return `${String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'filter'}-${Date.now().toString(36)}`; }

function normalizePropertyRule(rule) {
  const key = String(rule?.key || '').trim(); if (!key) return null;
  const operator = ['exists', 'equals', 'not-equals', 'contains'].includes(rule.operator) ? rule.operator : 'equals';
  return { key, operator, value: String(rule?.value ?? '').trim() };
}

function normalizeQuickFilter(filter = {}, index = 0) {
  const name = String(filter.name || `Filter ${index + 1}`).trim() || `Filter ${index + 1}`;
  return {
    id: String(filter.id || filterId(name)), name, icon: String(filter.icon || '').trim(), color: String(filter.color || '').trim(),
    surfaces: ['search', 'similar', 'both'].includes(filter.surfaces) ? filter.surfaces : 'both', defaultActive: Boolean(filter.defaultActive),
    folders: cleanList(filter.folders, normalizedPath), excludeFolders: cleanList(filter.excludeFolders, normalizedPath),
    types: cleanList(filter.types, value => value.toLowerCase().replace(/^\./, '')), tags: cleanList(filter.tags, value => value.toLowerCase().replace(/^#/, '')),
    pathTerms: cleanList(filter.pathTerms, value => value.toLowerCase()), properties: (Array.isArray(filter.properties) ? filter.properties : []).map(normalizePropertyRule).filter(Boolean),
    modifiedWithinDays: Math.max(0, Number(filter.modifiedWithinDays) || 0), createdWithinDays: Math.max(0, Number(filter.createdWithinDays) || 0),
  };
}

function normalizeQuickFilters(filters) { return (Array.isArray(filters) ? filters : []).map(normalizeQuickFilter).slice(0, 24); }
function visibleQuickFilters(filters, surface) { return normalizeQuickFilters(filters).filter(filter => filter.surfaces === 'both' || filter.surfaces === surface); }

function inFolder(path, folder) { return path === folder || path.startsWith(`${folder}/`); }
function fileKind(extension) {
  const value = String(extension || '').toLowerCase();
  if (value === 'md') return 'markdown'; if (value === 'pdf') return 'pdf'; if (value === 'canvas') return 'canvas';
  if (IMAGE_EXTENSIONS.has(value)) return 'image'; if (AUDIO_EXTENSIONS.has(value)) return 'audio'; if (VIDEO_EXTENSIONS.has(value)) return 'video'; if (ARCHIVE_EXTENSIONS.has(value)) return 'archive'; return 'other';
}
function matchesType(extension, types) { if (!types.length) return true; const value = String(extension || '').toLowerCase(), kind = fileKind(value); return types.includes(value) || types.includes(kind) || types.includes('attachment') && value !== 'md'; }
function scalarValues(value) { if (Array.isArray(value)) return value.flatMap(scalarValues); if (value && typeof value === 'object') return Object.values(value).flatMap(scalarValues); return [String(value ?? '')]; }
function propertyMatches(frontmatter, rule) {
  const has = Object.prototype.hasOwnProperty.call(frontmatter || {}, rule.key); if (rule.operator === 'exists') return has; if (!has) return false;
  const values = scalarValues(frontmatter[rule.key]).map(value => value.toLowerCase()), expected = rule.value.toLowerCase();
  if (rule.operator === 'not-equals') return values.every(value => value !== expected);
  if (rule.operator === 'contains') return values.some(value => value.includes(expected));
  return values.some(value => value === expected);
}
function fileTags(cache) {
  const values = [...(cache?.tags || []).map(item => item?.tag), cache?.frontmatter?.tags, cache?.frontmatter?.tag].flatMap(scalarValues);
  return new Set(values.flatMap(value => String(value || '').split(/[\s,]+/)).map(value => value.toLowerCase().replace(/^#/, '')).filter(Boolean));
}

function quickFilterMatches(file, cache, filter, now = Date.now()) {
  const path = normalizedPath(file?.path), lowerPath = path.toLowerCase(), folders = filter.folders || [], excluded = filter.excludeFolders || [];
  if (folders.length && !folders.some(folder => inFolder(path, folder))) return false;
  if (excluded.some(folder => inFolder(path, folder))) return false;
  if (!matchesType(file?.extension, filter.types || [])) return false;
  if ((filter.pathTerms || []).length && !filter.pathTerms.some(term => lowerPath.includes(term))) return false;
  if ((filter.tags || []).length) { const tags = fileTags(cache); if (!filter.tags.every(tag => tags.has(tag))) return false; }
  if (!(filter.properties || []).every(rule => propertyMatches(cache?.frontmatter || {}, rule))) return false;
  if (filter.modifiedWithinDays && now - Number(file?.stat?.mtime || 0) > filter.modifiedWithinDays * 86400000) return false;
  if (filter.createdWithinDays && now - Number(file?.stat?.ctime || 0) > filter.createdWithinDays * 86400000) return false;
  return true;
}

function resolveQuickFilterPaths(files, cacheFor, filters, activeIds, now = Date.now()) {
  const requested = activeIds instanceof Set ? [...activeIds] : Array.isArray(activeIds) ? activeIds : [], active = normalizeQuickFilters(filters).filter(filter => requested.includes(filter.id));
  if (!requested.length) return null; if (!active.length) return [];
  return (files || []).filter(file => { let cache = null, loaded = false; return active.some(filter => { const needsMetadata = filter.tags.length || filter.properties.length; if (needsMetadata && !loaded) { cache = cacheFor(file); loaded = true; } return quickFilterMatches(file, needsMetadata ? cache : null, filter, now); }); }).map(file => file.path);
}

export { fileKind, filterId, normalizePropertyRule, normalizeQuickFilter, normalizeQuickFilters, quickFilterMatches, resolveQuickFilterPaths, visibleQuickFilters };
