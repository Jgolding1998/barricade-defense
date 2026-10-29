import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, BALANCE, ENTRY, EXIT, MAX_HEALTH, STEP, TYPES, WAVES, WIDTH, HEIGHT, random} from '../src/game.js';
import {isPauseKey, ignoreKey, isTypingTarget} from '../src/keys.js';
import {playRun} from '../tools/bots.js';

test('a finished run cannot be paused, so the result stays visible', () => {
  const game = new Game();
  assert.equal(game.setPaused(true), true);
  assert.equal(game.setPaused(false), false);
  game.phase = 'lost';
  assert.equal(game.setPaused(true), false);
  assert.equal(game.paused, false);
  game.phase = 'won';
  assert.equal(game.setPaused(true), false);
});

test('a lost run is left unpaused', () => {
  const game = new Game();
  game.health = 1;
  game.launch();
  game.pending = [];
  game.spawn('scout');
  game.enemies[0].cell = EXIT;
  game.step();
  assert.equal(game.phase, 'lost');
  assert.equal(game.paused, false);
});

test('each standing barricade raises the next one, and the charge matches the quote', () => {
  const game = new Game();
  game.credits = 500;
  const cells = [49, 50, 51];
  let expected = TYPES.wall.cost;
  for (const cell of cells) {
    const quote = game.preview(cell, 'wall');
    assert.equal(quote.cost, expected);
    const before = game.credits;
    assert.ok(game.build(cell, 'wall'));
    assert.equal(before - game.credits, expected);
    assert.equal(game.structures.get(cell).invested, expected);
    expected += BALANCE.wallCostStep;
  }
  assert.equal(game.costOf('wall'), expected);
  game.sell(51);
  assert.equal(game.costOf('wall'), expected - BALANCE.wallCostStep, 'selling a wall lowers the price again');
  assert.equal(game.costOf('dart'), TYPES.dart.cost, 'tower prices never escalate');
  assert.equal(game.costOf('__proto__'), Infinity);
});

test('a win scores remaining core integrity', () => {
  const full = new Game(), hurt = new Game();
  for (const game of [full, hurt]) {
    game.wave = WAVES - 1;
    game.launch();
    game.pending = [];
  }
  hurt.health = 5;
  full.step(); hurt.step();
  assert.equal(full.phase, 'won');
  assert.equal(full.score - hurt.score, (MAX_HEALTH - 5) * BALANCE.winHealthBonus);
  assert.match(full.message, /20 core integrity/);
});

test('planning messages preview the next wave', () => {
  const game = new Game();
  assert.match(game.message, /Next: wave 1, 9 scouts/);
  game.wave = 3;
  assert.match(game.describeNextWave(), /wave 4, .*runners, .*armored/);
  game.wave = WAVES;
  assert.equal(game.describeNextWave(), '');
});

test('enemy toughness compounds per wave within a bounded curve', () => {
  const game = new Game();
  const hp = w => game.enemyHp('scout', w);
  assert.equal(hp(1), BALANCE.hpBase + BALANCE.hpPerWave);
  for (let w = 2; w <= WAVES; w++) assert.ok(hp(w) > hp(w - 1));
  assert.ok(hp(WAVES) < 1000, `wave ${WAVES} scout hp ${hp(WAVES)}`);
});

// Random walls built while enemies are on the board: both gates and every
// enemy must always keep a route, and nobody may stall short of the core.
test('fuzzed mid-wave building never seals a gate or strands an enemy', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const game = new Game(seed);
    const rand = random(seed * 101);
    game.credits = 100000;
    const stalled = new Map();
    let midWaveBuilds = 0;
    for (let wave = 0; wave < 3; wave++) {
      game.launch();
      for (let i = 0; i < 60 * 40 && game.phase === 'wave'; i++) {
        if (i % 7 === 0) {
          const cell = Math.floor(rand() * WIDTH * HEIGHT);
          if (rand() < 0.85) { if (game.build(cell, 'wall') && game.enemies.length) midWaveBuilds++; }
          else game.sell(cell);
        }
        game.step(STEP);
        for (const entry of ENTRY) assert.ok(game.distances[entry] > 0, `gate ${entry} sealed`);
        for (const enemy of game.enemies) {
          assert.ok(game.distances[enemy.cell] >= 0, `enemy ${enemy.id} on a cut-off cell`);
          const key = `${enemy.cell}:${enemy.progress.toFixed(4)}`;
          const seen = stalled.get(enemy.id);
          stalled.set(enemy.id, seen && seen.key === key ? {key, count: seen.count + 1} : {key, count: 0});
          assert.ok(stalled.get(enemy.id).count < 5, `enemy ${enemy.id} stalled`);
        }
      }
      // Without towers every enemy leaks, so waves must still end on their own.
      assert.equal(game.phase === 'wave', false, 'wave finished');
      if (game.phase === 'lost') break;
    }
    assert.ok(midWaveBuilds >= 20, `only ${midWaveBuilds} mid-wave builds for seed ${seed}`);
  }
});

test('balance: doing nothing loses fast, towers alone fall short, mixed play wins', () => {
  const seeds = [1000, 1037, 1074];
  for (const seed of seeds) {
    const none = playRun('none', seed);
    assert.equal(none.phase, 'lost');
    assert.ok(none.wave <= 3);
    const towers = playRun('towers', seed);
    assert.equal(towers.phase, 'lost', 'towers without route shaping should not hold all waves');
    assert.ok(towers.wave >= 8, `towers-only should survive most waves, got ${towers.wave}`);
    const balanced = playRun('balanced', seed);
    assert.equal(balanced.phase, 'won');
    assert.ok(balanced.walls >= 3 && balanced.walls <= 15);
    const upgrader = playRun('upgrader', seed);
    assert.equal(upgrader.phase, 'won', 'an upgrade-heavy plan is also viable');
  }
});

test('balance: repairs buy real time for a struggling defense', () => {
  const plain = playRun('towers', 1000);
  const repaired = playRun('repairFirst', 1000);
  assert.ok(repaired.spend.repair > 0);
  assert.ok(repaired.wave > plain.wave || repaired.score > plain.score, 'repair should extend the run');
});

test('keyboard guards: Space pauses from the board, not from buttons or fields', () => {
  assert.equal(isPauseKey({code: 'Space', key: ' ', target: {tagName: 'CANVAS'}}), true);
  assert.equal(isPauseKey({code: 'Space', key: ' ', target: {tagName: 'BODY'}}), true);
  assert.equal(isPauseKey({code: 'Space', key: ' ', target: {tagName: 'BUTTON'}}), false);
  assert.equal(isPauseKey({code: 'Space', key: ' ', target: {tagName: 'A'}}), false);
  assert.equal(isPauseKey({code: 'KeyP', key: 'P', target: {tagName: 'BUTTON'}}), true);
  assert.equal(isPauseKey({code: 'KeyN', key: 'n', target: {tagName: 'CANVAS'}}), false);
  for (const tagName of ['INPUT', 'textarea', 'SELECT']) assert.equal(isTypingTarget({tagName}), true);
  assert.equal(isTypingTarget({tagName: 'DIV', isContentEditable: true}), true);
  assert.equal(isTypingTarget({tagName: 'CANVAS'}), false);
  assert.equal(ignoreKey({key: 'n', target: {tagName: 'INPUT'}}), true);
  assert.equal(ignoreKey({key: 'n', ctrlKey: true, target: {tagName: 'BODY'}}), true);
  assert.equal(ignoreKey({key: 'n', target: {tagName: 'BODY'}}), false);
});

test('barricades lock during a live wave but towers can still be sold', () => {
  const game = new Game();
  game.credits = 500;
  assert.ok(game.build(49, 'wall'));
  assert.ok(game.build(97, 'dart'));
  game.launch();
  game.step();
  assert.equal(game.canSell(49), false);
  const credits = game.credits;
  assert.equal(game.sell(49), false);
  assert.equal(game.credits, credits);
  assert.match(game.message, /lock in place/);
  assert.equal(game.canSell(97), true);
  assert.ok(game.sell(97));
  game.pending = [];
  game.enemies = [];
  game.step();
  assert.equal(game.phase, 'planning');
  assert.ok(game.sell(49), 'walls sell normally between waves');
});

test('toggling a barricade mid-wave cannot stall enemies for free', () => {
  const game = new Game(1000);
  game.credits = 2000;
  for (const cell of [49, 50, 65]) assert.ok(game.build(cell, 'wall'));
  game.wave = 5;
  game.launch();
  let sells = 0;
  for (let i = 0; i < 60 * 60 && game.phase === 'wave'; i++) {
    if (i % 20 === 0) {
      for (const [cell, s] of game.structures) if (s.kind === 'wall' && game.sell(cell)) sells++;
    }
    game.step(STEP);
  }
  assert.equal(sells, 0);
  for (const cell of [49, 50, 65]) assert.equal(game.structures.get(cell)?.kind, 'wall');
});

test('enemies record their previous position for render interpolation', () => {
  const game = new Game();
  game.launch();
  for (let i = 0; i < 30; i++) game.step(STEP);
  const enemy = game.enemies[0];
  const {x, y} = enemy;
  game.step(STEP);
  assert.equal(enemy.px, x);
  assert.equal(enemy.py, y);
  assert.ok(Math.hypot(enemy.x - enemy.px, enemy.y - enemy.py) <= enemy.speed * STEP + 1e-9);
});
