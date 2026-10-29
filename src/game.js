// Deterministic tower defense simulation. No DOM or clocks: the app calls
// step(STEP) from a fixed-step loop, and the same seed and actions always
// produce the same run.

export const WIDTH = 16;
export const HEIGHT = 10;
export const WAVES = 12;
export const RUN_MODES = Object.freeze({
  classic: Object.freeze({label: 'Classic campaign', waves: 12}),
  extended: Object.freeze({label: 'Long campaign', waves: 24}),
  endless: Object.freeze({label: 'Endless', waves: null}),
});
export const LIMITS = Object.freeze({contacts: 55, effects: 180, events: 256});
export const runMode = value => typeof value === 'string' && Object.hasOwn(RUN_MODES, value) ? value : 'classic';
// The original twelve waves retain their exact numbers. Later waves increase
// health and speed more gently, with a fixed ceiling for endless play.
export function difficulty(wave) {
  const n = Number.isFinite(wave) ? Math.max(1, Math.floor(wave)) : 1;
  return n <= WAVES ? n : Math.min(24, WAVES + (n - WAVES) * 0.4);
}
const add = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
export const STEP = 1 / 60;
export const ENTRY = [2 * WIDTH, 7 * WIDTH];
export const EXIT = 5 * WIDTH + WIDTH - 1;
export const MAX_HEALTH = 20;

export const TYPES = Object.freeze({
  dart: Object.freeze({name: 'Needle', cost: 45, damage: 9, range: 3.5, reload: 0.65, color: '#5fe5ce', description: 'Fast, reliable shots. Best against scouts.'}),
  cannon: Object.freeze({name: 'Mortar', cost: 85, damage: 31, range: 3.2, reload: 1.7, color: '#f2bd72', description: 'Area damage and armor piercing. Best against groups.'}),
  frost: Object.freeze({name: 'Chill', cost: 60, damage: 3, range: 3.3, reload: 0.85, color: '#87bafa', description: 'Slows a target. Give your other towers more time.'}),
  wall: Object.freeze({name: 'Barricade', cost: 9, color: '#ab9bd4', description: 'Change the route. A path to the core must stay open.'}),
});

export const ENEMIES = Object.freeze({
  scout: Object.freeze({name: 'scout', hp: 1, speed: 1, armor: 0, reward: 5, damage: 1}),
  runner: Object.freeze({name: 'runner', hp: 0.7, speed: 1.65, armor: 0, reward: 6, damage: 1}),
  tank: Object.freeze({name: 'armored', hp: 2.3, speed: 0.67, armor: 0.5, reward: 12, damage: 3}),
});

export const BALANCE = Object.freeze({
  startCredits: 170,
  hpBase: 23,
  hpPerWave: 7,
  hpGrowth: 1.15, // compound multiplier per wave after the first
  speedBase: 1.05,
  speedPerWave: 0.025,
  waveBonusBase: 20,
  waveBonusPerWave: 3,
  repairCost: 30,
  repairAmount: 5,
  sellRefund: 0.6,
  slowFactor: 0.55,
  slowSeconds: 1.5,
  winHealthBonus: 250, // score per remaining core point on a win
  wallCostStep: 1, // each standing barricade raises the next one's price
});

const ROCKS = [5, 21, 37, 69, 85, 101, 133, 149, 26, 42, 58, 106, 122, 138, 66, 82];
const ACTIVE = ['planning', 'wave'];

const coord = (index) => ({x: index % WIDTH, y: Math.floor(index / WIDTH)});
const validCell = (index) => Number.isInteger(index) && index >= 0 && index < WIDTH * HEIGHT;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function random(seed) {
  let value = Number.isInteger(seed) ? seed >>> 0 : 1;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let number = value;
    number = Math.imul(number ^ (number >>> 15), number | 1);
    number ^= number + Math.imul(number ^ (number >>> 7), number | 61);
    return ((number ^ (number >>> 14)) >>> 0) / 4294967296;
  };
}

// Cardinal neighbors, never wrapping across rows.
export function neighbors(index) {
  if (!validCell(index)) return [];
  const x = index % WIDTH;
  return [
    x < WIDTH - 1 ? index + 1 : -1,
    index >= WIDTH ? index - WIDTH : -1,
    index < WIDTH * (HEIGHT - 1) ? index + WIDTH : -1,
    x > 0 ? index - 1 : -1,
  ].filter(validCell);
}

// Breadth-first distance field from the core. -1 means unreachable.
export function field(blocked) {
  const result = new Int16Array(WIDTH * HEIGHT).fill(-1);
  if (blocked.has(EXIT)) return result;
  const queue = [EXIT];
  result[EXIT] = 0;
  for (let head = 0; head < queue.length; head++) {
    for (const cell of neighbors(queue[head])) {
      if (result[cell] !== -1 || blocked.has(cell)) continue;
      result[cell] = result[queue[head]] + 1;
      queue.push(cell);
    }
  }
  return result;
}

export function waveComposition(wave) {
  const count = Math.min(LIMITS.contacts, 7 + Math.max(1, Number.isFinite(wave) ? Math.floor(wave) : 1) * 2);
  return Array.from({length: count}, (_, index) => {
    if (wave >= 4 && index % 5 === 4) return 'tank';
    if (wave >= 2 && index % 3 === 1) return 'runner';
    return 'scout';
  });
}

export class Game {
  constructor(seed = 7129, balance = BALANCE, mode = 'classic') {
    this.balance = balance;
    this.reset(seed, mode);
  }

  reset(seed = this.seed, mode = this.mode) {
    this.mode = runMode(mode);
    this.targetWaves = RUN_MODES[this.mode].waves;
    this.seed = Number.isInteger(seed) ? seed >>> 0 : 7129;
    this.rng = random(this.seed);
    this.rocks = new Set(ROCKS);
    this.structures = new Map();
    this.enemies = [];
    this.effects = [];
    this.credits = this.balance.startCredits;
    this.health = MAX_HEALTH;
    this.wave = this.kills = this.escaped = this.score = this.time = 0;
    this.phase = 'planning';
    this.paused = false;
    this.pending = [];
    this.spawnClock = 0;
    this.sequence = 0;
    this.distances = field(this.rocks);
    this.events = [];
    this.message = `Build a defense, then send the first wave. ${this.describeNextWave()}`;
    return this;
  }

  // Pausing only applies to a run in progress; a finished run stays finished.
  setPaused(paused) {
    this.paused = ACTIVE.includes(this.phase) && Boolean(paused);
    return this.paused;
  }

  blocked(extra) {
    const cells = new Set([...this.rocks, ...this.structures.keys()]);
    if (extra !== undefined) cells.add(extra);
    return cells;
  }

  costOf(kind) {
    if (!Object.hasOwn(TYPES, kind)) return Infinity;
    if (kind !== 'wall') return TYPES[kind].cost;
    let walls = 0;
    for (const s of this.structures.values()) if (s.kind === 'wall') walls++;
    return TYPES.wall.cost + walls * this.balance.wallCostStep;
  }

  preview(index, kind) {
    if (!validCell(index) || !Object.hasOwn(TYPES, kind)) return {ok: false, reason: 'Choose a cell and a build tool.'};
    if (!ACTIVE.includes(this.phase) || this.paused) return {ok: false, reason: 'Resume the run before building.'};
    if (ENTRY.includes(index) || index === EXIT || this.rocks.has(index) || this.structures.has(index)) return {ok: false, reason: 'This cell is occupied or protected.'};
    if (this.enemies.some(enemy => enemy.cell === index || enemy.next === index)) return {ok: false, reason: 'An enemy is crossing that cell.'};
    const cost = this.costOf(kind);
    if (this.credits < cost) return {ok: false, reason: 'Not enough credits. Choose a cheaper defense or save for the next wave.'};
    const distances = field(this.blocked(index));
    // Both gates stay open for pending enemies, and every enemy on the board
    // keeps a route from where it stands and where it is heading.
    const mustReach = [...ENTRY];
    for (const enemy of this.enemies) {
      mustReach.push(enemy.cell);
      if (validCell(enemy.next)) mustReach.push(enemy.next);
    }
    if (mustReach.some(cell => distances[cell] < 0)) return {ok: false, reason: 'Leave both entrances and every enemy a route to the core.'};
    return {ok: true, distances, cost, reason: `${TYPES[kind].name}: ${cost} credits.`};
  }

  build(index, kind) {
    const check = this.preview(index, kind);
    if (!check.ok) {
      this.message = check.reason;
      return false;
    }
    const type = TYPES[kind];
    this.credits -= check.cost;
    this.structures.set(index, {index, kind, level: 1, invested: check.cost, cooldown: 0});
    this.distances = check.distances;
    this.message = `${type.name} built. ${this.credits} credits left.`;
    return true;
  }

  towerStats(tower) {
    const type = TYPES[tower.kind];
    const level = tower.level - 1;
    return {
      ...type,
      damage: (type.damage || 0) * (1 + level * 0.65),
      range: (type.range || 0) + level * 0.35,
      reload: (type.reload || 1) * (1 - level * 0.12),
    };
  }

  upgradeCost(index) {
    const tower = this.structures.get(index);
    if (!tower || tower.kind === 'wall' || tower.level >= 3) return null;
    return Math.ceil(TYPES[tower.kind].cost * (0.7 + (tower.level - 1) * 0.4));
  }

  upgrade(index) {
    const cost = this.upgradeCost(index);
    if (cost === null || this.paused || !ACTIVE.includes(this.phase)) {
      this.message = 'Select a tower below level 3 to upgrade.';
      return false;
    }
    if (this.credits < cost) {
      this.message = 'Save more credits for this upgrade.';
      return false;
    }
    const tower = this.structures.get(index);
    tower.level++;
    tower.invested += cost;
    this.credits -= cost;
    this.message = `${TYPES[tower.kind].name} upgraded to level ${tower.level}.`;
    return true;
  }

  sellValue(index) {
    const tower = this.structures.get(index);
    return tower ? Math.floor(tower.invested * this.balance.sellRefund) : 0;
  }

  // Barricades cannot be sold mid-wave, so toggling one to march enemies
  // back and forth is not a free stall.
  canSell(index) {
    const tower = this.structures.get(index);
    if (!tower || this.paused || !ACTIVE.includes(this.phase)) return false;
    return !(tower.kind === 'wall' && this.phase === 'wave');
  }

  sell(index) {
    const tower = this.structures.get(index);
    if (tower?.kind === 'wall' && this.phase === 'wave') this.message = 'Barricades lock in place during a wave. Sell them between waves.';
    if (!this.canSell(index)) return false;
    const refund = this.sellValue(index);
    this.structures.delete(index);
    this.distances = field(this.blocked());
    this.credits = add(this.credits, refund);
    this.message = `Defense sold for ${refund} credits. Selling returns ${Math.round(this.balance.sellRefund * 100)}% of your investment.`;
    return true;
  }

  repair() {
    const {repairCost, repairAmount} = this.balance;
    if (this.phase !== 'planning' || this.paused) {
      this.message = 'Repair between waves.';
      return false;
    }
    if (this.health === MAX_HEALTH) {
      this.message = 'The core is already at full health.';
      return false;
    }
    if (this.credits < repairCost) {
      this.message = `Core repair costs ${repairCost} credits.`;
      return false;
    }
    this.health = Math.min(MAX_HEALTH, this.health + repairAmount);
    this.credits -= repairCost;
    this.message = 'Core repaired. Those credits could have bought an upgrade.';
    return true;
  }

  enemyHp(kind, wave = this.wave) {
    const {hpBase, hpPerWave, hpGrowth} = this.balance;
    const level = difficulty(wave);
    return (hpBase + level * hpPerWave) * hpGrowth ** Math.max(0, level - 1) * ENEMIES[kind].hp;
  }

  describeNextWave() {
    if (this.targetWaves !== null && this.wave >= this.targetWaves) return '';
    const next = waveComposition(this.wave + 1);
    const count = kind => next.filter(k => k === kind).length;
    const parts = [`${count('scout')} scouts`];
    if (count('runner')) parts.push(`${count('runner')} runners`);
    if (count('tank')) parts.push(`${count('tank')} armored`);
    return `Next: wave ${this.wave + 1}, ${parts.join(', ')}, about ${Math.round(this.enemyHp('scout', this.wave + 1))} HP each scout.`;
  }

  launch() {
    if (this.phase !== 'planning' || this.paused || (this.targetWaves !== null && this.wave >= this.targetWaves)) return false;
    this.wave = add(this.wave, 1);
    this.pending = waveComposition(this.wave);
    this.phase = 'wave';
    this.spawnClock = 0;
    const tanks = this.pending.filter(kind => kind === 'tank').length;
    const runners = this.pending.filter(kind => kind === 'runner').length;
    this.message = `Wave ${this.wave}: ${tanks} armored, ${runners} runners. Keep both routes covered.`;
    return true;
  }

  spawn(kind) {
    const cell = ENTRY[this.sequence++ % ENTRY.length];
    const position = coord(cell);
    const spec = ENEMIES[kind];
    const variation = 0.96 + this.rng() * 0.08;
    const hp = this.enemyHp(kind) * variation;
    const speed = (this.balance.speedBase + difficulty(this.wave) * this.balance.speedPerWave) * spec.speed * variation;
    this.enemies.push({id: this.sequence, kind, cell, next: null, progress: 0, x: position.x, y: position.y, px: position.x, py: position.y,
      hp, maxHp: hp, speed, armor: spec.armor, slowUntil: 0, reward: spec.reward, alive: true});
  }

  hit(enemy, amount, piercing = false) {
    if (!enemy.alive) return;
    enemy.hp -= amount * (piercing ? 1 : 1 - enemy.armor);
    if (enemy.hp <= 0) {
      enemy.alive = false;
      this.credits = add(this.credits, enemy.reward);
      this.kills = add(this.kills, 1);
      this.score = add(this.score, enemy.reward * 10);
      this.effects.push({kind: 'burst', x: enemy.x, y: enemy.y, color: '#f2bd72', life: 0.3});
      this.events.push('kill');
    }
  }

  fireTowers(dt) {
    for (const tower of this.structures.values()) {
      if (tower.kind === 'wall') continue;
      const stats = this.towerStats(tower);
      tower.cooldown -= dt;
      if (tower.cooldown > 0) continue;
      const position = coord(tower.index);
      // Target the enemy closest to the core along its route.
      let target = null;
      let priority = Infinity;
      for (const enemy of this.enemies) {
        if (!enemy.alive || distance(position, enemy) > stats.range) continue;
        const urgency = this.distances[enemy.cell] - enemy.progress;
        if (urgency < priority) {
          target = enemy;
          priority = urgency;
        }
      }
      if (!target) {
        tower.cooldown = 0;
        continue;
      }
      tower.cooldown = stats.reload;
      this.effects.push({kind: 'shot', x: position.x, y: position.y, tx: target.x, ty: target.y, color: stats.color, life: 0.14});
      if (tower.kind === 'cannon') {
        this.effects.push({kind: 'blast', x: target.x, y: target.y, color: stats.color, life: 0.3});
        for (const enemy of this.enemies) if (distance(target, enemy) <= 1.15) this.hit(enemy, stats.damage, true);
      } else {
        this.hit(target, stats.damage);
        if (tower.kind === 'frost' && target.alive) target.slowUntil = this.time + this.balance.slowSeconds;
      }
      this.events.push('shot');
    }
  }

  moveEnemies(dt) {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      // Previous position, so the renderer can interpolate between steps.
      enemy.px = enemy.x;
      enemy.py = enemy.y;
      let remaining = enemy.speed * (enemy.slowUntil > this.time ? this.balance.slowFactor : 1) * dt;
      for (let guard = 0; remaining > 0 && guard < 8; guard++) {
        if (enemy.cell === EXIT) {
          enemy.alive = false;
          this.health = Math.max(0, this.health - ENEMIES[enemy.kind].damage);
          this.escaped++;
          this.events.push('leak');
          break;
        }
        if (enemy.next === null) {
          enemy.next = neighbors(enemy.cell).find(cell => this.distances[cell] >= 0 && this.distances[cell] < this.distances[enemy.cell]) ?? null;
        }
        if (enemy.next === null) break;
        const travel = Math.min(remaining, 1 - enemy.progress);
        enemy.progress += travel;
        remaining -= travel;
        const from = coord(enemy.cell);
        const to = coord(enemy.next);
        enemy.x = from.x + (to.x - from.x) * enemy.progress;
        enemy.y = from.y + (to.y - from.y) * enemy.progress;
        if (enemy.progress >= 1 - 1e-9) {
          enemy.cell = enemy.next;
          enemy.next = null;
          enemy.progress = 0;
        }
      }
    }
  }

  finishWave() {
    const {waveBonusBase, waveBonusPerWave, winHealthBonus} = this.balance;
    const bonus = waveBonusBase + Math.min(24, this.wave) * waveBonusPerWave;
    this.credits = add(this.credits, bonus);
    this.score = add(this.score, bonus * 10);
    if (this.targetWaves !== null && this.wave >= this.targetWaves) {
      this.phase = 'won';
      this.score = add(this.score, this.health * winHealthBonus);
      this.message = `All ${this.targetWaves} waves held with ${this.health} core integrity. Score ${this.score}.`;
    } else {
      this.phase = 'planning';
      this.message = `Wave held. +${bonus} supply credits. ${this.describeNextWave()}`;
    }
  }

  step(dt = STEP) {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0 || dt > 0.1 || this.paused) return;
    this.events = [];
    this.effects = this.effects.filter(effect => (effect.life -= dt) > 0);
    if (this.phase !== 'wave') return;
    this.time += dt;
    this.spawnClock -= dt;
    if (this.pending.length && this.spawnClock <= 0) {
      this.spawn(this.pending.shift());
      this.spawnClock = Math.max(0.38, 0.9 - this.wave * 0.035) * (0.92 + this.rng() * 0.16);
    }
    this.fireTowers(dt);
    this.moveEnemies(dt);
    this.enemies = this.enemies.filter(enemy => enemy.alive);
    this.effects = this.effects.slice(-LIMITS.effects);
    this.events = this.events.slice(-LIMITS.events);
    if (this.health <= 0) {
      this.phase = 'lost';
      this.paused = false;
      this.message = `The core fell on wave ${this.wave}. Try a longer route and a mix of towers.`;
      return;
    }
    if (!this.enemies.length && !this.pending.length) this.finishWave();
  }

  route(start = ENTRY[0], distances = this.distances) {
    if (!validCell(start) || distances[start] < 0) return [];
    const cells = [start];
    while (cells.at(-1) !== EXIT && cells.length <= WIDTH * HEIGHT) {
      const current = cells.at(-1);
      const next = neighbors(current).find(cell => distances[cell] >= 0 && distances[cell] < distances[current]);
      if (next === undefined) return [];
      cells.push(next);
    }
    return cells;
  }
}
