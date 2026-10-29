// Balance report across deterministic strategy bots.
// Usage: node tools/balance.js [seeds=12] [--json]

import {playRun, STRATEGIES} from './bots.js';

const seeds = Math.max(1, Math.min(100, Number(process.argv[2]) || 12));
const asJson = process.argv.includes('--json');
const rows = [];
for (const strategy of Object.keys(STRATEGIES)) {
  const runs = Array.from({length: seeds}, (_, i) => playRun(strategy, 1000 + i * 37));
  const mean = key => runs.reduce((a, r) => a + r[key], 0) / runs.length;
  const spend = {};
  for (const k of Object.keys(runs[0].spend)) spend[k] = Math.round(runs.reduce((a, r) => a + r.spend[k], 0) / runs.length);
  rows.push({strategy, wins: runs.filter(r => r.phase === 'won').length, runs: runs.length, meanWave: +mean('wave').toFixed(2),
    meanHealth: +mean('health').toFixed(1), meanMinHealth: +mean('minHealth').toFixed(1), meanScore: Math.round(mean('score')),
    meanWalls: +mean('walls').toFixed(1), meanTowers: +mean('towers').toFixed(1), meanRoute: +mean('routeLength').toFixed(1), spend,
    lostAt: runs.filter(r => r.phase === 'lost').map(r => r.wave)});
}
if (asJson) console.log(JSON.stringify(rows, null, 2));
else {
  console.log(`seeds: ${seeds}`);
  console.log('strategy     wins  wave  health(min)  walls towers route  spend wall/tower/upg/repair  lost at');
  for (const r of rows) {
    console.log(`${r.strategy.padEnd(12)} ${String(r.wins).padStart(2)}/${r.runs}  ${r.meanWave.toFixed(1).padStart(4)}  ${r.meanHealth.toFixed(1).padStart(5)} (${r.meanMinHealth.toFixed(1)})  ${String(r.meanWalls).padStart(5)} ${String(r.meanTowers).padStart(5)}  ${String(r.meanRoute).padStart(5)}  ${r.spend.wall}/${r.spend.tower}/${r.spend.upgrade}/${r.spend.repair}  ${r.lostAt.join(',')}`);
  }
}
