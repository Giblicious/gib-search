import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  buildRevisionCatalog,
  bundleRevisionResults,
  normalizeRevisionGroup,
  normalizeRevisionTitle,
  revisionFolderInScope,
} = await import(pathToFileURL(path.join(root, 'src', 'revision-bundles.js')).href);

function note(pathname, mtime = 1) {
  const parts = pathname.split('/'), filename = parts.pop();
  return { path: pathname, basename: filename.replace(/\.md$/i, ''), extension: 'md', parent: { path: parts.join('/') }, stat: { mtime, ctime: mtime, size: 100 } };
}

async function catalog(files, frontmatter = new Map(), text = new Map(), folders = []) {
  return buildRevisionCatalog(files, file => ({ frontmatter: frontmatter.get(file.path) || {} }), file => text.get(file) || '', folders);
}

if (normalizeRevisionTitle('DRAFT A General Inquiry.md') !== 'a general inquiry' || normalizeRevisionTitle('[WIP] — A General Inquiry.md') !== 'a general inquiry') throw new Error('Draft and WIP workflow prefixes are not normalized out of revision titles');
if (normalizeRevisionGroup('[[A General Inquiry.md]]') !== 'a general inquiry') throw new Error('Revision-group wikilink normalization is broken');
if (!revisionFolderInScope('03 • Writings/2024-01-02 A General Inquiry.md', ['Writings']) || !revisionFolderInScope('04 • Drafts/Revisions/DRAFT A General Inquiry.md', ['Drafts/Revisions']) || revisionFolderInScope('Study/A General Inquiry.md', ['Writings'])) throw new Error('Decorated revision-folder scope matching is incorrect');

const explicitFiles = [
  note('03 • Writings/2024-01-02 A General Inquiry.md', 10),
  note('04 • Drafts/Revisions/DRAFT A General Inquiry.md', 20),
];
const explicitMetadata = new Map(explicitFiles.map(file => [file.path, { 'revision-group': 'A General Inquiry' }]));
const explicitCatalog = await catalog(explicitFiles, explicitMetadata, new Map(), ['Writings', 'Drafts']);
const explicitSeries = explicitCatalog.byFile.get(explicitFiles[0].path);
if (explicitSeries?.source !== 'revision-group' || explicitSeries.primaryFile !== explicitFiles[1].path || explicitSeries.revisions.length !== 2 || explicitSeries.revisions[0].dateSource !== 'filesystem') throw new Error('Explicit revision-group membership or one-undated-draft current selection is broken');

const outsideFiles = [note('Archive/2019-03-04 First Treatment.md', 1), note('Archive/2020-04-05 Retitled Treatment.md', 2)];
const outsideMetadata = new Map(outsideFiles.map(file => [file.path, { 'revision-group': 'Shared Work' }]));
const outsideCatalog = await catalog(outsideFiles, outsideMetadata, new Map(), []);
if (outsideCatalog.byFile.get(outsideFiles[0].path)?.primaryFile !== outsideFiles[1].path) throw new Error('Explicit revision-group membership incorrectly depends on automatic-detection folders');

const automaticFiles = [note('01 • Essays/2022-05-06 The Long Argument.md', 1), note('02 • Drafts/DRAFT The Long Argument.md', 2)];
const ancestry = 'A careful argument considers evidence, objections, consequences, and a reasoned conclusion. '.repeat(16);
const automaticCatalog = await catalog(automaticFiles, new Map(), new Map(automaticFiles.map(file => [file.path, ancestry])), ['Essays', 'Drafts']);
if (automaticCatalog.byFile.get(automaticFiles[0].path)?.primaryFile !== automaticFiles[1].path || automaticCatalog.byFile.get(automaticFiles[0].path)?.source !== 'automatic') throw new Error('High-confidence cross-folder draft ancestry detection is broken');

const referenceFiles = [note('Essays/2021-02-03 A Prior Essay.md', 1), note('Drafts/DRAFT A Reworked Title.md', 2)];
const referenceMetadata = new Map([[referenceFiles[1].path, { Revises: '[[2021-02-03 A Prior Essay]]' }]]);
const referenceCatalog = await catalog(referenceFiles, referenceMetadata, new Map(), ['Essays', 'Drafts']);
if (referenceCatalog.byFile.get(referenceFiles[0].path)?.source !== 'reference' || referenceCatalog.byFile.get(referenceFiles[0].path)?.primaryFile !== referenceFiles[1].path) throw new Error('Legacy revises references are not retained as a safe grouping fallback');

const currentFiles = [note('Essays/2024-01-01 Current Override.md', 1), note('Essays/2025-01-01 Current Override.md', 2)];
const currentMetadata = new Map([[currentFiles[0].path, { 'revision-group': 'Current Override', 'revision-current': true }], [currentFiles[1].path, { 'revision-group': 'Current Override' }]]);
const currentCatalog = await catalog(currentFiles, currentMetadata);
if (currentCatalog.byFile.get(currentFiles[0].path)?.primaryFile !== currentFiles[0].path) throw new Error('revision-current does not override chronological ordering');

const ambiguousFiles = [note('Drafts/DRAFT Alpha.md', 1), note('Drafts/WIP Alpha.md', 2)];
const ambiguousMetadata = new Map(ambiguousFiles.map(file => [file.path, { 'revision-group': 'Alpha' }]));
const ambiguousCatalog = await catalog(ambiguousFiles, ambiguousMetadata);
if (!ambiguousCatalog.byFile.get(ambiguousFiles[0].path)?.ambiguous.includes('multiple-undated-drafts')) throw new Error('Ambiguous current-version detection is not surfaced');

const conflictingFiles = [note('Essays/2023-01-01 Identical Title.md', 1), note('Essays/2024-01-01 Identical Title.md', 2)];
const conflictingMetadata = new Map([[conflictingFiles[0].path, { 'revision-group': 'First Work' }], [conflictingFiles[1].path, { 'revision-group': 'Second Work' }]]);
const conflictingText = new Map(conflictingFiles.map(file => [file.path, ancestry]));
const conflictingCatalog = await catalog(conflictingFiles, conflictingMetadata, conflictingText, ['Essays']);
if (conflictingCatalog.series.size || conflictingCatalog.byFile.size) throw new Error('Conflicting explicit revision groups can still be merged by automatic detection');

const bundled = bundleRevisionResults([{ file: explicitFiles[0].path, score: .91 }, { file: explicitFiles[1].path, score: .72 }, { file: 'Essays/Other.md', score: .8 }], explicitCatalog);
if (bundled.length !== 2 || bundled[0].file !== explicitFiles[1].path || bundled[0].matchedFile !== explicitFiles[0].path) throw new Error('Revision bundles no longer rank by the best-matching edition while opening the current edition');

const mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8'), stylesSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8'), searchResultRenderer = mainSource.slice(mainSource.indexOf('renderSuggestion(result, el)'), mainSource.indexOf('async onChooseSuggestion(result'));
if (!mainSource.includes('renderVersionHistory(list, activePath, series)') || !mainSource.includes('!versionPaths.has(node.id)') || !mainSource.includes('!versionPaths.has(result.file)') || !mainSource.includes('this.renderVersionHistory(list, active.path, revisionSeries)') || !mainSource.includes('revisionGroupValue(metadata.get(file.path)?.frontmatter') || !mainSource.includes('revisionFolderInScope(file.path, folders)')) throw new Error('Similar Notes does not separate same-series siblings or the catalog still ignores explicit groups and decorated folders');
if (!mainSource.includes("this.renderResult(group, { id: file.path }, [], 'Version', '', { version: true, showScore: false })") || !mainSource.includes("gib-similar-card suggestion-item${options.version ? ' gib-similar-version-card' : ''}") || !mainSource.includes("gib-semantic-result-folder${options.version ? ' gib-similar-version-folder' : ''}") || !stylesSource.includes('.gib-similar-version-card .gib-semantic-result-header{margin-bottom:0}') || !stylesSource.includes('.gib-similar-version-folder{background:color-mix(in srgb,var(--interactive-accent) 14%,transparent)') || stylesSource.includes('.gib-similar-version-link{')) throw new Error('Similar Notes versions do not reuse passage-free result cards with a Version label and accent-derived directory pill');
const versionTableIndex = searchResultRenderer.indexOf("cls: 'gib-revision-timeline'"), resultTitleIndex = searchResultRenderer.indexOf("cls: 'gib-semantic-result-header'");
if (!searchResultRenderer.includes("cls: 'gib-revision-count', text: `${result.revisionCount} editions`") || !searchResultRenderer.includes("cls: 'gib-revision-actions'") || !searchResultRenderer.includes("text: 'Show versions'") || !searchResultRenderer.includes("'aria-expanded': 'false'") || versionTableIndex < 0 || resultTitleIndex < 0 || versionTableIndex > resultTitleIndex || !searchResultRenderer.includes("cls: 'gib-revision-timeline-head'") || !searchResultRenderer.includes("text: 'Relation'") || !searchResultRenderer.includes("cls: 'gib-revision-timeline-title'") || !searchResultRenderer.includes("cls: 'gib-revision-timeline-relation'") || searchResultRenderer.includes("cls: 'gib-revision-bundle'") || searchResultRenderer.includes("createEl('time'") || !stylesSource.includes('.gib-revision-actions{display:flex;flex:none;align-items:center;gap:2px;margin-left:auto}') || !stylesSource.includes('.gib-revision-timeline{display:grid;margin:0 0 9px;overflow:hidden;border:1px solid color-mix(in srgb,var(--interactive-accent) 28%')) throw new Error('Vault-search edition controls or the accent version table are not aligned between the directory metadata and result title');

console.log('Revision bundle checks passed: explicit groups, ordering, fallback detection, folder decoration, conflict safety, and compact Similar Notes history.');
