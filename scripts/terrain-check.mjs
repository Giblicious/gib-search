import assert from 'node:assert/strict';
import { buildSemanticTerrain, deriveWater, normalizeLandscape, priorityFlood } from '../src/terrain-engine.js';

const quietLandscape = {
  prominence: { coherence: .5, intensity: .5, distinctiveness: .5, density: .5 },
  landforms: { regionalScale: .35, localDetail: .7, relief: .7, ridges: 1, valleys: 1, cliffs: .4, passes: .4 },
  erosion: 0,
  rivers: 0,
  lakes: 0,
};

function sample(terrain, x, y) {
  const column = Math.max(0, Math.min(terrain.columns - 1, Math.round((x - terrain.world.left) / (terrain.world.right - terrain.world.left) * (terrain.columns - 1))));
  const row = Math.max(0, Math.min(terrain.rows - 1, Math.round((y - terrain.world.top) / (terrain.world.bottom - terrain.world.top) * (terrain.rows - 1))));
  return terrain.values[row * terrain.columns + column];
}

function typedEqual(first, second, message) {
  assert.equal(first.constructor, second.constructor, `${message}: array types differ`);
  assert.equal(first.length, second.length, `${message}: array lengths differ`);
  const a = Buffer.from(first.buffer, first.byteOffset, first.byteLength), b = Buffer.from(second.buffer, second.byteOffset, second.byteLength);
  assert.equal(Buffer.compare(a, b), 0, message);
}

function assertFiniteTerrain(terrain, label) {
  assert.ok(terrain.columns >= 96 && terrain.rows >= 96, `${label}: invalid dimensions`);
  for (const [name, values] of [['height', terrain.values], ['support', terrain.support], ['shade', terrain.shade], ['lake', terrain.lakeDepth]]) for (const value of values) assert.ok(Number.isFinite(value), `${label}: non-finite ${name}`);
  for (let column = 0; column < terrain.columns; column++) for (const index of [column, (terrain.rows - 1) * terrain.columns + column]) { assert.ok(terrain.values[index] <= 1e-6, `${label}: height does not fade at the map boundary`); assert.ok(terrain.support[index] <= 1e-6, `${label}: support does not fade at the map boundary`); } for (let row = 0; row < terrain.rows; row++) for (const index of [row * terrain.columns, row * terrain.columns + terrain.columns - 1]) { assert.ok(terrain.values[index] <= 1e-6, `${label}: height does not fade at the map boundary`); assert.ok(terrain.support[index] <= 1e-6, `${label}: support does not fade at the map boundary`); }
  for (const segment of terrain.riverSegments) assert.ok(Number.isInteger(segment.from) && Number.isInteger(segment.to) && Number.isFinite(segment.strength), `${label}: invalid river segment`);
}

{
  const points = [
    { id: 'A', x: -.55, y: 0, value: .72, community: 1 },
    { id: 'B', x: .55, y: 0, value: .72, community: 1 },
    { id: 'C', x: 0, y: .72, value: .35, community: 2 },
    { id: 'D', x: 0, y: -.72, value: .25, community: 3 },
  ];
  const without = buildSemanticTerrain({ points, landscape: quietLandscape, resolution: 128 });
  const withRidge = buildSemanticTerrain({ points, relations: [{ source: 'A', target: 'B', value: 1 }], landscape: quietLandscape, resolution: 128 });
  assert.ok(sample(withRidge, 0, 0) > sample(without, 0, 0) + .3, 'A strong positive relationship did not raise a meaningful connecting ridge');
  assert.ok(sample(withRidge, -.25, 0) > sample(without, -.25, 0) + .3 && sample(withRidge, .25, 0) > sample(without, .25, 0) + .3, 'A relationship ridge became dotted or discontinuous');
  assert.ok(sample(withRidge, -.55, 0) >= .9 && sample(withRidge, .55, 0) >= .9, 'A relationship ridge displaced its endpoint summits');
}

{
  const landscape = { ...quietLandscape, landforms: { ...quietLandscape.landforms, regionalScale: .8, localDetail: .3, relief: .55, cliffs: .7 } };
  const points = [
    { id: 'A', x: -.25, y: 0, value: .7, community: 1 },
    { id: 'B', x: .25, y: 0, value: .7, community: 1 },
    { id: 'C', x: 0, y: .6, value: .4, community: 2 },
    { id: 'D', x: 0, y: -.6, value: .3, community: 3 },
  ];
  const without = buildSemanticTerrain({ points, landscape, resolution: 128 });
  const withValley = buildSemanticTerrain({ points, relations: [{ source: 'A', target: 'B', value: -1 }], landscape, resolution: 128 });
  assert.ok(sample(withValley, 0, 0) < sample(without, 0, 0) - .3, 'A strong negative relationship did not carve a meaningful valley');
}

{
  const points = [{ id: 'summit', x: 0, y: 0, value: 1 }];
  for (let index = 0; index < 40; index++) { const angle = index / 40 * Math.PI * 2, radius = .12 + index % 3 * .015; points.push({ id: `low-${index}`, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, value: .08 }); }
  const broad = buildSemanticTerrain({ points, landscape: { ...quietLandscape, landforms: { ...quietLandscape.landforms, regionalScale: .85, localDetail: 0, relief: .55, cliffs: .2 } }, resolution: 128 });
  const detailed = buildSemanticTerrain({ points, landscape: { ...quietLandscape, landforms: { ...quietLandscape.landforms, regionalScale: .85, localDetail: 1, relief: .55, cliffs: .2 } }, resolution: 128 });
  const broadHighArea = [...broad.values].filter(value => value >= .9).length, detailedHighArea = [...detailed.values].filter(value => value >= .9).length;
  assert.ok(sample(detailed, 0, 0) >= .99, 'Local summit prominence was diluted by broad neighborhood weights');
  assert.ok(detailedHighArea < broadHighArea * .45, `Local detail did not resolve the broad plateau (${detailedHighArea} vs ${broadHighArea} cells)`);
}

{
  const points = [
    { id: 'one', x: -.4, y: -.1, value: .9, community: 1 },
    { id: 'two', x: .2, y: .3, value: .5, community: 2 },
    { id: 'three', x: .55, y: -.45, value: .2, community: 1 },
    { id: 'four', x: -.1, y: .65, value: .7, community: 2 },
  ];
  const relations = [
    { source: 'one', target: 'two', value: .72 },
    { source: 'two', target: 'three', value: -.58 },
    { source: 'one', target: 'four', value: .41 },
  ];
  const first = buildSemanticTerrain({ points, relations, resolution: 128 }), repeated = buildSemanticTerrain({ points: [...points].reverse(), relations: [...relations].reverse(), resolution: 128 });
  typedEqual(first.values, repeated.values, 'Terrain height is not deterministic under input ordering');
  typedEqual(first.shade, repeated.shade, 'Hillshade is not deterministic under input ordering');
  typedEqual(first.lakeDepth, repeated.lakeDepth, 'Lakes are not deterministic under input ordering');
  assert.deepEqual(first.riverSegments, repeated.riverSegments, 'Rivers are not deterministic under input ordering');
}

{
  const malformed = normalizeLandscape(null, null), invalidContours = normalizeLandscape({ contours: Number.NaN }); assert.equal(malformed.source, 'view'); assert.equal(invalidContours.contours, 9);
  const edgeCases = [
    buildSemanticTerrain({ points: [], resolution: 96 }),
    buildSemanticTerrain({ points: [{ id: 'only', x: 0, y: 0, value: 1 }], resolution: 96 }),
    buildSemanticTerrain({ points: [{ id: 'a', x: 0, y: 0, value: .2 }, { id: 'b', x: 0, y: 0, value: .8 }], relations: [{ source: 'a', target: 'b', value: 1 }], resolution: 96 }),
    buildSemanticTerrain({ points: [{ id: 'bad', x: Number.NaN, y: Number.POSITIVE_INFINITY, value: Number.NaN }], world: { left: 0, right: 0, top: 0, bottom: 0 }, resolution: 96 }),
  ];
  edgeCases.forEach((terrain, index) => assertFiniteTerrain(terrain, `edge case ${index + 1}`));
  assert.equal(edgeCases[0].riverSegments.length, 0, 'An empty landscape produced rivers');
  assert.equal(edgeCases[0].maximum, 0, 'An empty landscape produced relief');
  const emptyFlood = priorityFlood(new Float32Array(), 0, 0); assert.equal(emptyFlood.orderCount, 0);
  assert.throws(() => priorityFlood(new Float32Array(3), 2, 2), RangeError, 'Mismatched hydrology dimensions were silently accepted');
}

{
  const columns = 19, rows = 19, values = new Float32Array(columns * rows); for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) { const basin = Math.hypot(column - 9, row - 9) / 18, channel = Math.abs(column - 9) * .012; values[row * columns + column] = .12 + basin * .55 + channel; } values[9 * columns + 9] = .01;
  const water = deriveWater(values, columns, rows, 1, 1), orderPosition = new Int32Array(values.length).fill(-1); for (let position = 0; position < water.orderCount; position++) orderPosition[water.order[position]] = position;
  assert.ok(water.riverSegments.length > 0, 'Hydrology did not produce any river paths');
  assert.ok(water.lakeDepth[9 * columns + 9] > 0, 'A genuine enclosed basin did not produce a lake');
  for (let position = 1; position < water.orderCount; position++) assert.ok(water.filled[water.order[position]] + 1e-7 >= water.filled[water.order[position - 1]], 'Priority flood heap emitted heights out of order');
  for (let index = 0; index < water.parent.length; index++) {
    const parent = water.parent[index]; if (parent < 0) continue; assert.ok(orderPosition[parent] < orderPosition[index], 'Hydrology parent was not finalized before its child'); assert.ok(water.filled[index] + 1e-7 >= water.filled[parent], 'A flow edge runs uphill on the filled terrain'); assert.ok(water.flow[parent] >= water.flow[index], 'Flow accumulation decreased downstream'); let cursor = index, steps = 0; while (water.parent[cursor] >= 0 && steps <= values.length) { cursor = water.parent[cursor]; steps++; } assert.ok(steps <= values.length, 'Hydrology contains a flow cycle');
  }
  for (const segment of water.riverSegments) { assert.equal(water.parent[segment.from], segment.to, 'River segment diverges from the drainage tree'); assert.ok(water.filled[segment.from] + 1e-7 >= water.filled[segment.to], 'A rendered river segment runs uphill'); }
}

function benchmark() {
  let state = 0x6d2b79f5; const random = () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 4294967296), count = 450, points = Array.from({ length: count }, (_, index) => ({ id: `note-${String(index).padStart(3, '0')}`, x: random() * 2 - 1, y: random() * 2 - 1, value: random(), visibility: 1, community: Math.floor(random() * 12) })), relations = [];
  for (let index = 0; index < count; index++) for (let offset = 1; offset <= 3; offset++) { const target = (index + offset * 17) % count; if (index < target) relations.push({ source: points[index].id, target: points[target].id, value: random() * 2 - 1 }); }
  const measure = (resolution, landscape, iterations = 9) => { for (let iteration = 0; iteration < 3; iteration++) buildSemanticTerrain({ points, relations, resolution, landscape }); const samples = []; for (let iteration = 0; iteration < iterations; iteration++) { const started = performance.now(), terrain = buildSemanticTerrain({ points, relations, resolution, landscape }); samples.push(performance.now() - started); assertFiniteTerrain(terrain, `450-note ${resolution} benchmark`); } samples.sort((a, b) => a - b); return { resolution, median: samples[Math.floor(samples.length / 2)], range: [samples[0], samples.at(-1)] }; };
  const workingLandscape = { erosion: 0, rivers: 0, lakes: 0 }, working = [96, 128, 176].map(resolution => measure(resolution, workingLandscape)), settled = measure(176, {}, 7), budgets = new Map([[96, 18], [128, 30], [176, 45]]); for (const value of working) assert.ok(value.median < budgets.get(value.resolution), `450-note ${value.resolution} working terrain exceeded its UI budget (${value.median.toFixed(1)} ms)`); assert.ok(settled.median < 120, `450-note settled terrain exceeded its safety budget (${settled.median.toFixed(1)} ms)`); return { working, settled };
}

const result = benchmark();
console.log(`Terrain checks passed. Working 450-note terrain: ${result.working.map(value => `${value.resolution}² ${value.median.toFixed(1)} ms`).join(' · ')}. Settled 176² ${result.settled.median.toFixed(1)} ms.`);
