// The film: a SCRIPT of operator moves and render(t) as a pure function of time. The live page reuses all of it as its auto tour.
import {makeCursor, createCursorLayer} from 'teardown-kit/tour.js';
import {runSim} from 'teardown-kit/runtime.js';
import {createStudio} from 'teardown-kit/studio.js';
import * as THREE from 'three';
import {createConsole, TOGGLES} from './console.js';
import {buildMachine, envelope} from './machine.js';
import {P, pose} from './model.js';
import SOURCES from './sources.json';
import TL from '../__NAME__-film/timeline.json';

const ss = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
// every time is in timeline.json: the film, the tour, the review sheets and the score all read the same file
export const DURATION = TL.duration;
// a misspelled or impossible cue stops the page here, by name, instead of quietly leaving a move out of the film
const cue = (k) => {
  const t = TL[k];
  if (!Number.isFinite(t) || t < 0 || t > DURATION) throw new Error(`timeline.json: ${k} = ${t} is not a time in this ${DURATION} s film`);
  return t;
};
export const SCRIPT = [
  {t: 0, view: 'hero'},
  {t: cue('glassOn'), toggle: 'glass'},
  {t: cue('front'), view: 'front'},
  {t: cue('explode'), toggle: 'explode'},
  {t: cue('assemble'), toggle: 'explode'},
  {t: cue('hero'), view: 'hero'},
  {t: cue('glassOff'), toggle: 'glass'},
];
const SPOOL_UP = cue('spoolUp');
const SPOOL_DOWN = cue('spoolDown');
export const rpmAt = (t) => P.rpmIdle + (P.rpmMax - P.rpmIdle) * ss(SPOOL_UP, SPOOL_UP + 3, t) * (1 - ss(SPOOL_DOWN, SPOOL_DOWN + 3, t));
// the crank angle is the integral of the speed: tabulated once at load, so render(t) stays pure
const DT = 1 / 240;
const TH = [0];
for (let i = 1; i * DT <= DURATION + 1; i++) TH.push(TH[i - 1] + (rpmAt((i - 0.5) * DT) / 60) * 2 * Math.PI * DT * P.playback); // slowed so the eye can follow it; the page says by how much
export const thetaAt = (t) => {
  const u = Math.max(0, t / DT);
  const i = Math.min(TH.length - 2, Math.floor(u));
  return TH[i] + (TH[i + 1] - TH[i]) * (u - i);
};
const flipAt = (k, t) => SCRIPT.filter((e) => e.toggle === k && e.t <= t);
export const displayAt = (t) => Object.fromEntries(TOGGLES.map((k) => {
  const flips = flipAt(k, t);
  const on = flips.length % 2 === 1;
  const x = flips.length ? ss(flips[flips.length - 1].t, flips[flips.length - 1].t + 0.8, t) : 1;
  return [k, on ? x : 1 - x];
}));
// frame the machine by its real size: double the dimensions and the camera backs off, instead of the top leaving the frame
const E = envelope(P);
const CY = (E.top + E.floor) / 2;
const SIZE = E.top - E.floor;
export const VIEW_FN = {
  hero: (u) => ({target: [0, CY, 0.02 * E.U], az: 0.62 + 0.03 * u, el: 0.2, d: 3.38 * SIZE, fov: 30}),
  front: (u) => ({target: [0, CY, 0.02 * E.U], az: 0.05 + 0.02 * u, el: 0.05, d: 3.24 * SIZE, fov: 30}),
};
const VIEWS_AT = SCRIPT.filter((e) => e.view).map((e) => [e.t, e.view]);
export const viewAt = (t) => VIEWS_AT.filter(([a]) => a <= t).pop();
export const camAt = (t) => {
  let i = 0;
  while (i < VIEWS_AT.length - 1 && VIEWS_AT[i + 1][0] <= t) i++;
  const cur = VIEW_FN[VIEWS_AT[i][1]](t - VIEWS_AT[i][0]);
  const k = i ? ss(VIEWS_AT[i][0], VIEWS_AT[i][0] + 1.3, t) : 1;
  if (k >= 1) return cur;
  const a = VIEW_FN[VIEWS_AT[i - 1][1]](t - VIEWS_AT[i - 1][0]);
  return {target: cur.target, az: a.az + (cur.az - a.az) * k, el: a.el + (cur.el - a.el) * k, d: a.d + (cur.d - a.d) * k, fov: cur.fov};
};

export function buildScene({canvas}) {
  const st = createStudio({canvas});
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60 * E.U, 60 * E.U), new THREE.MeshStandardMaterial({color: '#bcbeb8', roughness: 0.95}));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = E.floor;
  floor.receiveShadow = true;
  const machine = buildMachine(P);
  st.scene.add(floor, machine.root);
  const ui = createConsole(document.getElementById('app'), P, pose, machine.labels, st.project, SOURCES);
  const cursor = createCursorLayer(ui.root);
  const sc = {st, machine, ui, cursor, last: null};
  // scripts/smoke.mjs reads this after every frame it renders. The machine's joints, plus what's true of the page around it:
  const wrap = (a) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  window.SIM_CHECK = () => {
    const out = machine.checks();
    const s = sc.last;
    if (!s) return out;
    const box = new THREE.Box3().setFromObject(machine.root);
    const f = ui.frame.free;
    let seen = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const q = st.project(x, y, z);
      if (q && q[0] >= f.x0 && q[0] <= f.x1 && q[1] >= f.y0 && q[1] <= f.y1) seen++;
    }
    out.push({name: 'the machine is in frame', ok: seen >= 6, detail: `${seen} of its 8 corners clear of the panels`, value: 8 - seen});
    const off = Math.abs(wrap(machine.crankAngle() - s.th));
    out.push({name: 'the crank is at the model\'s angle', ok: off < 1e-6, detail: `${off.toFixed(4)} rad off at worst`, value: off});
    const shown = ui.shownRpm();
    out.push({name: 'the readout shows the model', ok: shown === Math.round(s.rpm), detail: shown === Math.round(s.rpm) ? '' : `shows ${shown} for ${Math.round(s.rpm)}`});
    return out;
  };
  return sc;
}

/** Pose and draw one frame: {th, rpm, D, cam, view, cursor, paused}. */
export function drawScene(sc, s) {
  sc.last = s;
  sc.machine.update(pose(s.th), s.D);
  const f = sc.ui.frame;
  sc.st.frame({...s.cam, d: s.cam.d * f.k, sx: f.sx, sy: f.sy});
  sc.ui.update({tour: s.tour, th: s.th, rpm: s.rpm, view: s.view, display: s.D, on: s.on ?? Object.fromEntries(TOGGLES.map((k) => [k, s.D[k] > 0.5])), paused: s.paused});
  if (s.cursor) sc.cursor(s.cursor);
}

export const tourCursor = (ui) => makeCursor(SCRIPT.filter((e) => e.t > 0.5).map((e) => ({t: e.t, spot: ui.spots[e.view ?? e.toggle]})));

export function run() {
  const DEFAULTS = {duration: DURATION, fps: 60, theme: 'light', hud: {enabled: false, title: P.title, subtitle: ''}, director: {enabled: false}, watermark: ''};
  return runSim(DEFAULTS, async ({canvas, capture}) => {
    const sc = buildScene({canvas});
    const resize = () => sc.st.resize(1600, 900, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
    resize();
    const cursorAt = tourCursor(sc.ui);
    return {
      resize,
      // the numbers behind frame t: smoke re-reads them in shuffled order and rejects a NaN
      state: (t) => ({t, th: thetaAt(t), rpm: rpmAt(t), stroke: pose(thetaAt(t)).stroke, view: viewAt(t)[1], ...displayAt(t)}),
      render(t) {
        drawScene(sc, {th: thetaAt(t), rpm: rpmAt(t), D: displayAt(t), cam: camAt(t), view: viewAt(t)[1], cursor: cursorAt(t)});
        return {};
      },
    };
  });
}
