const DATE_PREFIX = /^(?:(\d{4})[-_. ](\d{2})[-_. ](\d{2})|\[(\d{4})-(\d{2})-(\d{2})\])\s*[-–—_:]*\s*/;
const VERSION_SUFFIX = /\s*(?:\((?:rev(?:ision)?|version|edition)\s*\d+\)|[-–—_:]\s*(?:rev(?:ision)?|version|edition|v)\s*\d+)\s*$/i;
const BRACKETED_WORKFLOW_PREFIX = /^\s*\[(?:draft|wip|working draft)\]\s*[-–—_:]*\s*/i;
const UPPERCASE_WORKFLOW_PREFIX = /^\s*(?:DRAFT|WIP|WORKING DRAFT)\b\s*[-–—_:]*\s*/;

function stripWorkflowPrefix(source) { return String(source || '').replace(BRACKETED_WORKFLOW_PREFIX, '').replace(UPPERCASE_WORKFLOW_PREFIX, ''); }
function normalizedIdentity(source) { return String(source || '').normalize('NFKD').replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase(); }
function displayRevisionTitle(source) { return stripWorkflowPrefix(String(source || '').replace(/\.md$/i, '').replace(DATE_PREFIX, '').replace(VERSION_SUFFIX, '')).trim(); }
function normalizeRevisionTitle(source) { return normalizedIdentity(displayRevisionTitle(source)); }
function normalizeRevisionGroup(source) { return normalizedIdentity(String(source || '').replace(/^\[\[|\]\]$/g, '').replace(/\.md$/i, '')); }

function scalarValues(value) { const output = []; const append = item => { if (Array.isArray(item)) item.forEach(append); else if (item !== null && item !== undefined && typeof item !== 'object') output.push(String(item).trim()); }; append(value); return output.filter(Boolean); }
function frontmatterValue(frontmatter, keys) {
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(frontmatter || {}, key)) return frontmatter[key];
  const aliases = new Map(Object.keys(frontmatter || {}).map(key => [key.toLowerCase(), key])); for (const key of keys) { const alias = aliases.get(key.toLowerCase()); if (alias !== undefined) return frontmatter[alias]; }
  return undefined;
}
function revisionProperties(frontmatter = {}) {
  const group = scalarValues(frontmatterValue(frontmatter, ['revision-group', 'gib-search-series']))[0] || '', date = frontmatterValue(frontmatter, ['revision-date', 'gib-search-revision-date']);
  return { group, date: date || '', current: frontmatterValue(frontmatter, ['revision-current']) === true, excluded: frontmatterValue(frontmatter, ['gib-search-no-bundle']) === true, revises: scalarValues(frontmatterValue(frontmatter, ['revises'])) };
}
function revisionGroupValue(frontmatter = {}) {
  return revisionProperties(frontmatter).group;
}

function revisionDateInfo(file, frontmatter = {}) {
  const explicit = revisionProperties(frontmatter).date; if (explicit) { const parsed = Date.parse(String(explicit)); if (Number.isFinite(parsed)) return { value: parsed, source: 'property', intrinsic: true }; }
  const match = String(file.basename || '').match(DATE_PREFIX);
  if (match) return { value: Date.UTC(Number(match[1] || match[4]), Number(match[2] || match[5]) - 1, Number(match[3] || match[6])), source: 'filename', intrinsic: true };
  return { value: Number(file.stat?.mtime || file.stat?.ctime || 0), source: 'filesystem', intrinsic: false };
}
function revisionDate(file, frontmatter = {}) { return revisionDateInfo(file, frontmatter).value; }
function isDraftRevision(file) { return BRACKETED_WORKFLOW_PREFIX.test(String(file.basename || '')) || UPPERCASE_WORKFLOW_PREFIX.test(String(file.basename || '')); }

function folderParts(source) { return String(source || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean); }
function normalizedFolderPart(source) { return normalizedIdentity(String(source || '').replace(/^\s*\d{1,4}\s*(?:[^\p{L}\p{N}]+\s*)?/u, '').replace(/^\s*[^\p{L}\p{N}]+/u, '')); }
function revisionFolderInScope(path, folders) {
  const target = folderParts(path); if (target.length) target.pop();
  return (folders || []).some(folder => {
    const scope = folderParts(folder); if (!scope.length) return false;
    const exact = scope.every((part, index) => String(target[index] || '').toLowerCase() === part.toLowerCase()); if (exact) return true;
    return scope.every((part, index) => normalizedFolderPart(target[index]) === normalizedFolderPart(part));
  });
}

function hash32(source) { let hash = 2166136261; for (const character of source) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function contentSignature(source) {
  const words = String(source || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [], hashes = new Set();
  for (let index = 0; index <= words.length - 5 && hashes.size < 4096; index++) hashes.add(hash32(words.slice(index, index + 5).join(' ')));
  const ordered = [...hashes].sort((a, b) => a - b); return { size: hashes.size, shingles: hashes, minhash: ordered.slice(0, 24) };
}
function overlap(first, second) { if (!first?.size || !second?.size) return 0; let shared = 0; for (const value of first.shingles) if (second.shingles.has(value)) shared++; return shared / Math.min(first.size, second.size); }
function titleSimilarity(first, second) { const a = new Set(first.split(' ').filter(Boolean)), b = new Set(second.split(' ').filter(Boolean)); if (!a.size || !b.size) return 0; let shared = 0; for (const value of a) if (b.has(value)) shared++; return 2 * shared / (a.size + b.size); }

function revisionReferences(frontmatter, source) {
  const values = revisionProperties(frontmatter).revises, output = [];
  const append = value => { const links = [...String(value || '').matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map(match => match[1].trim()); if (links.length) output.push(...links); else if (String(value || '').trim()) output.push(String(value).trim()); };
  values.forEach(append);
  for (const match of String(source || '').slice(0, 12000).matchAll(/^\s*(?:revises|revision of|supersedes)\s*:\s*\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/gim)) output.push(match[1].trim());
  return [...new Set(output.filter(Boolean))];
}
function referenceKey(source) { return String(source || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.md$/i, '').toLowerCase(); }

async function buildRevisionCatalog(files, metadataFor, textFor, folders, yieldWork = async () => {}, signatureFor = null) {
  const scopes = [...new Set((folders || []).map(value => String(value).trim().replace(/^\/+|\/+$/g, '')).filter(Boolean))], records = [];
  const markdown = files.filter(file => String(file.extension || '').toLowerCase() === 'md');
  for (let index = 0; index < markdown.length; index++) {
    const file = markdown[index], frontmatter = metadataFor(file)?.frontmatter || {}, properties = revisionProperties(frontmatter), groupLabel = properties.group, automaticScope = revisionFolderInScope(file.path, scopes), excluded = properties.excluded;
    if (!excluded && (groupLabel || automaticScope)) {
      const text = textFor(file.path), groupKey = normalizeRevisionGroup(groupLabel), date = revisionDateInfo(file, frontmatter), record = { file: file.path, basename: file.basename, folder: file.parent?.path || '', title: normalizeRevisionTitle(file.basename), displayTitle: displayRevisionTitle(file.basename), date: date.value, dateSource: date.source, intrinsicDate: date.intrinsic, draft: isDraftRevision(file), explicitCurrent: properties.current, groupLabel, groupKey, automaticScope, references: revisionReferences(frontmatter, text), signature: signatureFor ? signatureFor(file.path, () => contentSignature(text)) : contentSignature(text) };
      if (record.title || record.groupKey) records.push(record);
    }
    if (index % 12 === 11) await yieldWork();
  }
  const parent = new Map(records.map(record => [record.file, record.file])), find = value => { let root = value; while (parent.get(root) !== root) root = parent.get(root); while (parent.get(value) !== value) { const next = parent.get(value); parent.set(value, root); value = next; } return root; }, join = (a, b) => { const first = find(a), second = find(b); if (first !== second) parent.set(second, first); };
  const compatible = (first, second) => !first.groupKey || !second.groupKey || first.groupKey === second.groupKey;
  const explicit = new Map(); for (const record of records) if (record.groupKey) { const group = explicit.get(record.groupKey) || []; if (group[0]) join(record.file, group[0].file); group.push(record); explicit.set(record.groupKey, group); }

  const pathIndex = new Map(), basenameIndex = new Map();
  for (const record of records) { pathIndex.set(referenceKey(record.file), record); const key = referenceKey(record.basename), group = basenameIndex.get(key) || []; group.push(record); basenameIndex.set(key, group); }
  for (const record of records) for (const reference of record.references) {
    const key = referenceKey(reference), target = pathIndex.get(key) || (basenameIndex.get(key)?.length === 1 ? basenameIndex.get(key)[0] : null); if (target && compatible(record, target)) join(record.file, target.file);
  }

  const exact = new Map(), minhash = new Map(), candidates = new Set(), maximumCandidates = Math.min(60000, Math.max(160, records.length * 120)), addCandidate = (first, second) => { if (first.file === second.file || candidates.size >= maximumCandidates) return; candidates.add([first.file, second.file].sort().join('\0')); };
  for (const record of records) {
    if (record.title) { const exactGroup = exact.get(record.title) || []; exactGroup.forEach(other => addCandidate(record, other)); exactGroup.push(record); exact.set(record.title, exactGroup); }
    record.signature.minhash.forEach(hash => { const group = minhash.get(hash) || []; for (const other of group.slice(-8)) addCandidate(record, other); group.push(record); if (group.length > 40) group.shift(); minhash.set(hash, group); });
  }
  const byPath = new Map(records.map(record => [record.file, record])); let candidateIndex = 0;
  for (const key of candidates) {
    const [firstPath, secondPath] = key.split('\0'), first = byPath.get(firstPath), second = byPath.get(secondPath); if (!first || !second || !compatible(first, second)) continue;
    const ancestry = overlap(first.signature, second.signature), titles = titleSimilarity(first.title, second.title), sameFolder = first.folder === second.folder, exactTitle = Boolean(first.title && first.title === second.title), workflowPair = first.draft !== second.draft || first.intrinsicDate || second.intrinsicDate;
    const sameFolderMatch = sameFolder && (exactTitle || ancestry >= .8 || ancestry >= .52 && titles >= .72), crossFolderMatch = !sameFolder && (ancestry >= .9 || ancestry >= .7 && titles >= .84 || exactTitle && workflowPair && ancestry >= .35);
    if (sameFolderMatch || crossFolderMatch) join(first.file, second.file); if (++candidateIndex % 200 === 0) await yieldWork();
  }

  const groups = new Map(); for (const record of records) { const root = find(record.file), group = groups.get(root) || []; group.push(record); groups.set(root, group); }
  const byFile = new Map(), series = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const explicitCurrents = group.filter(record => record.explicitCurrent), undatedDrafts = group.filter(record => record.draft && !record.intrinsicDate), fallback = group.slice().sort((a, b) => b.date - a.date || b.file.localeCompare(a.file))[0];
    const primary = explicitCurrents.length === 1 ? explicitCurrents[0] : !explicitCurrents.length && undatedDrafts.length === 1 ? undatedDrafts[0] : fallback, ambiguities = [];
    if (explicitCurrents.length > 1) ambiguities.push('multiple-current'); if (!explicitCurrents.length && undatedDrafts.length > 1) ambiguities.push('multiple-undated-drafts');
    group.sort((a, b) => Number(b.file === primary.file) - Number(a.file === primary.file) || b.date - a.date || b.file.localeCompare(a.file));
    const explicitRecord = group.find(record => record.groupKey), label = explicitRecord?.groupLabel || primary.displayTitle || group[0].displayTitle, id = explicitRecord ? `revision-group:${explicitRecord.groupKey}` : `automatic:${group.map(record => record.title).filter(Boolean).sort()[0] || normalizeRevisionGroup(label)}`;
    const value = { id, label, source: explicitRecord ? 'revision-group' : group.some(record => record.references.length) ? 'reference' : 'automatic', primaryFile: primary.file, ambiguous: ambiguities, revisions: group.map(record => ({ file: record.file, date: record.date, dateSource: record.dateSource, draft: record.draft, current: record.file === primary.file })) };
    series.set(value.id, value); for (const record of group) byFile.set(record.file, value);
  }
  return { byFile, series };
}

function bundleRevisionResults(results, catalog) {
  const output = [], positions = new Map();
  for (const result of results) {
    const series = catalog?.byFile?.get(result.file); if (!series) { output.push(result); continue; }
    const key = series.id, position = positions.get(key), candidate = { ...result, file: series.primaryFile, primaryFile: series.primaryFile, matchedFile: result.file, revisionSeries: series, revisionCount: series.revisions.length };
    if (position === undefined) { positions.set(key, output.length); output.push(candidate); }
    else if (Number(result.score || 0) > Number(output[position].score || 0)) output[position] = candidate;
  }
  return output.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

export { buildRevisionCatalog, bundleRevisionResults, contentSignature, displayRevisionTitle, normalizeRevisionGroup, normalizeRevisionTitle, overlap, revisionDate, revisionFolderInScope, revisionGroupValue, revisionProperties, titleSimilarity };
