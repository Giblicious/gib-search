const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));

export const DEFAULT_LANDSCAPE = {
  style: 'hybrid',
  palette: 'natural',
  source: 'view',
  prominence: { coherence: .52, intensity: .28, distinctiveness: .64, density: .34 },
  landforms: { regionalScale: .66, localDetail: .48, relief: .72, ridges: .68, valleys: .58, cliffs: .36, passes: .42 },
  erosion: .28,
  rivers: .24,
  lakes: .12,
  contours: 9,
};

const SOURCES = new Set(['view', 'density', 'semantic', 'emotion', 'purpose', 'position', 'form', 'links', 'relevance', 'uniqueness']);

export function normalizeLandscape(value = {}, appearance = {}) {
  value = value && typeof value === 'object' ? value : {}; appearance = appearance && typeof appearance === 'object' ? appearance : {}; const legacy = !Object.keys(value).length, source = SOURCES.has(value.source) ? value.source : legacy && appearance.terrain === 'density' ? 'density' : 'view', prominence = value.prominence || {}, landforms = value.landforms || {}, contourValue = Number(value.contours ?? DEFAULT_LANDSCAPE.contours);
  return {
    style: ['off', 'contours', 'relief', 'hybrid'].includes(value.style) ? value.style : appearance.terrain === 'off' ? 'off' : DEFAULT_LANDSCAPE.style,
    palette: ['theme', 'natural'].includes(value.palette) ? value.palette : DEFAULT_LANDSCAPE.palette,
    source,
    prominence: {
      coherence: clamp(prominence.coherence ?? DEFAULT_LANDSCAPE.prominence.coherence),
      intensity: clamp(prominence.intensity ?? DEFAULT_LANDSCAPE.prominence.intensity),
      distinctiveness: clamp(prominence.distinctiveness ?? DEFAULT_LANDSCAPE.prominence.distinctiveness),
      density: clamp(prominence.density ?? DEFAULT_LANDSCAPE.prominence.density),
    },
    landforms: {
      regionalScale: clamp(landforms.regionalScale ?? DEFAULT_LANDSCAPE.landforms.regionalScale),
      localDetail: clamp(landforms.localDetail ?? DEFAULT_LANDSCAPE.landforms.localDetail),
      relief: clamp(landforms.relief ?? DEFAULT_LANDSCAPE.landforms.relief),
      ridges: clamp(landforms.ridges ?? DEFAULT_LANDSCAPE.landforms.ridges),
      valleys: clamp(landforms.valleys ?? DEFAULT_LANDSCAPE.landforms.valleys),
      cliffs: clamp(landforms.cliffs ?? DEFAULT_LANDSCAPE.landforms.cliffs),
      passes: clamp(landforms.passes ?? DEFAULT_LANDSCAPE.landforms.passes),
    },
    erosion: clamp(value.erosion ?? DEFAULT_LANDSCAPE.erosion),
    rivers: clamp(value.rivers ?? DEFAULT_LANDSCAPE.rivers),
    lakes: clamp(value.lakes ?? DEFAULT_LANDSCAPE.lakes),
    contours: Math.max(4, Math.min(16, Math.round(Number.isFinite(contourValue) ? contourValue : DEFAULT_LANDSCAPE.contours))),
  };
}

export function landscapeSourceLabel(source) {
  return ({ view: 'Current View prominence', density: 'Local note density', semantic: 'Meaning', emotion: 'Emotion', purpose: 'Purpose', position: 'Position', form: 'Writing form', links: 'Authored links', relevance: 'Query relevance', uniqueness: 'Vault distinctiveness' })[source] || 'Current View prominence';
}

function percentile(values, amount) {
  if (!values.length) return 0; const ordered = values.slice().sort((a, b) => a - b), position = clamp(amount) * (ordered.length - 1), low = Math.floor(position), high = Math.ceil(position), blend = position - low; return ordered[low] * (1 - blend) + ordered[high] * blend;
}

function blurField(source, columns, rows, passes = 1) {
  let current = Float32Array.from(source), horizontal = new Float32Array(current.length), vertical = new Float32Array(current.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let row = 0; row < rows; row++) {
      const offset = row * columns;
      for (let column = 0; column < columns; column++) { let total = current[offset + column] * 2, weight = 2; if (column > 0) { total += current[offset + column - 1]; weight++; } if (column + 1 < columns) { total += current[offset + column + 1]; weight++; } horizontal[offset + column] = total / weight; }
    }
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) { const index = row * columns + column; let total = horizontal[index] * 2, weight = 2; if (row > 0) { total += horizontal[index - columns]; weight++; } if (row + 1 < rows) { total += horizontal[index + columns]; weight++; } vertical[index] = total / weight; }
    const swap = current; current = vertical; vertical = swap;
  }
  return current;
}

function normalizeField(values, relief, cliffs) {
  const sample = []; for (let index = 0; index < values.length; index += Math.max(1, Math.floor(values.length / 4096))) sample.push(values[index]); const low = percentile(sample, .025), high = percentile(sample, .975), spread = Math.max(.0001, high - low), gain = .62 + clamp(relief) * .9, cliffBlend = clamp(cliffs) * .78;
  for (let index = 0; index < values.length; index++) { const linear = clamp((values[index] - low) / spread), shaped = linear * linear * (3 - 2 * linear); values[index] = clamp((linear * (1 - cliffBlend) + shaped * cliffBlend) * gain); } return values;
}

function gaussianBoxRadii(sigma, passes = 3) {
  const ideal = Math.sqrt(12 * sigma * sigma / passes + 1); let lower = Math.floor(ideal); if (lower % 2 === 0) lower--; lower = Math.max(1, lower); const upper = lower + 2, lowerCount = Math.max(0, Math.min(passes, Math.round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4)))); return Array.from({ length: passes }, (_, index) => ((index < lowerCount ? lower : upper) - 1) >> 1);
}

const impulseMassCache = new Map();

function gaussianImpulseMass(radii) {
  const key = radii.join(':'); if (impulseMassCache.has(key)) return impulseMassCache.get(key); let kernel = Float64Array.of(1);
  for (const radius of radii) { const width = radius * 2 + 1, next = new Float64Array(kernel.length + radius * 2); for (let index = 0; index < kernel.length; index++) for (let offset = 0; offset < width; offset++) next[index + offset] += kernel[index] / width; kernel = next; }
  const center = kernel[(kernel.length - 1) >> 1], mass = 1 / Math.max(1e-9, center * center); impulseMassCache.set(key, mass); return mass;
}

function addRasterSeed(values, columns, rows, x, y, amount) {
  if (!Number.isFinite(x + y + amount) || !amount) return; x = Math.max(0, Math.min(columns - 1, x)); y = Math.max(0, Math.min(rows - 1, y)); const left = Math.floor(x), top = Math.floor(y), right = Math.min(columns - 1, left + 1), bottom = Math.min(rows - 1, top + 1), horizontal = x - left, vertical = y - top, leftWeight = 1 - horizontal, topWeight = 1 - vertical;
  values[top * columns + left] += amount * leftWeight * topWeight; if (right !== left) values[top * columns + right] += amount * horizontal * topWeight; if (bottom !== top) { values[bottom * columns + left] += amount * leftWeight * vertical; if (right !== left) values[bottom * columns + right] += amount * horizontal * vertical; }
}

function boxBlur(source, columns, rows, radius, horizontal, output) {
  const width = radius * 2 + 1;
  for (let row = 0; row < rows; row++) { const offset = row * columns; let total = 0; for (let column = 0; column <= Math.min(columns - 1, radius); column++) total += source[offset + column]; for (let column = 0; column < columns; column++) { horizontal[offset + column] = total / width; const remove = column - radius, add = column + radius + 1; if (remove >= 0) total -= source[offset + remove]; if (add < columns) total += source[offset + add]; } }
  for (let column = 0; column < columns; column++) { let total = 0; for (let row = 0; row <= Math.min(rows - 1, radius); row++) total += horizontal[row * columns + column]; for (let row = 0; row < rows; row++) { output[row * columns + column] = total / width; const remove = row - radius, add = row + radius + 1; if (remove >= 0) total -= horizontal[remove * columns + column]; if (add < rows) total += horizontal[add * columns + column]; } }
}

function gaussianBlurSeeds(source, columns, rows, radii) {
  const horizontal = new Float32Array(source.length), first = Float32Array.from(source), second = new Float32Array(source.length); let current = first, output = second;
  for (const radius of radii) { boxBlur(current, columns, rows, radius, horizontal, output); const swap = current; current = output; output = swap; }
  return current;
}

function addCorridorSeeds(values, columns, rows, source, target, amplitude, lineMass) {
  const dx = target.x - source.x, dy = target.y - source.y, length = Math.hypot(dx, dy); if (!Number.isFinite(length) || length < .001 || !Number.isFinite(amplitude)) return; const steps = Math.max(1, Math.ceil(length)), spacing = length / steps, scale = amplitude * lineMass * spacing * 1.12;
  for (let index = 1; index < steps; index++) { const along = index / steps, taper = Math.sin(Math.PI * along) ** .55; addRasterSeed(values, columns, rows, source.x + dx * along, source.y + dy * along, scale * taper); }
}

export function priorityFlood(values, columns, rows) {
  columns = Math.max(0, Math.round(Number(columns) || 0)); rows = Math.max(0, Math.round(Number(rows) || 0)); const count = values?.length || 0; if (columns * rows !== count) throw new RangeError('Terrain dimensions do not match the height field');
  const filled = Float32Array.from(values), parent = new Int32Array(count).fill(-1), visited = new Uint8Array(count), order = new Int32Array(count), heap = []; let orderCount = 0; if (!count) return { filled, parent, order, orderCount };
  const less = (first, second) => filled[first] < filled[second] || filled[first] === filled[second] && first < second, push = index => { let position = heap.length; heap.push(index); while (position > 0) { const up = (position - 1) >> 1; if (less(heap[up], index)) break; heap[position] = heap[up]; position = up; } heap[position] = index; }, pop = () => { const first = heap[0], last = heap.pop(); if (heap.length && last !== undefined) { let position = 0; while (true) { const left = position * 2 + 1, right = left + 1; if (left >= heap.length) break; const child = right < heap.length && less(heap[right], heap[left]) ? right : left; if (less(last, heap[child])) break; heap[position] = heap[child]; position = child; } heap[position] = last; } return first; }, visit = index => { if (visited[index]) return; visited[index] = 1; push(index); };
  for (let column = 0; column < columns; column++) { visit(column); visit((rows - 1) * columns + column); } for (let row = 1; row < rows - 1; row++) { visit(row * columns); visit(row * columns + columns - 1); }
  const neighbors = [-columns - 1, -columns, -columns + 1, -1, 1, columns - 1, columns, columns + 1]; while (heap.length) { const index = pop(); order[orderCount++] = index; const row = Math.floor(index / columns), column = index - row * columns; for (const offset of neighbors) { const next = index + offset, nextRow = Math.floor(next / columns), nextColumn = next - nextRow * columns; if (next < 0 || next >= count || Math.abs(nextRow - row) > 1 || Math.abs(nextColumn - column) > 1 || visited[next]) continue; visited[next] = 1; parent[next] = index; filled[next] = Math.max(filled[next], filled[index] + .000001); push(next); } }
  return { filled, parent, order, orderCount };
}

export function deriveWater(values, columns, rows, rivers, lakes) {
  const flooded = priorityFlood(values, columns, rows), flow = new Float32Array(values.length); flow.fill(1); for (let position = flooded.orderCount - 1; position >= 0; position--) { const index = flooded.order[position], parent = flooded.parent[index]; if (parent >= 0) flow[parent] += flow[index]; }
  let maximumFlow = 1, minimumHeight = Infinity, maximumHeight = -Infinity; for (let index = 0; index < values.length; index++) { maximumFlow = Math.max(maximumFlow, flow[index]); minimumHeight = Math.min(minimumHeight, Number(values[index])); maximumHeight = Math.max(maximumHeight, Number(values[index])); } const hasRelief = maximumHeight - minimumHeight > 1e-6, lakeDepth = new Float32Array(values.length), lakeThreshold = .006 + (1 - clamp(lakes)) * .045; if (hasRelief && lakes > .001) for (let index = 0; index < values.length; index++) { const depth = flooded.filled[index] - values[index]; if (depth >= lakeThreshold) lakeDepth[index] = clamp(depth / Math.max(.02, lakeThreshold * 4)); }
  const riverSegments = [], cutoff = values.length * (.0075 - clamp(rivers) * .0062); if (hasRelief && rivers > .001) for (let index = 0; index < values.length; index++) { const parent = flooded.parent[index]; if (parent < 0 || flow[index] < cutoff || lakeDepth[index] > .02) continue; riverSegments.push({ from: index, to: parent, strength: clamp(Math.log1p(flow[index]) / Math.log1p(maximumFlow)) }); }
  return { ...flooded, flow, maximumFlow, lakeDepth, riverSegments };
}

function hillshade(values, columns, rows, relief) {
  const output = new Float32Array(values.length), vertical = 5 + clamp(relief) * 9, light = { x: -.48, y: -.56, z: .68 }; for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) { const left = values[row * columns + Math.max(0, column - 1)], right = values[row * columns + Math.min(columns - 1, column + 1)], top = values[Math.max(0, row - 1) * columns + column], bottom = values[Math.min(rows - 1, row + 1) * columns + column], nx = -(right - left) * vertical, ny = -(bottom - top) * vertical, nz = 1, length = Math.hypot(nx, ny, nz), illumination = (nx * light.x + ny * light.y + nz * light.z) / length; output[row * columns + column] = clamp(.5 + illumination * .5); } return output;
}

export function buildSemanticTerrain({ points = [], relations = [], landscape: sourceLandscape = {}, resolution = 176, world = { left: -1.12, top: -1.12, right: 1.12, bottom: 1.12 } } = {}) {
  const landscape = normalizeLandscape(sourceLandscape), columns = Math.max(96, Math.min(256, Math.round(resolution))), rows = columns, cellCount = columns * rows, broadSeeds = new Float32Array(cellCount), weightSeeds = new Float32Array(cellCount), localRelief = new Float32Array(cellCount), map = new Map(), requestedWorld = world && typeof world === 'object' ? world : {}, left = Number(requestedWorld.left), top = Number(requestedWorld.top), right = Number(requestedWorld.right), bottom = Number(requestedWorld.bottom), resolvedWorld = Number.isFinite(left) && Number.isFinite(right) && right > left && Number.isFinite(top) && Number.isFinite(bottom) && bottom > top ? { left, top, right, bottom } : { left: -1.12, top: -1.12, right: 1.12, bottom: 1.12 }, width = resolvedWorld.right - resolvedWorld.left, height = resolvedWorld.bottom - resolvedWorld.top, project = point => ({ ...point, x: (Number(point.x) - resolvedWorld.left) / width * (columns - 1), y: (Number(point.y) - resolvedWorld.top) / height * (rows - 1) }); const uniquePoints = new Map(); for (const point of points || []) if (point?.id !== undefined && point?.id !== null) uniquePoints.set(String(point.id), point); for (const point of [...uniquePoints.values()].sort((first, second) => String(first.id).localeCompare(String(second.id)))) map.set(String(point.id), project(point));
  const regionalSigma = 4.5 + landscape.landforms.regionalScale * 14, localSigma = 1.7 + landscape.landforms.localDetail * 4.8, regionalRadii = gaussianBoxRadii(regionalSigma), localRadii = gaussianBoxRadii(localSigma), regionalMass = gaussianImpulseMass(regionalRadii), localMass = gaussianImpulseMass(localRadii), pointValues = [...map.values()].map(point => clamp(point.value)), prominenceLow = percentile(pointValues, .62), prominenceHigh = percentile(pointValues, .93), densityGain = .32 + landscape.prominence.density * .9;
  for (const point of map.values()) { const visibility = clamp(point.visibility ?? 1), selected = clamp(point.value), uplift = visibility * (.12 + selected * .88), prominence = clamp((selected - prominenceLow) / Math.max(.03, prominenceHigh - prominenceLow)); addRasterSeed(broadSeeds, columns, rows, point.x, point.y, uplift * regionalMass); addRasterSeed(weightSeeds, columns, rows, point.x, point.y, regionalMass); if (prominence > 0) addRasterSeed(localRelief, columns, rows, point.x, point.y, prominence * landscape.landforms.localDetail * .34 * localMass); }
  const broadValues = gaussianBlurSeeds(broadSeeds, columns, rows, regionalRadii), weights = gaussianBlurSeeds(weightSeeds, columns, rows, regionalRadii), localDetail = gaussianBlurSeeds(localRelief, columns, rows, localRadii), values = new Float32Array(cellCount), support = new Float32Array(cellCount), edgeMask = new Float32Array(cellCount), fadeWidth = Math.max(5, regionalSigma * .7); for (let index = 0; index < values.length; index++) { const broad = weights[index] > .0001 ? broadValues[index] / weights[index] * (1 - Math.exp(-weights[index] * densityGain)) : 0, row = Math.floor(index / columns), column = index - row * columns, edge = clamp(Math.min(column, row, columns - 1 - column, rows - 1 - row) / fadeWidth), edgeFade = edge * edge * (3 - 2 * edge); values[index] = broad + localDetail[index]; edgeMask[index] = edgeFade; support[index] = clamp((1 - Math.exp(-weights[index] * densityGain)) * 1.8) * edgeFade; }
  const relationLayer = sigma => { const radii = gaussianBoxRadii(sigma); return { radii, lineMass: Math.sqrt(gaussianImpulseMass(radii)), seeds: null }; }, ridgeLayer = relationLayer(regionalSigma * .24), passLayer = relationLayer(regionalSigma * .32), valleyLayer = relationLayer(regionalSigma * .2), deposit = (layer, first, second, amplitude) => { layer.seeds ||= new Float32Array(cellCount); addCorridorSeeds(layer.seeds, columns, rows, first, second, amplitude, layer.lineMass); }, relationLimit = Math.max(24, Math.min(240, map.size * 3)), relationKey = relation => `${String(relation.source)}\0${String(relation.target)}\0${Number(relation.value)}`, selectedRelations = (relations || []).slice().sort((a, b) => Math.abs(Number(b.value || 0)) - Math.abs(Number(a.value || 0)) || relationKey(a).localeCompare(relationKey(b))).slice(0, relationLimit); for (const relation of selectedRelations) { const first = map.get(String(relation.source)), second = map.get(String(relation.target)); if (!first || !second) continue; const amount = clamp(Math.abs(relation.value)), different = first.community !== undefined && second.community !== undefined && first.community !== second.community; if (relation.value > 0) { const strength = different ? landscape.landforms.passes * .11 : landscape.landforms.ridges * .22; deposit(different ? passLayer : ridgeLayer, first, second, amount * strength); } else deposit(valleyLayer, first, second, -amount * landscape.landforms.valleys * (.16 + landscape.landforms.cliffs * .12)); }
  for (const layer of [ridgeLayer, passLayer, valleyLayer]) if (layer.seeds) { const relief = gaussianBlurSeeds(layer.seeds, columns, rows, layer.radii); for (let index = 0; index < values.length; index++) values[index] += relief[index]; }
  const smoothed = blurField(values, columns, rows, 1 + Math.round(landscape.landforms.regionalScale * 2)), detail = landscape.landforms.localDetail; for (let index = 0; index < values.length; index++) values[index] = smoothed[index] + (values[index] - smoothed[index]) * (.35 + detail * .9); normalizeField(values, landscape.landforms.relief, landscape.landforms.cliffs); for (let index = 0; index < values.length; index++) values[index] *= edgeMask[index];
  const waterEnabled = landscape.rivers > .001 || landscape.lakes > .001; let water = waterEnabled ? deriveWater(values, columns, rows, landscape.rivers, landscape.lakes) : { lakeDepth: new Float32Array(values.length), riverSegments: [] }; if (landscape.erosion > .001 && landscape.rivers > .001) { const logMaximum = Math.log1p(water.maximumFlow); for (let index = 0; index < values.length; index++) { const drainage = Math.log1p(water.flow[index]) / logMaximum; if (drainage > .34) values[index] = Math.max(0, values[index] - (drainage - .34) * landscape.erosion * .065); } normalizeField(values, landscape.landforms.relief, landscape.landforms.cliffs); water = deriveWater(values, columns, rows, landscape.rivers, landscape.lakes); }
  let maximum = 0; for (const value of values) maximum = Math.max(maximum, value); return { values, support, columns, rows, step: 1, world: resolvedWorld, landscape, shade: hillshade(values, columns, rows, landscape.landforms.relief), lakeDepth: water.lakeDepth, riverSegments: water.riverSegments, maximum };
}
