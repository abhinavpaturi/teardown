// The film's clock, with no three.js so node can read it too (the score's timeline and the tests): the sortie computed
// once, film time to sortie time (the teardown, the 1/8 slow motion through the cut, the map at the end) and back, and
// the operator's SCRIPT: views, display toggles, isolated subsystems and notes on the film's seconds.
import {P} from './params.js';
import {buildSortie} from './physics.js';

const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));
// the console's display toggles, in its order
export const DISPLAY = ['labels', 'cutaway', 'xray', 'exploded', 'forces', 'trail'];

// ------------------------------------------------------------ the sortie, once, shared by the film, the live page and the score
export const PH = buildSortie(P);
export const ev = (key, n = 0) => PH.events.filter((e) => e.key === key)[n];
const CUT = ev('cut').tau;
export const TEAR = 22; // seconds of teardown before the sortie starts
export const SLOW = {a: CUT - 0.35, b: CUT + 0.25, k: 8}; // the cut, slowed 8x
export const TAIL = 3.6; // the map at the end
export const DURATION = TEAR + SLOW.a + (SLOW.b - SLOW.a) * SLOW.k + (PH.dur - SLOW.b) + TAIL;

/** Film time -> {mode, tau (sortie seconds), slow}. */
export const timeAt = (t) => {
  if (t < TEAR) return {mode: 'teardown', tau: 0, slow: 0};
  const u = t - TEAR;
  const w = (SLOW.b - SLOW.a) * SLOW.k;
  if (u < SLOW.a) return {mode: 'sortie', tau: u, slow: 0};
  if (u < SLOW.a + w) return {mode: 'sortie', tau: SLOW.a + (u - SLOW.a) / SLOW.k, slow: 1};
  return {mode: 'sortie', tau: Math.min(PH.dur, SLOW.b + (u - SLOW.a - w)), slow: 0};
};
/** Sortie time -> film time (for scheduling views and clicks on sortie beats). */
export const filmAt = (tau) => (tau <= SLOW.a ? TEAR + tau : tau <= SLOW.b ? TEAR + SLOW.a + (tau - SLOW.a) * SLOW.k : TEAR + SLOW.a + (SLOW.b - SLOW.a) * SLOW.k + (tau - SLOW.b));

// ------------------------------------------------------------ the operator's script
const tf = (key, n = 0, dt = 0) => filmAt(ev(key, n).tau) + dt;
export const SCRIPT = [
  {t: 0, view: 'hero', note: 'intro'},
  {t: 1.0, display: 'labels'},
  {t: 3.2, isolate: 'drive', view: 'core', note: 'drive'},
  {t: 3.6, display: 'cutaway'},
  {t: 6.0, isolate: 'reels', view: 'reel', note: 'reels'},
  {t: 8.8, display: 'cutaway'},
  {t: 9.0, isolate: 'anchors', view: 'hip', note: 'anchors'},
  {t: 11.6, isolate: 'tanks', view: 'gas', note: 'gas'},
  {t: 14.2, isolate: 'handles', view: 'hands', note: 'blades'},
  {t: 16.8, isolate: 'harness', view: 'front', note: 'harness'},
  {t: 17.1, display: 'xray'},
  {t: 19.3, display: 'xray'},
  {t: 19.4, isolate: null, display: 'exploded', view: 'explode', note: 'mass'},
  {t: 21.2, display: 'exploded'},
  {t: 21.4, display: 'labels', view: 'hero'},
  {t: TEAR, sortie: true, view: 'chase'},
  {t: TEAR + 3.4, view: 'side'},
  {t: TEAR + 3.6, display: 'forces'},
  {t: tf('release', 0, 0.2), view: 'chase'},
  {t: tf('release', 0, 0.4), display: 'forces'},
  {t: tf('jet', 0, -0.3), view: 'jet'},
  {t: tf('fire', 2, 0.6), view: 'chase'},
  {t: tf('fire', 3, -0.2), view: 'nape'},
  {t: filmAt(SLOW.a) - 0.25, slow: true},
  {t: filmAt(SLOW.b), slow: true},
  {t: tf('catch', 0, 0.4), view: 'chase'},
  {t: tf('swing', 0, 2.2), view: 'land'},
  {t: DURATION - TAIL, view: 'map', display: 'trail'},
];
const VIEWS_AT = SCRIPT.filter((e) => e.view).map((e) => [e.t, e.view]);
export const viewAt = (t) => VIEWS_AT.filter(([a]) => a <= t).pop();
export const displayAt = (t) => {
  const out = Object.fromEntries(DISPLAY.map((k) => [k, 0]));
  for (const e of SCRIPT) if (e.display && e.t <= t) out[e.display] = out[e.display] ? 0 : 1;
  return out;
};
const lastFlip = (key, t) => SCRIPT.filter((e) => e.display === key && e.t <= t).pop()?.t ?? -9;
export const easedDisplay = (key, t, dur = 0.7) => {
  const on = displayAt(t)[key];
  const k = ss(lastFlip(key, t), lastFlip(key, t) + dur, t);
  return on ? k : 1 - k;
};
export const isolateAt = (t) => {
  const e = SCRIPT.filter((x) => 'isolate' in x && x.t <= t).pop();
  return e ? {key: e.isolate, t0: e.t} : {key: null, t0: -9};
};
export const noteKeyAt = (t) => SCRIPT.filter((e) => e.note && e.t <= t).pop()?.note;
