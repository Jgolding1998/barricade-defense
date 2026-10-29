import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, BALANCE, MAX_HEALTH} from '../src/game.js';
import {trackSpending} from '../tools/bots.js';

test('balance reports charge a full repair even when the final heal is capped', () => {
  for (const missing of [1, 2, 5, 6]) {
    const game = new Game(7129);
    game.health = MAX_HEALTH - missing;
    const credits = game.credits;
    const spend = {wall: 0, tower: 0, upgrade: 0, repair: 0};
    trackSpending(game, spend, () => {while (game.health < MAX_HEALTH) assert.equal(game.repair(), true);});
    assert.equal(spend.repair, credits - game.credits);
    assert.equal(spend.repair, Math.ceil(missing / 5) * 30);
  }
});

test('balance spending respects the supplied repair cost and amount', () => {
  const game = new Game(7129, {...BALANCE, repairCost: 17, repairAmount: 7});
  game.health = MAX_HEALTH - 2;
  const credits = game.credits;
  const spend = {wall: 0, tower: 0, upgrade: 0, repair: 0};
  trackSpending(game, spend, () => game.repair());
  assert.equal(spend.repair, 17);
  assert.equal(spend.repair, credits - game.credits);
});

test('building and upgrading in one plan separates initial tower cost from upgrades', () => {
  const game = new Game(7129);
  const credits = game.credits;
  const spend = {wall: 0, tower: 0, upgrade: 0, repair: 0};
  trackSpending(game, spend, () => {
    assert.equal(game.build(0, 'dart'), true);
    assert.equal(game.upgrade(0), true);
  });
  assert.equal(spend.tower, 45);
  assert.ok(spend.upgrade > 0);
  assert.equal(spend.tower + spend.upgrade, credits - game.credits);
});
