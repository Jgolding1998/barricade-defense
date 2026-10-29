import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, BALANCE, STEP} from '../src/game.js';
import {createPlanningPreview} from '../src/preview.js';

test('unchanged planning previews reuse one checked field across frames', () => {
  const game = new Game();
  const expected = game.preview(49, 'dart');
  const original = game.preview.bind(game);
  let calculations = 0;
  game.preview = (...args) => { calculations++; return original(...args); };
  const preview = createPlanningPreview(game);
  for (let frame = 0; frame < 120; frame++) assert.deepEqual(preview(49, 'dart'), expected);
  assert.equal(calculations, 1);
});

test('layout, money, tool and price changes update planning validity', () => {
  const game = new Game(7129, {...BALANCE});
  const preview = createPlanningPreview(game);
  assert.equal(preview(49, 'dart').cost, 45);
  game.credits = 44;
  assert.equal(preview(49, 'dart').ok, false);
  game.credits = 170;
  assert.equal(preview(49, 'wall').cost, 9);
  assert.equal(game.build(51, 'wall'), true);
  assert.equal(preview(49, 'wall').cost, 10);
  game.balance.wallCostStep = 2;
  assert.equal(preview(49, 'wall').cost, 11);
  assert.equal(game.build(49, 'dart'), true);
  assert.equal(preview(49, 'dart').ok, false);
  assert.equal(game.sell(49), true);
  assert.equal(preview(49, 'dart').ok, true);
});

test('live wave previews always validate moving enemy occupancy again', () => {
  const game = new Game();
  const preview = createPlanningPreview(game);
  assert.equal(preview(33, 'dart').ok, true);
  game.launch();
  game.step(STEP);
  assert.equal(preview(33, 'dart').ok, false);
  let last;
  for (let step = 0; step < 120; step++) {
    game.step(STEP);
    const actual = preview(33, 'dart');
    assert.deepEqual(actual, game.preview(33, 'dart'));
    assert.notEqual(actual, last);
    last = actual;
  }
});

test('pause and resume cannot preserve an actionable stale preview', () => {
  const game = new Game();
  const preview = createPlanningPreview(game);
  assert.equal(preview(49, 'dart').ok, true);
  game.setPaused(true);
  assert.equal(preview(49, 'dart').ok, false);
  game.setPaused(false);
  assert.equal(preview(49, 'dart').ok, true);
  game.build(49, 'dart');
  assert.equal(preview(49, 'dart').ok, false);
  game.reset();
  assert.equal(preview(49, 'dart').ok, true);
});
