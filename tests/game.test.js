import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, WIDTH, HEIGHT, STEP, ENTRY, EXIT, TYPES, field, neighbors, random} from '../src/game.js';

test('the map starts with routes from both gates and a finite field', () => {
  const game = new Game();
  for (const entry of ENTRY) {
    const route = game.route(entry);
    assert.equal(route[0], entry);
    assert.equal(route.at(-1), EXIT);
    assert.ok(route.length < WIDTH * HEIGHT);
  }
  assert.equal(game.credits, 170);
  assert.equal(game.health, 20);
  assert.equal(game.phase, 'planning');
});

test('path fields use cardinal neighbors without row wrapping', () => {
  assert.deepEqual(neighbors(0), [1, WIDTH]);
  assert.ok(!neighbors(WIDTH - 1).includes(WIDTH));
  const distances = field(new Set());
  assert.equal(distances[EXIT], 0);
  for (const entry of ENTRY) assert.ok(distances[entry] > 0);
});

test('building is atomic and cannot spend beyond available credits', () => {
  const game = new Game();
  assert.equal(game.build(49, 'cannon'), true);
  assert.equal(game.credits, 85);
  assert.equal(game.build(49, 'dart'), false);
  assert.equal(game.credits, 85);
  assert.equal(game.build(50, 'cannon'), true);
  assert.equal(game.credits, 0);
  assert.equal(game.build(51, 'wall'), false);
  assert.equal(game.structures.size, 2);
});

test('a final blockade is rejected with no charge and existing routes survive', () => {
  const game = new Game();
  game.credits = 1000;
  for (let row = 0; row < HEIGHT - 1; row++) assert.equal(game.build(row * WIDTH + 3, 'wall'), true);
  const credits = game.credits;
  const fieldBefore = [...game.distances];
  assert.equal(game.build((HEIGHT - 1) * WIDTH + 3, 'wall'), false);
  assert.equal(game.credits, credits);
  assert.deepEqual([...game.distances], fieldBefore);
  assert.ok(game.message.includes('route'));
});

test('enemy occupied cells and reserved destinations cannot be blocked', () => {
  const game = new Game();
  game.launch(); game.step();
  const enemy = game.enemies[0];
  assert.equal(game.build(enemy.cell, 'wall'), false);
  assert.equal(game.build(enemy.next, 'wall'), false);
  assert.equal(game.credits, 170);
});

test('upgrades are capped and selling cannot manufacture credits', () => {
  const game = new Game();
  game.credits = 1000;
  assert.ok(game.build(49, 'dart'));
  const first = game.towerStats(game.structures.get(49));
  assert.ok(game.upgrade(49)); assert.ok(game.upgrade(49));
  const last = game.towerStats(game.structures.get(49));
  assert.ok(last.damage > first.damage && last.range > first.range && last.reload < first.reload);
  assert.equal(game.upgrade(49), false);
  const remaining = game.credits;
  const invested = game.structures.get(49).invested;
  assert.ok(game.sell(49));
  assert.equal(game.credits, remaining + Math.floor(invested * .6));
  assert.ok(game.credits < 1000);
  assert.equal(game.sell(49), false);
});

test('repairs share build credits and are only allowed between waves', () => {
  const game = new Game();
  assert.equal(game.repair(), false);
  game.health = 10;
  assert.ok(game.repair());
  assert.equal(game.health, 15); assert.equal(game.credits, 140);
  game.launch(); assert.equal(game.repair(), false);
});

test('a paused run freezes simulation and cannot launch or spend', () => {
  const game = new Game(); game.launch(); game.step();
  game.paused = true;
  const before = JSON.stringify({time:game.time,enemies:game.enemies,credits:game.credits});
  game.step(); assert.equal(game.build(49, 'dart'), false); assert.equal(game.launch(), false);
  assert.equal(JSON.stringify({time:game.time,enemies:game.enemies,credits:game.credits}), before);
});

test('without defenses, enemies reach the core and end the run', () => {
  const game = new Game();
  let steps = 0;
  while (game.phase !== 'lost' && steps < 30000) {
    if (game.phase === 'planning') game.launch();
    game.step(STEP); steps++;
  }
  assert.equal(game.phase, 'lost');
  assert.equal(game.health, 0);
  assert.ok(game.escaped >= 20);
  assert.equal(game.launch(), false);
});

test('a working tower earns kill credits and only one reward per enemy', () => {
  const game = new Game();
  game.build(49, 'dart'); game.launch(); game.step();
  const enemy = game.enemies[0], before = game.credits;
  game.hit(enemy, 1000); game.hit(enemy, 1000);
  assert.equal(game.kills, 1);
  assert.equal(game.credits, before + enemy.reward);
});

test('a wave awards one supply bonus and cannot be launched twice', () => {
  const game = new Game(); game.launch(); assert.equal(game.launch(), false);
  game.pending = []; game.enemies = [];
  game.step(); const credits = game.credits;
  assert.equal(game.phase, 'planning'); assert.equal(credits, 193);
  for (let i = 0; i < 100; i++) game.step();
  assert.equal(game.credits, credits);
});

test('invalid inputs do not corrupt money, paths or time', () => {
  const game = new Game();
  for (const cell of [-1, 160, NaN, Infinity, 4.5, '__proto__', null]) assert.equal(game.build(cell, 'dart'), false);
  for (const kind of ['__proto__', 'constructor', '', null, {}]) assert.equal(game.build(49, kind), false);
  game.launch();
  for (const delta of [NaN, Infinity, -1, 0, 10, '1', null]) game.step(delta);
  assert.equal(game.time, 0); assert.equal(game.enemies.length, 0); assert.equal(game.credits, 170);
});

test('one-shot events and visual effects expire between waves', () => {
  const game = new Game(); game.launch(); game.pending = [];
  game.spawn('scout'); game.enemies[0].cell = EXIT;
  game.effects = [{kind:'shot', life:0.1}];
  game.step();
  assert.equal(game.phase, 'planning'); assert.ok(game.events.includes('leak'));
  for (let i = 0; i < 60; i++) game.step();
  assert.deepEqual(game.events, []); assert.deepEqual(game.effects, []);
});

test('different seeds vary enemy timing and traits within a narrow fair band', () => {
  const first = new Game(1), second = new Game(2);
  for (const game of [first,second]) { game.launch(); game.step(); }
  assert.notEqual(first.enemies[0].hp, second.enemies[0].hp);
  assert.ok(first.enemies[0].hp >= 28.8 && first.enemies[0].hp <= 31.2);
});

test('restart restores the exact opening state', () => {
  const game = new Game(32); game.build(49, 'dart'); game.launch();
  for (let i = 0; i < 300; i++) game.step();
  game.reset();
  assert.equal(game.credits, 170); assert.equal(game.health, 20);
  assert.equal(game.wave, 0); assert.equal(game.structures.size, 0); assert.equal(game.enemies.length, 0);
  assert.equal(game.paused, false); assert.equal(game.phase, 'planning');
});

test('seeded random values and identical runs are reproducible', () => {
  const a = random(218), b = random(218);
  assert.deepEqual(Array.from({length:100},a), Array.from({length:100},b));
  const first = new Game(218), second = new Game(218);
  for (const game of [first, second]) {
    game.build(49, 'dart'); game.build(113, 'cannon'); game.launch();
    for (let i = 0; i < 3000; i++) game.step();
  }
  const {rng: firstRandom, ...firstState} = first;
  const {rng: secondRandom, ...secondState} = second;
  assert.deepEqual(firstState, secondState);
});
