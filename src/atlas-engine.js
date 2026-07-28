const INDEXABLE = /\.(?:md|txt|markdown)$/i;

export const ATLAS_LENSES = {
  relevance: { label: 'Relevance', analysis: 'relevance', mapMode: 'similarity', description: 'Judge notes by their relationship to the active anchor.' },
  topics: { label: 'Topics', analysis: 'relevance', mapMode: 'topics', description: 'Reveal distinct treatments within the active anchor and scope.' },
  links: { label: 'Links', analysis: 'relevance', mapMode: 'links', description: 'Let authored wikilinks define the primary relationship network.' },
  arguments: { label: 'Arguments', analysis: 'arguments', mapMode: 'similarity', description: 'Organize support, alignment, and tension around the active anchor.' },
  context: { label: 'Context', analysis: 'context', mapMode: 'similarity', description: 'Emphasize notes that connect strongly to the wider scope.' },
};

export const DEFAULT_ATLAS_VIEW = {
  id: 'all-notes',
  name: 'All Notes',
  scope: { folders: [], excludeFolders: [], tags: [], properties: {}, extensions: ['md', 'txt', 'markdown'] },
  anchor: { type: 'default' },
  lens: 'default',
  scale: 'default',
};

export function validAtlasLens(value) { return ATLAS_LENSES[value] ? value : 'relevance'; }
export function validAtlasScale(value) { return ['overview', 'neighborhood', 'detail'].includes(value) ? value : 'overview'; }
export function atlasLens(value) { return ATLAS_LENSES[validAtlasLens(value)]; }

function normalizedPath(value) { return String(value || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''); }
function pathWithin(path, folder) { const normalized = normalizedPath(folder); return !normalized || path === normalized || path.startsWith(`${normalized}/`); }
function edgeKey(a, b) { return [a, b].sort().join('\0'); }
function basename(file) { return String(file || '').split('/').pop().replace(INDEXABLE, ''); }
function stableSignature(value) { let hash = 2166136261; for (const character of String(value || '')) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function fileScales(app) {
  const files = app.vault.getFiles().filter(file => INDEXABLE.test(file.path)), sizes = files.map(file => Math.log1p(Number(file.stat?.size || 0))), low = sizes.length ? Math.min(...sizes) : 0, high = sizes.length ? Math.max(...sizes) : 1, spread = Math.max(.001, high - low);
  return new Map(files.map(file => [file.path, (Math.log1p(Number(file.stat?.size || 0)) - low) / spread]));
}

function manualLinks(app, files) {
  const visible = new Set(files || []), roads = new Map(), resolved = app?.metadataCache?.resolvedLinks || {};
  for (const source of visible) for (const [target, count] of Object.entries(resolved[source] || {})) { if (!count || source === target || !visible.has(target)) continue; const [first, second] = [source, target].sort(), key = edgeKey(first, second), road = roads.get(key) || { key, source: first, target: second, forward: false, reverse: false, count: 0 }; if (source === first) road.forward = true; else road.reverse = true; road.count += Number(count || 0); roads.set(key, road); }
  return [...roads.values()];
}

function cloneScene(scene) {
  return { ...scene, state: copy(scene.state), center: { ...scene.center }, nodes: scene.nodes.map(node => ({ ...node })), edges: scene.edges.map(edge => ({ ...edge })), roads: scene.roads.map(road => ({ ...road })), results: scene.results.map(result => ({ ...result })), legend: scene.legend.map(item => ({ ...item })) };
}

export class AtlasEngine {
  constructor(plugin) { this.plugin = plugin; this.sceneCache = new Map(); this.context = { surface: 'note', state: null, query: '', results: [], loading: false, selection: null, hover: null }; this.contextListeners = new Set(); }

  publishContext(next = {}) { this.context = { ...this.context, ...next }; for (const listener of this.contextListeners) listener(this.context); }
  subscribeContext(listener) { this.contextListeners.add(listener); listener(this.context); return () => this.contextListeners.delete(listener); }

  views() {
    const configured = Array.isArray(this.plugin.settings?.atlasViews) ? this.plugin.settings.atlasViews : [], views = configured.length ? configured : [DEFAULT_ATLAS_VIEW];
    return views.map(view => this.normalizeView(view));
  }

  normalizeView(view = {}) {
    const scope = view.scope || {}, extensions = Array.isArray(scope.extensions) && scope.extensions.length ? scope.extensions.map(value => String(value).toLowerCase().replace(/^\./, '')) : DEFAULT_ATLAS_VIEW.scope.extensions;
    return {
      id: String(view.id || stableSignature(view.name || 'all-notes')),
      name: String(view.name || 'All Notes'),
      scope: { folders: (scope.folders || []).map(normalizedPath).filter(Boolean), excludeFolders: (scope.excludeFolders || []).map(normalizedPath).filter(Boolean), tags: (scope.tags || []).map(tag => String(tag).replace(/^#/, '')).filter(Boolean), properties: { ...(scope.properties || {}) }, extensions },
      anchor: view.anchor && typeof view.anchor === 'object' ? { ...view.anchor } : { type: 'default' },
      lens: view.lens === 'default' ? 'default' : validAtlasLens(view.lens),
      scale: view.scale === 'default' ? 'default' : validAtlasScale(view.scale),
    };
  }

  activeView(id = this.plugin.settings?.atlasHomeViewId) { return this.views().find(view => view.id === id) || this.views()[0] || this.normalizeView(DEFAULT_ATLAS_VIEW); }

  state(overrides = {}) {
    const view = this.normalizeView(overrides.view || this.activeView(overrides.viewId)), defaultLens = validAtlasLens(this.plugin.settings?.defaultSearchLens), lens = validAtlasLens(overrides.lens || (view.lens === 'default' ? defaultLens : view.lens)), scale = validAtlasScale(overrides.scale || (view.scale === 'default' ? 'overview' : view.scale)), anchor = overrides.anchor ? { ...overrides.anchor } : { ...view.anchor };
    return { viewId: view.id, viewName: view.name, scope: copy(view.scope), anchor, lens, scale, selection: overrides.selection || null };
  }

  resolveScope(state) {
    const scope = state?.scope || DEFAULT_ATLAS_VIEW.scope, extensions = new Set(scope.extensions || DEFAULT_ATLAS_VIEW.scope.extensions), folders = scope.folders || [], excluded = scope.excludeFolders || [], tags = new Set((scope.tags || []).map(value => String(value).replace(/^#/, ''))), properties = Object.entries(scope.properties || {}), files = this.plugin.app.vault.getFiles().filter(file => {
      if (!extensions.has(String(file.extension || '').toLowerCase())) return false;
      if (folders.length && !folders.some(folder => pathWithin(file.path, folder))) return false;
      if (excluded.some(folder => pathWithin(file.path, folder))) return false;
      if (!tags.size && !properties.length) return true;
      const cache = this.plugin.app.metadataCache.getFileCache(file), fileTags = new Set([...(cache?.tags || []).map(value => String(value.tag || '').replace(/^#/, '')), ...Object.keys(cache?.frontmatter || {}).filter(key => key === 'tags').flatMap(() => { const value = cache?.frontmatter?.tags; return Array.isArray(value) ? value : String(value || '').split(/[ ,]+/); }).map(value => String(value).replace(/^#/, ''))]);
      if (tags.size && ![...tags].every(tag => fileTags.has(tag))) return false;
      return properties.every(([key, expected]) => { const actual = cache?.frontmatter?.[key]; return Array.isArray(expected) ? expected.includes(actual) : Array.isArray(actual) ? actual.includes(expected) : actual === expected; });
    });
    return { files, paths: files.map(file => file.path), signature: stableSignature(JSON.stringify([state.viewId, scope, files.map(file => [file.path, file.stat?.mtime || 0])])) };
  }

  legendFor(state) {
    const common = [{ key: 'distance', label: state.anchor?.type === 'query' ? 'Distance from center' : 'Distance', meaning: state.anchor?.type === 'query' ? 'Relevance to the anchor' : 'Semantic relationship' }, { key: 'size', label: 'Dot size', meaning: 'Relative file size' }];
    if (state.lens === 'topics') return [...common, { key: 'color', label: 'Color', meaning: 'Topic direction' }, { key: 'region', label: 'Region', meaning: 'Soft topical neighborhood' }];
    if (state.lens === 'links') return [...common, { key: 'line', label: 'Road', meaning: 'Authored wikilink' }];
    if (state.lens === 'arguments') return [...common, { key: 'relationship', label: 'Relationship', meaning: 'Alignment or tension' }];
    return [...common, { key: 'color', label: 'Color', meaning: 'Conceptual direction' }, { key: 'terrain', label: 'Terrain', meaning: 'Semantic density' }];
  }

  sceneKey(state, scope, results, options) {
    const index = this.plugin.search, indexSignature = `${index.meta.length}:${index.vectors.length}:${index.meta.reduce((sum, item) => sum + Number(item.mtime || 0), 0)}`, relationships = state.lens === 'arguments' && options.relationships instanceof Map ? [...options.relationships].map(([key, value]) => [key, value?.type, Number(value?.confidence || 0)]).sort() : [];
    return JSON.stringify([indexSignature, scope.signature, state.anchor, state.lens, state.scale, results.map(result => [result.file, Number(result.lensScore ?? result.score ?? 0)]), relationships]);
  }

  async scene(state, results = [], options = {}) {
    const scope = options.scope || this.resolveScope(state), key = this.sceneKey(state, scope, results, options), remembered = this.sceneCache.get(key); if (remembered) { this.sceneCache.delete(key); this.sceneCache.set(key, remembered); return cloneScene(await remembered); }
    const pending = state.anchor?.type === 'query' && String(state.anchor.value || '').trim() ? this.queryScene(state, scope, results, options) : state.anchor?.type === 'note' && String(state.anchor.value || '').trim() ? this.noteScene(state, scope, options) : this.vaultScene(state, scope, options);
    this.sceneCache.set(key, pending); try { const built = await pending; this.sceneCache.set(key, built); while (this.sceneCache.size > 32) this.sceneCache.delete(this.sceneCache.keys().next().value); return cloneScene(built); } catch (error) { this.sceneCache.delete(key); throw error; }
  }

  async vaultScene(state, scope, options = {}) {
    const graph = await this.plugin.search.semanticStarfield('', scope.paths), scales = options.fileScales || fileScales(this.plugin.app), definition = atlasLens(state.lens), nodes = graph.nodes.map(node => ({ ...node, matched: false, generation: 1, relevance: .5, fileScale: scales.get(node.id) ?? .35, facet: node.community, conceptAffinities: node.topicAffinities })), layout = await this.plugin.search.multiRelationalLayout('', nodes, new Map(), { magic: this.plugin.settings.magicGraphEnabled, lens: definition.analysis, vaultCenter: true, mapMode: definition.mapMode });
    for (const node of nodes) { const target = layout.get(node.id); if (target) { node.layoutX = target.x; node.layoutY = target.y; } }
    return { state, scopeSignature: scope.signature, center: { label: state.viewName, hasQuery: false, resultCount: 0 }, nodes, edges: graph.edges || [], roads: manualLinks(this.plugin.app, scope.paths), results: [], legend: this.legendFor(state), provisional: false };
  }

  async queryScene(state, scope, results, options = {}) {
    const query = String(state.anchor.value || '').trim(), definition = atlasLens(state.lens), relationships = options.relationships instanceof Map ? options.relationships : new Map(), relationshipEdges = options.relationshipEdges || [], sourceResults = results.map(result => ({ ...result })), roots = sourceResults.map(result => result.file), generations = Math.max(1, Math.min(3, Number(options.generations) || 1)), expansion = this.plugin.search.semanticGenerations(roots, generations, 5), generationByFile = new Map(expansion.nodes.map(node => [node.id, node])), allowed = new Set(scope.paths), activeFiles = expansion.nodes.map(node => node.id).filter(file => allowed.has(file)), [facets, graph] = await Promise.all([this.plugin.search.conceptFacets(query, activeFiles), this.plugin.search.semanticStarfield(query, activeFiles, activeFiles, { queryLabels: false })]);
    for (const result of sourceResults) { const facet = facets.get(result.file); result.facet = facet?.facet; result.conceptAffinities = facet?.affinities; }
    const byFile = new Map(sourceResults.map(result => [result.file, result])), scales = options.fileScales || fileScales(this.plugin.app), rankingScores = sourceResults.map(result => Number(result.lensScore ?? result.score ?? 0)), rankingLow = rankingScores.length ? Math.min(...rankingScores) : 0, rankingHigh = rankingScores.length ? Math.max(...rankingScores) : 1, rankingSpread = Math.max(.001, rankingHigh - rankingLow), semanticScores = graph.nodes.map(node => Number(node.semanticScore || 0)), semanticLow = semanticScores.length ? Math.min(...semanticScores) : 0, semanticHigh = semanticScores.length ? Math.max(...semanticScores) : 1, semanticSpread = Math.max(.001, semanticHigh - semanticLow), expansionEdges = expansion.edges.map(edge => ({ ...edge, residualScore: 0 })), edgeKeys = new Set((graph.edges || []).map(edge => edgeKey(edge.source, edge.target))), combinedEdges = [...(graph.edges || []), ...expansionEdges.filter(edge => !edgeKeys.has(edgeKey(edge.source, edge.target)))];
    const nodes = graph.nodes.map(node => { const result = byFile.get(node.id), generation = generationByFile.get(node.id), subtopic = facets.get(node.id), semanticRelevance = (Number(node.semanticScore || 0) - semanticLow) / semanticSpread, rankedRelevance = result ? (Number(result.lensScore ?? result.score ?? 0) - rankingLow) / rankingSpread : 0, expandedRelevance = generation && generation.generation > 1 ? Math.max(.22, Math.min(.62, Number(generation.relationScore || 0))) : semanticRelevance, community = definition.mapMode === 'topics' && subtopic ? subtopic.facet : node.community, membership = subtopic ? Number(subtopic.affinities?.[subtopic.facet] || 0) : Number(node.communityMembership || 0); return { ...node, generation: generation?.generation || 1, parent: generation?.parent || null, matched: Boolean(generation), relevance: result ? .08 + rankedRelevance * .92 : expandedRelevance, fileScale: scales.get(node.id) ?? .35, facet: subtopic?.facet ?? result?.facet ?? node.community, community, communityMembership: definition.mapMode === 'topics' ? membership : node.communityMembership, communityLabel: definition.mapMode === 'topics' ? subtopic?.label || '' : node.communityLabel, communityFallbackLabel: definition.mapMode === 'topics' ? subtopic?.fallbackLabel || '' : node.communityFallbackLabel, communityLabelConfidence: definition.mapMode === 'topics' ? Number(subtopic?.confidence || 0) : node.communityLabelConfidence, conceptAffinities: subtopic?.affinities || result?.conceptAffinities || node.topicAffinities, topicAffinities: definition.mapMode === 'topics' && subtopic ? subtopic.affinities : node.topicAffinities, contextScore: result?.contextScore }; }), layout = await this.plugin.search.multiRelationalLayout(query, nodes, definition.analysis === 'arguments' ? relationships : new Map(), { magic: this.plugin.settings.magicGraphEnabled, lens: definition.analysis, mapMode: definition.mapMode });
    for (const node of nodes) { const target = layout.get(node.id); if (target) { node.layoutX = target.x; node.layoutY = target.y; } }
    const edges = definition.analysis === 'arguments' ? [...combinedEdges.map(edge => ({ ...edge, relation: relationships.get(edgeKey(edge.source, edge.target)) })), ...relationshipEdges.filter(edge => !edgeKeys.has(edgeKey(edge.source, edge.target))).map(edge => ({ ...edge, relation: relationships.get(edgeKey(edge.source, edge.target)) }))] : combinedEdges;
    return { state, scopeSignature: scope.signature, center: { label: query, hasQuery: true, resultCount: sourceResults.length }, nodes, edges, roads: manualLinks(this.plugin.app, nodes.map(node => node.id)), results: sourceResults, legend: this.legendFor(state), provisional: false };
  }

  async noteScene(state, scope, options = {}) {
    const filePath = String(state.anchor.value || ''), definition = atlasLens(state.lens), limit = state.scale === 'detail' ? 32 : state.scale === 'neighborhood' ? 22 : 16, graph = this.plugin.search.semanticNeighbors(filePath, limit), allowed = new Set(scope.paths); let nodes = graph.nodes.filter(node => allowed.has(node.id)).map(node => ({ ...node, semanticScore: Number(node.score || 0) })), edges = (graph.edges || []).filter(edge => allowed.has(edge.source) && allowed.has(edge.target)), relationships = new Map();
    if (definition.mapMode === 'topics' || state.lens === 'relevance') { const facets = await this.plugin.search.conceptFacetsFromFile(filePath, nodes.map(node => node.id)); nodes = nodes.map(node => ({ ...node, facet: facets.get(node.id)?.facet, community: definition.mapMode === 'topics' ? facets.get(node.id)?.facet : node.community, communityLabel: definition.mapMode === 'topics' ? facets.get(node.id)?.label || '' : node.communityLabel, conceptAffinities: facets.get(node.id)?.affinities, topicAffinities: definition.mapMode === 'topics' ? facets.get(node.id)?.affinities : node.topicAffinities })); }
    if (state.lens === 'context') { const context = this.plugin.search.contextScores(nodes.map(node => node.id)); nodes = nodes.map(node => ({ ...node, contextScore: Number(context.get(node.id) || 0), score: Number(node.score || 0) * .62 + Number(context.get(node.id) || 0) * .38 })).sort((first, second) => second.score - first.score); }
    if (state.lens === 'arguments' && this.plugin.settings.graphRelationshipIntelligence) { const candidates = this.plugin.search.argumentCandidateEdges(nodes.map(node => node.id)), budget = this.plugin.isMobile ? this.plugin.settings.graphRelationshipBudgetMobile : this.plugin.settings.graphRelationshipBudgetDesktop; relationships = await this.plugin.search.graphRelationships(candidates, budget); edges = candidates.map(edge => ({ ...edge, relation: relationships.get(edgeKey(edge.source, edge.target)) })); }
    const scores = nodes.map(node => Number(node.score || 0)), low = scores.length ? Math.min(...scores) : 0, high = scores.length ? Math.max(...scores) : 1, spread = Math.max(.001, high - low), scales = options.fileScales || fileScales(this.plugin.app); nodes = nodes.map(node => ({ ...node, relevance: (Number(node.score || 0) - low) / spread, matched: true, generation: 1, fileScale: scales.get(node.id) ?? .35 })); const layout = await this.plugin.search.multiRelationalLayout(basename(filePath), nodes, relationships, { lens: definition.analysis, magic: this.plugin.settings.magicGraphEnabled, mapMode: definition.mapMode, centerFile: filePath });
    for (const node of nodes) { const target = layout.get(node.id); if (target) { node.layoutX = target.x; node.layoutY = target.y; } }
    return { state, scopeSignature: scope.signature, center: { id: filePath, label: basename(filePath), hasQuery: true, resultCount: nodes.length }, nodes, edges, roads: manualLinks(this.plugin.app, [filePath, ...nodes.map(node => node.id)]), results: nodes, legend: this.legendFor(state), provisional: false };
  }

  provisionalScene(state, baseScene, results, positions = new Map()) {
    const scores = results.map(result => Number(result.lensScore ?? result.score ?? 0)), low = scores.length ? Math.min(...scores) : 0, high = scores.length ? Math.max(...scores) : 1, spread = Math.max(.001, high - low), byFile = new Map(results.map(result => [result.file, result])), nodes = baseScene.nodes.map(base => { const result = byFile.get(base.id), current = positions.get(base.id), positioned = current ? { layoutX: current.x, layoutY: current.y } : {}; return result ? { ...base, ...positioned, matched: true, generation: 1, relevance: .08 + (Number(result.lensScore ?? result.score ?? 0) - low) / spread * .92 } : { ...base, ...positioned, matched: false, relevance: 0 }; });
    return { state, scopeSignature: baseScene.scopeSignature, center: { label: state.anchor.value, hasQuery: true, resultCount: results.length, transition: 'provisional' }, nodes, edges: baseScene.edges, roads: baseScene.roads, results, legend: this.legendFor(state), provisional: true };
  }

  clear() { this.sceneCache.clear(); }
}
