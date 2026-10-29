// Deterministic strategy bots for balance checks. They use only the public
// Game API, so every action goes through the same rules as a player.

import {Game, WIDTH, HEIGHT, ENTRY, EXIT, TYPES, STEP, field, random} from '../src/game.js';

const CELLS = WIDTH * HEIGHT;
const cellXY = cell => ({x: cell % WIDTH, y: Math.floor(cell / WIDTH)});

function routeCells(game, distances = game.distances) {
  const cells = new Set();
  for (const entry of ENTRY) for (const cell of game.route(entry, distances)) cells.add(cell);
  return [...cells];
}

export function routeLength(game, distances = game.distances) {
  return ENTRY.reduce((sum, entry) => sum + Math.max(0, distances[entry]), 0);
}

// Best empty cell for a tower: most route cells within range, ties to lower index.
export function bestTowerCell(game, kind) {
  const route = routeCells(game);
  const range = TYPES[kind].range;
  let best = null, bestScore = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    if (!game.preview(cell, kind).ok) continue;
    const p = cellXY(cell);
    let score = 0;
    for (const r of route) {
      const q = cellXY(r);
      if (Math.hypot(p.x - q.x, p.y - q.y) <= range) score++;
    }
    if (score > bestScore) { best = cell; bestScore = score; }
  }
  return best;
}

// Wall that lengthens the combined route the most.
export function bestWallCell(game) {
  const base = routeLength(game);
  let best = null, bestGain = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    const check = game.preview(cell, 'wall');
    if (!check.ok) continue;
    const gain = routeLength(game, check.distances) - base;
    if (gain > bestGain) { best = cell; bestGain = gain; }
  }
  return best;
}

function buildTower(game, kind) {
  const cell = bestTowerCell(game, kind);
  return cell !== null && game.build(cell, kind);
}

function upgradeBest(game) {
  let best = null, bestCost = Infinity;
  for (const [cell, tower] of game.structures) {
    const cost = game.upgradeCost(cell);
    if (cost !== null && cost <= game.credits && tower.kind !== 'frost' && cost < bestCost) { best = cell; bestCost = cost; }
  }
  return best !== null && game.upgrade(best);
}

const MIX = ['dart', 'cannon', 'dart', 'frost', 'cannon'];

export const STRATEGIES = {
  // Never builds. Establishes that the run can be lost.
  none() {},
  // Only towers, cycling a mix, then upgrades.
  towers(game) {
    for (let guard = 0; guard < 20; guard++) {
      const kind = MIX[game.structures.size % MIX.length];
      if (game.credits >= TYPES[kind].cost && buildTower(game, kind)) continue;
      if (game.structures.size >= 6 && upgradeBest(game)) continue;
      break;
    }
  },
  // Spends most credits on the longest possible maze, then a few towers.
  maze(game) {
    for (let guard = 0; guard < 60 && game.credits >= game.costOf('wall') + (game.structures.size > 4 ? 0 : 45); guard++) {
      const cell = bestWallCell(game);
      if (cell === null || !game.build(cell, 'wall')) break;
    }
    STRATEGIES.towers(game);
  },
  // A handful of walls each wave, towers first, upgrades, repair when low.
  balanced(game) {
    if (game.health <= 12) while (game.credits >= 30 && game.health < 20 && game.repair());
    STRATEGIES.towers(game);
    for (let i = 0; i < 4 && game.credits >= game.costOf('wall'); i++) {
      const cell = bestWallCell(game);
      if (cell === null || !game.build(cell, 'wall')) break;
    }
  },
  // A less careful player: random spots near the route, no walls or upgrades.
  casual(game) {
    const rand = random(game.seed ^ (game.wave * 7919));
    const route = routeCells(game);
    for (let guard = 0; guard < 40; guard++) {
      const kind = MIX[Math.floor(rand() * MIX.length)];
      if (game.credits < TYPES[kind].cost) break;
      const r = cellXY(route[Math.floor(rand() * route.length)]);
      const cell = (r.y + Math.floor(rand() * 5) - 2) * WIDTH + r.x + Math.floor(rand() * 5) - 2;
      game.build(cell, kind);
    }
  },
  // Few towers, upgraded hard, with the same light walling as balanced.
  upgrader(game) {
    if (game.health <= 12) while (game.credits >= 30 && game.health < 20 && game.repair());
    for (let guard = 0; guard < 20; guard++) {
      if (upgradeBest(game)) continue;
      const kind = MIX[game.structures.size % MIX.length];
      const towers = [...game.structures.values()].filter(s => s.kind !== 'wall').length;
      if (towers < 3 + game.wave && game.credits >= TYPES[kind].cost && buildTower(game, kind)) continue;
      break;
    }
    for (let i = 0; i < 4 && game.credits >= game.costOf('wall'); i++) {
      const cell = bestWallCell(game);
      if (cell === null || !game.build(cell, 'wall')) break;
    }
  },
  // Repairs before anything else.
  repairFirst(game) {
    while (game.credits >= 30 && game.health < 20 && game.repair());
    STRATEGIES.towers(game);
  },
};

export function trackSpending(game, spend, fn) {
    const before = {credits: game.credits, health: game.health, structures: new Map([...game.structures].map(([k, v]) => [k, {...v}]))};
    fn();
    for (const [cell, s] of game.structures) {
      const old = before.structures.get(cell);
      if (!old) {
        const baseCost = s.kind === 'wall' ? s.invested : TYPES[s.kind].cost;
        spend[s.kind === 'wall' ? 'wall' : 'tower'] += baseCost;
        spend.upgrade += s.invested - baseCost;
      }
      else if (s.level > old.level) spend.upgrade += s.invested - old.invested;
    }
    if (game.health > before.health) spend.repair += game.balance.repairCost * Math.ceil((game.health - before.health) / game.balance.repairAmount);
}

export function playRun(strategy, seed, {maxSteps = 60 * 60 * 40, balance, mode = 'classic', waveCap = Infinity} = {}) {
  const game = new Game(seed, balance, mode);
  const plan = STRATEGIES[strategy];
  const spend = {wall: 0, tower: 0, upgrade: 0, repair: 0};
  let steps = 0, minHealth = game.health;
  while (!['won', 'lost'].includes(game.phase) && steps < maxSteps) {
    if (game.phase === 'planning') {
      if (game.wave >= waveCap) break;
      trackSpending(game, spend, () => plan(game));
      game.launch();
    }
    game.step(STEP);
    minHealth = Math.min(minHealth, game.health);
    steps++;
  }
  return {strategy, seed, phase: game.phase, wave: game.wave, health: game.health, minHealth, score: game.score,
    kills: game.kills, escaped: game.escaped, walls: [...game.structures.values()].filter(s => s.kind === 'wall').length,
    towers: [...game.structures.values()].filter(s => s.kind !== 'wall').length, routeLength: routeLength(game), spend, seconds: +(steps * STEP).toFixed(1)};
}

export {field, EXIT, HEIGHT};
