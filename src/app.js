import {Game, WIDTH, HEIGHT, STEP, TYPES, ENTRY, EXIT, MAX_HEALTH, RUN_MODES, runMode} from './game.js';
import {ignoreKey, isPauseKey} from './keys.js';
import {createTerrainLayer} from './terrain.js';
import {createPlanningPreview} from './preview.js';
import {createAudio} from './audio.js';

const $ = id => document.getElementById(id);
const canvas = $('board');
const context = canvas.getContext('2d');
const CELL = 54, LEFT = 48, TOP = 28, VIEW_W = 960, VIEW_H = 610;
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery.matches;
motionQuery.addEventListener?.('change', event => { reducedMotion = event.matches; });
const requestedSeed = new URLSearchParams(location.search).get('seed');
const seed = requestedSeed && /^[0-9]{1,10}$/.test(requestedSeed) && Number(requestedSeed) <= 0xffffffff ? Number(requestedSeed) : 7129;
const game = new Game(seed, undefined, runMode(new URLSearchParams(location.search).get('run')));
const modeSelect = $('run-mode');
modeSelect.value = game.mode;
const audio = createAudio(({enabled, busy, kind, message}) => {
  $('sound').disabled = busy;
  $('sound').setAttribute('aria-pressed', String(enabled));
  $('sound').textContent = busy ? 'Enabling sound...' : enabled ? 'Sound on' : kind === 'unavailable' ? 'Sound unavailable' : 'Sound off';
  $('sound-status').textContent = message;
});
modeSelect.addEventListener('change', updateHud);
const planningPreview = createPlanningPreview(game);
const terrain = createTerrainLayer({width: WIDTH, height: HEIGHT, cell: CELL, left: LEFT, top: TOP, viewWidth: VIEW_W, viewHeight: VIEW_H});
let tool = 'dart', hover = null, selected = null, showPaths = true, speed = 1;
let last = 0, accumulator = 0, nextHud = 0, lastMessage = '', pointerKind = 'mouse';

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  dart: [['path', {d: 'M8 20h16v4H8zM13 7h6v14h-6zM12 3h8v5h-8z'}]],
  cannon: [['circle', {cx: 16, cy: 15, r: 10, fill: 'none', stroke: 'currentColor', 'stroke-width': 2}], ['path', {d: 'M13 2h6v16h-6zM5 23h22v3H5z'}]],
  frost: [['path', {d: 'M15 1h2v25h-2zM3 12h26v2H3zM6 4l20 19-2 2L4 6zM24 3l2 2L6 25l-2-2z'}]],
  wall: [['path', {d: 'M2 4h12v8H2zM17 4h13v8H17zM2 15h7v8H2zM12 15h13v8H12zM28 15h3v8h-3z'}]],
};

for (const [kind, type] of Object.entries(TYPES)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool';
  button.dataset.tool = kind;
  button.setAttribute('aria-pressed', String(kind === tool));
  button.setAttribute('aria-label', `${type.name}, ${type.cost} credits. ${type.description}`);
  const icon = document.createElementNS(SVG, 'svg');
  icon.setAttribute('viewBox', '0 0 32 28');
  icon.setAttribute('aria-hidden', 'true');
  icon.style.color = type.color;
  icon.style.fill = 'currentColor';
  for (const [tag, attributes] of ICONS[kind]) {
    const shape = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, String(value));
    icon.append(shape);
  }
  const title = document.createElement('span');
  title.className = 'tool-title'; title.textContent = type.name;
  const bottom = document.createElement('span'); bottom.className = 'tool-bottom';
  const number = document.createElement('span'); number.textContent = `0${Object.keys(TYPES).indexOf(kind) + 1}`;
  const price = document.createElement('b'); price.className = 'tool-price'; price.textContent = `${type.cost} CR`;
  bottom.append(number, price); button.append(icon, title, bottom);
  button.addEventListener('click', () => { tool = kind; selected = null; updateHud(); });
  $('tools').append(button);
}

function resize() {
  const ratio = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(VIEW_W * ratio);
  canvas.height = Math.round(VIEW_H * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  terrain.resize(ratio, game.rocks);
}
resize();
addEventListener('resize', resize);
const xy = index => ({x: LEFT + (index % WIDTH + 0.5) * CELL, y: TOP + (Math.floor(index / WIDTH) + 0.5) * CELL});

function cellAt(event) {
  const box = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - box.left) * VIEW_W / box.width - LEFT) / CELL);
  const y = Math.floor(((event.clientY - box.top) * VIEW_H / box.height - TOP) / CELL);
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT ? y * WIDTH + x : null;
}

// On touch there is no hover preview, so the first tap previews and a second
// tap on the same cell builds.
function operate(index, confirmTap = false) {
  if (index === null) return;
  const alreadySelected = selected === index;
  selected = index;
  hover = index;
  if (confirmTap && !alreadySelected && !game.structures.has(index)) {
    const check = game.preview(index, tool);
    game.message = check.ok ? `Tap again to build ${TYPES[tool].name} for ${check.cost} credits.` : check.reason;
    updateHud();
    return;
  }
  if (!game.structures.has(index)) {
    if (game.build(index, tool)) beep(260, 0.045, 'triangle');
    else beep(100, 0.055, 'sine');
  }
  updateHud();
}

canvas.addEventListener('pointerdown', event => { pointerKind = event.pointerType || 'mouse'; });
canvas.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') hover = cellAt(event); });
canvas.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') hover = null; });
canvas.addEventListener('click', event => { canvas.focus({preventScroll: true}); operate(cellAt(event), pointerKind !== 'mouse'); });
canvas.addEventListener('keydown', event => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Enter') { operate(selected ?? hover ?? 0); return; }
  const cell = selected ?? 0;
  let x = cell % WIDTH, y = Math.floor(cell / WIDTH);
  if (event.key === 'ArrowUp') y--;
  if (event.key === 'ArrowDown') y++;
  if (event.key === 'ArrowLeft') x--;
  if (event.key === 'ArrowRight') x++;
  selected = Math.max(0, Math.min(HEIGHT - 1, y)) * WIDTH + Math.max(0, Math.min(WIDTH - 1, x));
  hover = selected;
  updateHud();
});

function togglePause() {
  if (!['planning', 'wave'].includes(game.phase)) return;
  game.setPaused(!game.paused);
  if (!game.paused) audio.resume();
  else audio.suspend();
  accumulator = 0;
  updateHud();
}
$('launch').addEventListener('click', () => { if (game.launch()) beep(380, 0.12, 'triangle'); updateHud(); });
$('pause').addEventListener('click', togglePause);
$('speed').addEventListener('click', () => { speed = speed === 1 ? 2 : 1; updateHud(); });
$('paths').addEventListener('click', () => { showPaths = !showPaths; updateHud(); });
$('repair').addEventListener('click', () => { game.repair(); updateHud(); });
$('upgrade').addEventListener('click', () => { game.upgrade(selected); updateHud(); });
$('sell').addEventListener('click', () => { game.sell(selected); updateHud(); });
$('restart').addEventListener('click', () => { game.reset(game.seed, modeSelect.value); selected = hover = null; accumulator = 0; audio.resume(); resize(); updateHud(); });
$('sound').addEventListener('click', () => {audio.toggle();});
function beep(frequency, duration, type = 'sine') {
  audio.play(frequency, duration, type);
}
addEventListener('keydown', event => {
  if (ignoreKey(event)) return;
  if (['1', '2', '3', '4'].includes(event.key)) { tool = Object.keys(TYPES)[Number(event.key) - 1]; selected = null; updateHud(); }
  else if (isPauseKey(event)) { event.preventDefault(); togglePause(); }
  else if (event.key.toLowerCase() === 'n') { game.launch(); updateHud(); }
  else if (event.key.toLowerCase() === 'u') { game.upgrade(selected); updateHud(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { game.setPaused(true); audio.suspend(); }
  accumulator = 0; last = 0; updateHud();
});

function updateHud() {
  $('wave-target').textContent = game.targetWaves === null ? '/ endless' : `/ ${game.targetWaves}`;
  $('mission-target').textContent = game.targetWaves === null ? '∞' : String(game.targetWaves);
  $('run-mode-status').textContent = runMode(modeSelect.value) !== game.mode ? `Start a new run to apply. Current run: ${RUN_MODES[game.mode].label}.` : `${RUN_MODES[game.mode].label}. ${game.targetWaves === null ? 'Hold as long as the core survives.' : `Hold ${game.targetWaves} waves.`}`;
  $('credits').textContent = String(game.credits);
  $('health').textContent = String(game.health);
  $('wave').textContent = String(game.wave).padStart(2, '0');
  $('kills').textContent = String(game.kills);
  $('score').textContent = String(game.score);
  $('phase').textContent = game.paused ? 'PAUSED' : ({planning: 'PLANNING', wave: 'LIVE WAVE', won: 'CORE SECURE', lost: 'CORE LOST'})[game.phase];
  $('enemies').textContent = game.phase === 'wave' ? `${game.enemies.length + game.pending.length} CONTACTS REMAINING` : game.phase === 'won' ? 'ALL WAVES HELD' : 'CLEAR AIRSPACE';
  $('launch').textContent = game.phase === 'won' ? 'All waves held' : game.phase === 'lost' ? 'Core lost' : game.phase === 'wave' ? 'Wave in progress' : `Send wave ${game.wave + 1} ↗`;
  $('launch').disabled = game.phase !== 'planning' || game.paused;
  $('pause').textContent = game.paused ? 'Resume' : 'Pause';
  $('pause').disabled = !['planning', 'wave'].includes(game.phase);
  $('speed').textContent = `${speed}× speed`;
  $('speed').setAttribute('aria-label', `Simulation speed, currently ${speed} times`);
  $('paths').textContent = showPaths ? 'Routes on' : 'Routes off';
  $('paths').setAttribute('aria-pressed', String(showPaths));
  $('repair').disabled = game.phase !== 'planning' || game.paused || game.health === MAX_HEALTH || game.credits < game.balance.repairCost;
  for (const price of document.querySelectorAll('[data-tool] .tool-price')) price.textContent = `${game.costOf(price.closest('[data-tool]').dataset.tool)} CR`;
  for (const button of document.querySelectorAll('[data-tool]')) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  const tower = selected === null ? null : game.structures.get(selected);
  const type = TYPES[tower?.kind || tool];
  $('cell-label').textContent = selected === null ? 'NO CELL SELECTED' : `CELL ${selected % WIDTH + 1} / ${Math.floor(selected / WIDTH) + 1}`;
  $('selection-title').textContent = type.name + (tower ? ` / LV ${tower.level}` : '');
  $('selection-detail').textContent = type.description;
  const stats = tower ? game.towerStats(tower) : type;
  $('tower-numbers').textContent = stats.range ? `${stats.damage.toFixed(0)} DMG   ${stats.range.toFixed(1)} RANGE` : 'ROUTE CONTROL / NO DAMAGE';
  const upgrade = tower ? game.upgradeCost(selected) : null;
  $('upgrade').textContent = upgrade === null ? tower?.level === 3 ? 'Max level' : 'Upgrade' : `Upgrade · ${upgrade} CR`;
  $('upgrade').disabled = upgrade === null || game.credits < upgrade || game.paused || !['planning', 'wave'].includes(game.phase);
  $('sell').textContent = tower ? `Sell · ${game.sellValue(selected)} CR` : 'Sell';
  $('sell').disabled = !game.canSell(selected);
  if (tower?.kind === 'wall' && game.phase === 'wave') $('sell').textContent = 'Locked during wave';
  $('preview').textContent = tower ? 'Upgrade range and damage, or sell to recover some credits.' : selected !== null ? planningPreview(selected, tool).reason : 'Choose a tool, then an empty grid cell.';
  if (lastMessage !== game.message) { $('message').textContent = game.message; lastMessage = game.message; }
}

function line(points, color, width = 1, dash = []) {
  if (!points.length) return;
  context.beginPath(); context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.strokeStyle = color; context.lineWidth = width; context.setLineDash(dash); context.stroke(); context.setLineDash([]);
}
function circle(x, y, radius, fill, stroke) {
  context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2);
  if (fill) { context.fillStyle = fill; context.fill(); }
  if (stroke) { context.strokeStyle = stroke; context.lineWidth = 1; context.stroke(); }
}

function draw(alpha = 1) {
  context.clearRect(0, 0, VIEW_W, VIEW_H);
  terrain.draw(context);
  let preview = null;
  if (hover !== null && !game.structures.has(hover)) preview = planningPreview(hover, tool);
  if (showPaths) {
    for (const entry of ENTRY) line(game.route(entry, preview?.ok ? preview.distances : game.distances).map(xy), preview?.ok ? '#8c8069' : '#345e61', 2, [4, 7]);
  }
  for (const entry of ENTRY) {
    const p = xy(entry);
    context.fillStyle = '#244b48'; context.fillRect(p.x - 24, p.y - 23, 46, 46);
    context.strokeStyle = '#5fe5ce'; context.lineWidth = 2; context.strokeRect(p.x - 24, p.y - 23, 46, 46);
    line([{x: p.x - 9, y: p.y - 9}, {x: p.x + 2, y: p.y}, {x: p.x - 9, y: p.y + 9}], '#5fe5ce', 3);
    line([{x: p.x, y: p.y - 9}, {x: p.x + 11, y: p.y}, {x: p.x, y: p.y + 9}], '#5fe5ce', 3);
  }
  const core = xy(EXIT);
  circle(core.x, core.y, 23, '#473c2c', '#f2bd72'); circle(core.x, core.y, 14, '#f2bd72');
  context.fillStyle = '#17242b'; context.fillRect(core.x - 3, core.y - 7, 6, 14); context.fillRect(core.x - 7, core.y - 3, 14, 6);
  const focus = hover ?? selected;
  if (focus !== null && !game.rocks.has(focus)) {
    const p = xy(focus), tower = game.structures.get(focus);
    const stats = tower ? game.towerStats(tower) : TYPES[tool];
    if (stats.range) circle(p.x, p.y, stats.range * CELL, '#5fe5ce08', '#5fe5ce35');
    context.fillStyle = tower || preview?.ok ? '#5fe5ce14' : '#f18b861c';
    context.fillRect(p.x - CELL / 2 + 2, p.y - CELL / 2 + 2, CELL - 4, CELL - 4);
    context.strokeStyle = tower || preview?.ok ? '#5fe5ce' : '#f18b86'; context.lineWidth = 2;
    context.strokeRect(p.x - CELL / 2 + 2, p.y - CELL / 2 + 2, CELL - 4, CELL - 4);
  }
  for (const tower of game.structures.values()) {
    const p = xy(tower.index), color = TYPES[tower.kind].color;
    if (tower.kind === 'wall') {
      context.fillStyle = '#3c3852'; context.fillRect(p.x - 20, p.y - 20, 40, 40);
      line([{x: p.x - 17, y: p.y - 11}, {x: p.x + 17, y: p.y - 11}], color, 3);
      line([{x: p.x - 17, y: p.y + 1}, {x: p.x + 17, y: p.y + 1}], color, 3);
      line([{x: p.x - 17, y: p.y + 13}, {x: p.x + 17, y: p.y + 13}], color, 3);
    } else {
      context.fillStyle = '#344552'; context.fillRect(p.x - 19, p.y - 19, 38, 38);
      circle(p.x, p.y, 13, '#182c36', color);
      if (tower.kind === 'frost') {
        for (let i = 0; i < 3; i++) {
          const angle = Math.PI * i / 3;
          line([{x: p.x - Math.cos(angle) * 12, y: p.y - Math.sin(angle) * 12}, {x: p.x + Math.cos(angle) * 12, y: p.y + Math.sin(angle) * 12}], color, 2);
        }
      } else {
        const enemy = game.enemies.find(enemy => Math.hypot(enemy.x - tower.index % WIDTH, enemy.y - Math.floor(tower.index / WIDTH)) < game.towerStats(tower).range);
        const angle = enemy ? Math.atan2(enemy.y - Math.floor(tower.index / WIDTH), enemy.x - tower.index % WIDTH) : -Math.PI / 2;
        line([p, {x: p.x + Math.cos(angle) * (tower.kind === 'cannon' ? 20 : 22), y: p.y + Math.sin(angle) * (tower.kind === 'cannon' ? 20 : 22)}], color, tower.kind === 'cannon' ? 9 : 5);
      }
      for (let level = 0; level < tower.level; level++) circle(p.x - 6 + level * 6, p.y + 16, 1.5, color);
    }
  }
  for (const enemy of game.enemies) {
    const ex = enemy.px + (enemy.x - enemy.px) * alpha, ey = enemy.py + (enemy.y - enemy.py) * alpha;
    const x = LEFT + (ex + 0.5) * CELL, y = TOP + (ey + 0.5) * CELL;
    const color = enemy.slowUntil > game.time ? '#87bafa' : enemy.kind === 'tank' ? '#d29cbd' : enemy.kind === 'runner' ? '#efa889' : '#dfd6bf';
    if (enemy.kind === 'tank') {
      context.fillStyle = '#4e384b'; context.fillRect(x - 12, y - 12, 24, 24);
      context.strokeStyle = color; context.lineWidth = 2; context.strokeRect(x - 10, y - 10, 20, 20);
      circle(x, y, 4, color);
    } else {
      context.beginPath(); context.moveTo(x, y - 10); context.lineTo(x + 9, y); context.lineTo(x, y + 10); context.lineTo(x - 9, y); context.closePath(); context.fillStyle = color; context.fill();
      circle(x, y, 3, '#23323b');
    }
    context.fillStyle = '#0b141c'; context.fillRect(x - 14, y - 18, 28, 3);
    context.fillStyle = color; context.fillRect(x - 14, y - 18, 28 * Math.max(0, enemy.hp / enemy.maxHp), 3);
  }
  if (!reducedMotion) for (const effect of game.effects) {
    const p = {x: LEFT + (effect.x + 0.5) * CELL, y: TOP + (effect.y + 0.5) * CELL};
    context.globalAlpha = Math.min(1, effect.life / 0.12);
    if (effect.kind === 'shot') line([p, {x: LEFT + (effect.tx + 0.5) * CELL, y: TOP + (effect.ty + 0.5) * CELL}], effect.color, 2);
    else circle(p.x, p.y, (0.35 - effect.life) * CELL * (effect.kind === 'blast' ? 3 : 1.4), null, effect.color);
    context.globalAlpha = 1;
  }
  if (game.paused || ['lost', 'won'].includes(game.phase)) {
    context.fillStyle = '#09141ed9'; context.fillRect(LEFT, TOP, WIDTH * CELL, HEIGHT * CELL);
    context.textAlign = 'center'; context.fillStyle = game.phase === 'lost' ? '#efa889' : '#5fe5ce';
    context.font = '600 46px Segoe UI, sans-serif';
    context.fillText(game.paused ? 'TACTICAL PAUSE' : game.phase === 'won' ? 'CORE SECURE' : 'CORE LOST', VIEW_W / 2, 280);
    context.fillStyle = '#becdd1'; context.font = '18px Segoe UI, sans-serif';
    context.fillText(game.paused ? 'Resume when you are ready.' : game.phase === 'won' ? `${game.targetWaves} waves held. Score ${game.score}.` : 'Try a longer route and a different tower mix.', VIEW_W / 2, 318);
    context.textAlign = 'start';
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = last ? Math.min((now - last) / 1000, 0.15) : 0;
  last = now;
  let alpha = 1;
  if (!document.hidden && !game.paused) {
    accumulator = Math.min(accumulator + elapsed * speed, STEP * 8);
    for (let steps = 0; accumulator >= STEP && steps < 8; steps++) {
      game.step(STEP); accumulator -= STEP;
      if (game.events.includes('leak')) beep(90, 0.12);
      else if (game.events.includes('shot') && Math.floor(game.time * 60) % 8 === 0) beep(450, 0.025, 'triangle');
    }
    // Blend between the last two steps so motion stays smooth above 60 Hz.
    alpha = game.phase === 'wave' ? Math.min(1, accumulator / STEP) : 1;
  }
  if (now >= nextHud) { updateHud(); nextHud = now + 100; }
  draw(alpha);
}
updateHud();
requestAnimationFrame(frame);
