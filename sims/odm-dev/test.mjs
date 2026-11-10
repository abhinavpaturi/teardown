// Runs the sortie in node and prints the event timeline, a coarse track, the peaks and the self-checks against the
// limits in SPEC.md. Exits non-zero if a limit is broken.  node sims/odm-dev/test.mjs [--track]
import {P} from '../odm-shared/params.js';
import {buildSortie} from '../odm-shared/physics.js';

const t0 = performance.now();
const ph = buildSortie(P);
const ms = performance.now() - t0;
const f = (x, d = 1) => Number(x).toFixed(d);

console.log(`sortie ${f(ph.dur, 2)} s, ${ph.check.steps} steps, built in ${f(ms, 0)} ms, m = ${f(P.m, 1)} kg`);
console.log('\nEVENTS');
for (const e of ph.events) {
  const S = ph.sample(e.tau);
  console.log(`  ${f(e.tau, 2).padStart(6)}  ${e.key.padEnd(8)} ${e.label.padEnd(34)} pos ${S.pos.map((v) => f(v, 1)).join(',').padEnd(18)} v ${f(S.speed)} m/s  net ${f(S.G.net, 2)} g${e.point ? `  @ ${e.on} ${e.point.map((v) => f(v, 1)).join(',')}` : ''}`);
}
if (process.argv.includes('--track')) {
  console.log('\nTRACK (every 0.5 s)');
  for (let t = 0; t <= ph.dur; t += 0.5) {
    const S = ph.sample(t);
    const w = S.wires.map((x) => `${x.state.slice(0, 4)} L${f(x.length)} T${f(x.tension / 1000, 2)}k u${f(x.lineSpeed)}`).join(' | ');
    console.log(`  ${f(t, 1).padStart(5)}  pos ${S.pos.map((v) => f(v, 1)).join(',').padEnd(18)} v ${f(S.speed).padStart(5)}  net ${f(S.G.net, 2)} Gz ${f(S.G.Gz, 2)} Gx ${f(S.G.Gx, 2)}  spin ${f(S.omega / (2 * Math.PI), 2)}  ${w}`);
  }
}
const c = ph.check;
console.log('\nCHECKS');
const rows = [
  ['energy closure (fraction of work)', c.energyClosure, '< 0.005', c.energyClosure < 0.005],
  ['max net load (g)', c.maxNet, '<= 6.0', c.maxNet <= 6.0],
  ['max +Gz (g)', c.maxGz, `<= ${P.limits.Gz3s}`, c.maxGz <= P.limits.Gz3s],
  ['time above +Gz 3 g (s)', c.gzOverSus, '<= 3', c.gzOverSus <= 3],
  ['max +Gx (g)', c.maxGx, `<= ${P.limits.Gx2s}`, c.maxGx <= P.limits.Gx2s],
  ['max |Gy| (g)', c.maxGy, `<= ${P.limits.GyMax * 2}`, c.maxGy <= P.limits.GyMax * 2],
  ['G-LOC budget minimum (s)', c.glocMin, '> 1', c.glocMin > 1],
  ['max tension (kN)', c.maxTension / 1000, `<= ${P.reel.hard / 1000}`, c.maxTension <= P.reel.hard],
  ['min tension (N)', c.minTension, '>= 0', c.minTension >= 0],
  ['max speed (m/s)', c.maxSpeed, 'info', true],
  ['max bus power (kW)', c.maxBusKW, `<= ${P.bus.pMax / 1000 + 5}`, c.maxBusKW <= P.bus.pMax / 1000 + 5],
  ['max spin (rev/s)', c.maxSpinRev, `<= ${P.limits.spinMax}`, c.maxSpinRev <= P.limits.spinMax],
  ['max onset (g/s)', c.maxJerk, '<= 100', c.maxJerk <= 100],
  ['gas used / left (kg)', `${f(c.gasUsed, 3)} / ${f(c.gasLeft, 3)}`, 'info', c.gasLeft > 0],
  ['battery left (Wh)', c.battWh, 'info', c.battWh > 0],
  ['nape cut', c.cut ? `yes at ${f(c.cutTau, 2)} s` : 'NO', 'yes', c.cut],
  ['landed / touchdown (m/s)', c.landed ? f(c.touchdown, 2) : 'NO', `<= ${P.limits.touchdown}`, c.landed && c.touchdown <= P.limits.touchdown],
  ['ground / trunk / branch strikes (s)', `${f(c.hitGround, 2)} / ${f(c.hitTrunk, 2)} / ${f(c.hitBranch, 2)}`, '0 / 0 / 0', c.hitGround + c.hitTrunk + c.hitBranch === 0],
  ['script steps fired', `${c.eventsFired}/${c.eventsTotal}`, 'all', c.eventsFired === c.eventsTotal],
];
let bad = 0;
for (const [name, v, lim, ok] of rows) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(36)} ${(typeof v === 'number' ? f(v, 3) : v).toString().padStart(14)}   ${lim}`);
}
console.log('  peak times', JSON.stringify(c.peakT, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
process.exit(bad ? 1 : 0);
