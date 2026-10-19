function scopeList(values, extension = false) {
  const list = Array.isArray(values) ? values : String(values || '').split(',');
  return [...new Set(list.map(value => String(value).trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')).map(value => extension ? value.toLowerCase().replace(/^\./, '') : value).filter(Boolean))];
}

export function normalizeIndexScope(settings = {}) {
  return { indexIncludedFolders: scopeList(settings.indexIncludedFolders), indexExcludedFolders: scopeList(settings.indexExcludedFolders), indexExcludedExtensions: scopeList(settings.indexExcludedExtensions, true) };
}

export function indexScopeIncludes(file, settings = {}) {
  const name = String(file?.path || ''), within = folder => name === folder || name.startsWith(`${folder}/`);
  return Boolean(name) && (!settings.indexIncludedFolders?.length || settings.indexIncludedFolders.some(within)) && !settings.indexExcludedFolders?.some(within) && !settings.indexExcludedExtensions?.includes(String(file.extension || '').toLowerCase());
}

export function indexScopePreview(files, indexedMeta, settings) {
  const scope = normalizeIndexScope(settings), included = files.filter(file => indexScopeIncludes(file, scope)), paths = new Set(included.map(file => file.path)), indexed = new Set(indexedMeta.map(item => item.file));
  return { included: included.length, excluded: files.length - included.length, removed: [...indexed].filter(file => !paths.has(file)).length, added: included.filter(file => !indexed.has(file.path)).length };
}
