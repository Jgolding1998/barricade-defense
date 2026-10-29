import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, BALANCE, STEP, RUN_MODES, LIMITS, difficulty, waveComposition} from '../src/game.js';
import {playRun} from '../tools/bots.js';

test('campaign targets finish once, while endless continues with capped contacts and difficulty', () => {
  for (const mode of Object.keys(RUN_MODES)) {
    const game = new Game(4, BALANCE, mode), target = RUN_MODES[mode].waves;
    for (let wave = 1; wave <= (target || 150); wave++) {
      assert.equal(game.launch(), true); assert.equal(game.wave, wave);
      assert.ok(game.pending.length <= LIMITS.contacts);
      game.pending = []; game.step(STEP);
      assert.equal(game.phase, wave === target ? 'won' : 'planning');
      assert.ok(Number.isSafeInteger(game.credits) && Number.isSafeInteger(game.score));
    }
    if (target) {
      const score = game.score; assert.equal(game.launch(), false); game.step(STEP);
      assert.equal(game.score, score);
    }
    game.reset(); assert.equal(game.mode, mode); assert.equal(game.wave, 0);
    game.reset(2, 'endless'); assert.equal(game.targetWaves, null);
  }
  assert.equal(new Game().mode, 'classic');
  assert.equal(new Game(1, BALANCE, '__proto__').mode, 'classic');
  for (const wave of [24, 60, 1000000, Number.MAX_SAFE_INTEGER]) assert.ok(waveComposition(wave).length <= 55);
  assert.equal(difficulty(12), 12); assert.equal(difficulty(24), 16.8); assert.equal(difficulty(1000000), 24);
  assert.equal(new Game().enemyHp('tank', 60), new Game().enemyHp('tank', 1000000));
});

test('all modes retain the exact first twelve wave numbers and fixed-input simulation', () => {
  const games = Object.keys(RUN_MODES).map(mode => new Game(41, BALANCE, mode));
  for (let wave = 1; wave <= 12; wave++) {
    for (const game of games) game.launch();
    for (let i = 0; i < 40; i++) {
      for (const game of games) game.step(STEP);
      const copies = games.map(g => {const s = {...g}; delete s.rng; delete s.mode; delete s.targetWaves; return s;});
      assert.deepEqual(copies[0], copies[1]); assert.deepEqual(copies[0], copies[2]);
    }
    if (wave < 12) for (const game of games) {game.pending = []; game.enemies = []; game.step(STEP);}
    const originalHp = (BALANCE.hpBase + wave * BALANCE.hpPerWave) * BALANCE.hpGrowth ** (wave - 1);
    assert.equal(games[0].enemyHp('scout'), originalHp);
  }
});

test('new finite campaign completes under a deterministic strategy and endless retains bounded state', () => {
  const result = playRun('balanced', 1000, {mode: 'extended'});
  assert.equal(result.phase, 'won'); assert.equal(result.wave, 24);
  const endless = new Game(3, BALANCE, 'endless');
  endless.wave = 1000000; endless.launch();
  for (let i = 0; i < 12000 && endless.phase === 'wave'; i++) {
    endless.health = 20; endless.step(STEP);
    assert.ok(endless.enemies.length + endless.pending.length <= 55);
    assert.ok(endless.effects.length <= LIMITS.effects && endless.events.length <= LIMITS.events);
    for (const e of endless.enemies) assert.ok(Number.isFinite(e.hp) && e.hp > 0 && e.speed < 4);
  }
  endless.credits = endless.score = Number.MAX_SAFE_INTEGER; endless.finishWave();
  assert.equal(endless.credits, Number.MAX_SAFE_INTEGER); assert.equal(endless.score, Number.MAX_SAFE_INTEGER);
});
