// The same machine as a page you drive. The kit's shell does the layout, quality tiers, tour, orbit and frame loop; this file is only
// what is specific to the machine: its state, its buttons, and how a frame is drawn.
import {createShell} from 'teardown-kit/shell.js';
import {TOGGLES, VIEWS} from './console.js';
import {buildScene, camAt, displayAt, drawScene, DURATION, rpmAt, thetaAt, tourCursor, VIEW_FN, viewAt} from './film.js';
import {P} from './model.js';

const ss = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const wrap = (d) => ((((d + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

export function runLive() {
  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  app.appendChild(canvas);
  const sc = buildScene({canvas});
  const shell = createShell({app, canvas, st: sc.st, root: sc.ui.root, duration: DURATION, compact: true});
  shell.onLayout(sc.ui.layout);
  const tour = tourCursor(sc.ui);
  // the visitor's state
  let th = 0;
  let rpm = P.rpmIdle;
  let paused = shell.still; // reduced motion: nothing moves until the visitor asks
  shell.holdWhile(() => paused);
  let view = 'hero';
  let viewT0 = 0;
  const disp = Object.fromEntries(TOGGLES.map((k) => [k, {on: 0, t: -9}]));
  const cam = {...VIEW_FN.hero(0)};

  shell.onTakeOver((cyc) => {
    th = thetaAt(cyc);
    rpm = rpmAt(cyc);
    view = viewAt(cyc)[1];
    viewT0 = shell.T;
    const d = displayAt(cyc);
    for (const k of TOGGLES) disp[k] = {on: d[k] > 0.5 ? 1 : 0, t: -9};
  });
  for (const v of VIEWS)
    sc.ui.btn[v].addEventListener('click', () => {
      shell.takeOver();
      view = v;
      viewT0 = shell.T;
      Object.assign(shell.orbit, {az: 0, el: 0, k: 1});
    });
  for (const k of TOGGLES)
    sc.ui.btn[k].addEventListener('click', () => {
      shell.takeOver();
      disp[k] = {on: disp[k].on ? 0 : 1, t: shell.T};
    });
  sc.ui.btn.play.addEventListener('click', () => {
    shell.takeOver();
    paused = !paused;
  });
  sc.ui.throttle.addEventListener('input', (e) => {
    shell.takeOver();
    rpm = P.rpmIdle + (Number(e.target.value) / 1000) * (P.rpmMax - P.rpmIdle);
  });
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('button,input,summary')) return;
    const b = {' ': 'play', 1: 'hero', 2: 'front', g: 'glass', e: 'explode'}[e.key.toLowerCase()];
    if (!b) return;
    e.preventDefault();
    sc.ui.btn[b].click();
  });
  // what a test plan (qa.json) can assert: real values, read from the visitor's state
  let eased = {glass: 0, explode: 0};
  window.SIM = {qa: {state: () => ({view, paused, rpm, th, tour: shell.tour, glass: disp.glass.on === 1, explode: eased.explode, az: shell.orbit.az, zoom: shell.orbit.k, compact: shell.compact})}};

  shell.run(({dt, T, tour: touring, cyc}) => {
    if (touring) {
      const onScreen = displayAt(cyc);
      eased = onScreen;
      // no pointer to walk around on a touch screen's layout, where the buttons aren't where the tour's cursor thinks they are
      drawScene(sc, {tour: true, th: thetaAt(cyc), rpm: rpmAt(cyc), D: onScreen, cam: camAt(cyc), view: viewAt(cyc)[1], cursor: shell.compact ? {x: -99, y: -99, press: false, ring: 0, ringX: 0, ringY: 0} : tour(cyc)});
      Object.assign(cam, camAt(cyc));
      return;
    }
    if (!paused) th += (rpm / 60) * 2 * Math.PI * dt * P.playback;
    const tgt = VIEW_FN[view](shell.still ? 0 : T - viewT0);
    const k = 1 - Math.exp(-dt / 0.35);
    cam.az += wrap(tgt.az + shell.orbit.az - cam.az) * k;
    cam.el += (Math.min(1.4, tgt.el + shell.orbit.el) - cam.el) * k;
    cam.d += (tgt.d * shell.orbit.k - cam.d) * k;
    const D = Object.fromEntries(TOGGLES.map((x) => {
      const u = ss(disp[x].t, disp[x].t + 0.8, T);
      return [x, disp[x].on ? u : 1 - u];
    }));
    eased = D;
    drawScene(sc, {th, rpm, D, on: Object.fromEntries(TOGGLES.map((x) => [x, disp[x].on === 1])), cam: {...cam, target: tgt.target}, view, paused, cursor: {x: -99, y: -99, press: false, ring: 0, ringX: 0, ringY: 0}});
  });
}
