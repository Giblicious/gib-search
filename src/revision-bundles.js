const DATE_PREFIX = /^(?:(\d{4})[-_. ](\d{2})[-_. ](\d{2})|\[(\d{4})-(\d{2})-(\d{2})\])\s*[-â€“â€”_:]*\s*/;
const VERSION_SUFFIX = /\s*(?:\((?:rev(?:ision)?|version)\s*\d+\)|[-â€“â€”_:]\s*(?:rev(?:ision)?|version|v)\s*\d+)\s*$/i;

function normalizeRevisionTitle(source) {
  return String(source || '').replace(/\.md$/i, '').replace(DATE_PREFIX, '').replace(VERSION_SUFFIX, '').normalize('NFKD').replace(/[â€™']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

function revisionDate(file, frontmatter = {}) {
  const explicit = frontmatter['gib-search-revision-date'];
  if (explicit) { const parsed = Date.parse(String(explicit)); if (Number.isFinite(parsed)) return parsed; }
  const match = String(file.basename || '').match(DATE_PREFIX);
  if (match) return Date.UTC(Number(match[1] || match[4]), Number(match[2] || match[5]) - 1, Number(match[3] || match[6]));
  return Number(file.stat?.ctime || file.stat?.mtime || 0);
}

function hash32(source) { let hash = 2166136261; for (const character of source) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function contentSignature(source) {
  const words = String(source || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [], hashes = new Set();
  for (let index = 0; index <= words.length - 5 && hashes.size < 4096; index++) hashes.add(hash32(words.slice(index, index + 5).join(' ')));
  const ordered = [...hashes].sort((a, b) => a - b); return { size: hashes.size, shingles: hashes, minhash: ordered.slice(0, 24) };
}
function overlap(first, second) { if (!first?.size || !second?.size) return 0; let shared = 0; for (const value of first.shingles) if (second.shingles.has(value)) shared++; return shared / Math.min(first.size, second.size); }
function titleSimilarity(first, second) { const a = new Set(first.split(' ').filter(Boolean)), b = new Set(second.split(' ').filter(Boolean)); if (!a.size || !b.size) return 0; let shared = 0; for (const value of a) if (b.has(value)) shared++; return 2 * shared / (a.size + b.size); }
function inScope(path, folders) { return folders.some(folder => path === folder || path.startsWith(`${folder}/`)); }

async function buildRevisionCatalog(files, metadataFor, textFor, folders, yieldWork = async () => {}) {
  const scopes = [...new Set((folders || []).map(value => String(value).trim().replace(/^\/+|\/+$/g, '')).filter(Boolean))];
  if (!scopes.length) return { byFile: new Map(), series: new Map() };
  const eligible = files.filter(file => String(file.extension || '').toLowerCase() === 'md' && inScope(file.path, scopes)), records = [];
  for (let index = 0; index < eligible.length; index++) { const file = eligible[index];
    const frontmatter = metadataFor(file)?.frontmatter || {}, explicit = String(frontmatter['gib-search-series'] || '').trim(), excluded = frontmatter['gib-search-no-bundle'] === true;
    const record = { file: file.path, folder: file.parent?.path || '', title: normalizeRevisionTitle(file.basename), date: revisionDate(file, frontmatter), explicit, excluded, signature: contentSignature(textFor(file.path)) }; if (!record.excluded && record.title) records.push(record); if (index % 12 === 11) await yieldWork();
  }
  const parent = new Map(records.map(record => [record.file, record.file])), find = value => { let root = value; while (parent.get(root) !== root) root = parent.get(root); while (parent.get(value) !== value) { const next = parent.get(value); parent.set(value, root); value = next; } return root; }, join = (a, b) => { const first = find(a), second = find(b); if (first !== second) parent.set(second, first); };
  const exact = new Map(), explicit = new Map(), minhash = new Map(), candidates = new Set(), maximumCandidates = records.length * 80;
  for (const record of records) {
    const exactKey = `${record.folder}\0${record.title}`, exactGroup = exact.get(exactKey) || []; if (exactGroup[0]) join(record.file, exactGroup[0].file); exactGroup.push(record); exact.set(exactKey, exactGroup);
    if (record.explicit) { const group = explicit.get(record.explicit) || []; if (group[0]) join(record.file, group[0].file); group.push(record); explicit.set(record.explicit, group); }
    record.signature.minhash.forEach(hash => { const key = `${record.folder}\0${hash}`, group = minhash.get(key) || []; if (candidates.size < maximumCandidates) for (const other of group.slice(-8)) { candidates.add([record.file, other.file].sort().join('\0')); if (candidates.size >= maximumCandidates) break; } group.push(record); if (group.length > 32) group.shift(); minhash.set(key, group); });
  }
  const byPath = new Map(records.map(record => [record.file, record]));
  let candidateIndex = 0; for (const key of candidates) { const [firstPath, secondPath] = key.split('\0'), first = byPath.get(firstPath), second = byPath.get(secondPath); if (!first || !second) continue; const ancestry = overlap(first.signature, second.signature), titles = titleSimilarity(first.title, second.title); if (ancestry >= .8 || ancestry >= .52 && titles >= .72) join(first.file, second.file); if (++candidateIndex % 200 === 0) await yieldWork(); }
  const groups = new Map(); for (const record of records) { const root = find(record.file), group = groups.get(root) || []; group.push(record); groups.set(root, group); }
  const byFile = new Map(), series = new Map(); for (const group of groups.values()) { if (group.length < 2) continue; group.sort((a, b) => b.date - a.date || b.file.localeCompare(a.file)); const value = { id: group.find(record => record.explicit)?.explicit || `${group[0].folder}\0${group[0].title}`, primaryFile: group[0].file, revisions: group.map(record => ({ file: record.file, date: record.date })) }; series.set(value.id, value); for (const record of group) byFile.set(record.file, value); }
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

export { buildRevisionCatalog, bundleRevisionResults, contentSignature, normalizeRevisionTitle, overlap, revisionDate, titleSimilarity };
