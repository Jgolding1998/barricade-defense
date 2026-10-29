import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainLayer} from '../src/terrain.js';

const geometry = {width: 16, height: 10, cell: 54, left: 48, top: 28, viewWidth: 960, viewHeight: 610};

function fixture() {
  const counts = {fill: 0, stroke: 0, transforms: []};
  const context = {
    fillRect() { counts.fill++; }, strokeRect() { counts.stroke++; },
    setTransform(...args) { counts.transforms.push(args); },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  };
  const surface = {width: 0, height: 0, getContext() { return context; }};
  let allocations = 0;
  const layer = createTerrainLayer(geometry, () => { allocations++; return surface; });
  return {layer, surface, counts, allocations: () => allocations};
}

test('steady frames reuse one terrain surface without repainting its cells', () => {
  const {layer, surface, counts, allocations} = fixture();
  layer.resize(1, new Set([5, 21]));
  assert.equal(counts.fill, 165);
  assert.equal(counts.stroke, 160);
  const before = {...counts};
  let images = 0, saves = 0, restores = 0;
  const target = {save() { saves++; }, restore() { restores++; },
    setTransform(...args) { assert.deepEqual(args, [1, 0, 0, 1, 0, 0]); },
    drawImage(...args) { assert.deepEqual(args, [surface, 0, 0]); images++; }};
  for (let frame = 0; frame < 120; frame++) layer.draw(target);
  assert.deepEqual(counts, before);
  assert.equal(allocations(), 1);
  assert.equal(images, 120);
  assert.equal(saves, restores);
});

test('DPR and resize rebuild the existing surface with a bounded backing store', () => {
  const {layer, surface, counts, allocations} = fixture();
  for (const ratio of [1, 1.25, 2, 20, NaN, 0]) {
    layer.resize(ratio, new Set());
    const scale = ratio > 0 && Number.isFinite(ratio) ? Math.min(2, ratio) : 1;
    assert.equal(surface.width, Math.round(960 * scale));
    assert.equal(surface.height, Math.round(610 * scale));
    assert.deepEqual(counts.transforms.at(-1), [scale, 0, 0, scale, 0, 0]);
    assert.ok(surface.width * surface.height <= 1920 * 1220);
  }
  assert.equal(allocations(), 1);
});

test('a new run repaints its current rock layout rather than retaining old cells', () => {
  const {layer, counts} = fixture();
  layer.resize(1, new Set([5, 21]));
  const previous = counts.fill;
  layer.resize(1, new Set([37]));
  assert.equal(counts.fill - previous, 163);
  assert.equal(counts.stroke, 320);
});
