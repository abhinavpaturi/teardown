// ODM-E1 as a page you drive. TEARDOWN stands the rider on the launch branch and lets you isolate each subsystem (the
// bench runs it: the motor spins, the drums turn, a blade swaps, the cuffs fill); FLY THE SORTIE plays the physics,
// with play, a timeline to scrub, a speed slider and SLOW-MO for the cut; eight views, six display toggles, an orbit
// you drag and a zoom on the wheel. Left alone it plays the film as an auto tour with the operator's cursor; a click,
// drag, wheel or key hands control over, 25 s of quiet hands it back.
import * as THREE from 'three';
import {warmComposer} from 'teardown-kit/warm.js';
import {enableKeyboard, prefersStill} from 'teardown-kit/access.js';
import {DISPLAY, SUBSYS, VIEWS} from './console.js';
import {benchDemo, buildScene, camAt, displayAt, drawScene, DURATION, isolateAt, makeCursor, makeLabels, noteKeyAt, PH, SCRIPT, TEAR, TEAR_PHASE, timeAt, VIEW_FN, viewAt} from './film.js';

const W = 1600;
const H = 900;
const IDLE = 25;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoother = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));
const wrap = (d) => ((((d + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
const SPEED = [0.05, 2];
const speedK = (v) => (v - SPEED[0]) / (SPEED[1] - SPEED[0]);
const TEAR_VIEW = {drive: 'core', reels: 'reel', anchors: 'hip', tanks: 'gas', handles: 'hands', blades: 'hands', harness: 'front'};

const CSS = `
html,body{background:#eef1f2;overflow:hidden}
#app{position:fixed!important;inset:auto!important;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
#gl{touch-action:none;cursor:grab}
#gl.drag{cursor:grabbing}
.bt{pointer-events:auto;cursor:pointer}
.bt:hover{filter:brightness(.95)}
.hit{position:absolute;pointer-events:auto;cursor:ew-resize}
.tourchip{position:absolute;left:800px;top:146px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;height:22px;padding:0 11px;border:1px solid #e3e5e8;border-radius:4px;background:rgba(250,250,248,.95);color:#22252b;font:700 9px 'JetBrains Mono',monospace;letter-spacing:1.3px;white-space:nowrap;cursor:pointer;pointer-events:auto}
.tourchip i{display:block;width:6px;height:6px;border-radius:50%;background:#e3562a}
.tourchip.on i{animation:blink 1.2s steps(2) infinite}
@keyframes blink{50%{opacity:.15}}
.turn{position:fixed;left:0;right:0;bottom:18px;text-align:center;font:600 12px/1.4 'JetBrains Mono',monospace;letter-spacing:1px;color:#868b93;text-transform:uppercase;display:none}
@media (orientation:portrait) and (max-width:820px){.turn{display:block}}
`;

export function runLive() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  app.appendChild(canvas);
  const sc = buildScene({canvas});
  const {st, ui} = sc;
  const labels = makeLabels(st, sc.rig, sc.rider);
  const tourCursor = makeCursor(ui);

  // ------------------------------------------------------------ quality tiers: a laptop GPU drops AO, MSAA and shadow size
  const TIERS = [
    {samples: 8, ao: true, shadow: 4096, pr: 2},
    {samples: 4, ao: false, shadow: 2048, pr: 1.5},
    {samples: 2, ao: false, shadow: 1024, pr: 1},
    {samples: 0, ao: false, shadow: 1024, pr: 0.8},
  ];
  const light = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  let tier = light ? 2 : 0;
  let scale = 1;
  const fit = () => {
    scale = Math.min(innerWidth / W, innerHeight / H);
    app.style.transform = `translate(${(innerWidth - W * scale) / 2}px, ${(innerHeight - H * scale) / 2}px) scale(${scale})`;
    st.resize(W, H, clamp((devicePixelRatio || 1) * scale, 0.6, TIERS[tier].pr));
  };
  const applyTier = () => {
    const {pr, ...q} = TIERS[tier];
    st.setQuality(q);
    fit();
  };
  applyTier();
  addEventListener('resize', fit);
  const toStage = (cx, cy) => {
    const r = app.getBoundingClientRect();
    return [(cx - r.left) / scale, (cy - r.top) / scale];
  };
  const tourChip = document.createElement('div');
  tourChip.className = 'tourchip';
  ui.root.appendChild(tourChip);
  const note = document.createElement('div');
  note.className = 'turn';
  note.textContent = 'Turn your phone sideways for the full console';
  document.body.appendChild(note);

  // ------------------------------------------------------------ state the visitor drives
  let T = 0;
  let mode = 'teardown';
  let tau = 0;
  let speed = 1;
  let paused = false;
  let slow = false;
  let view = 'hero';
  let viewT0 = 0;
  let iso = null;
  let isoT0 = -9;
  const disp = Object.fromEntries(DISPLAY.map((k) => [k, {on: 0, t: -9}]));
  const off = {az: 0, el: 0, k: 1};
  const cam = {target: [0, 0, 0], az: 0, el: 0.2, d: 4, fov: 32};
  let camInit = false;
  let ring = {t: -9, x: 0, y: 0};
  const eased = (k, dur = 0.7) => {
    const d = disp[k];
    const x = ss(d.t, d.t + dur, T);
    return d.on ? x : 1 - x;
  };
  const pulse = (k) => ui.spots[k] && (ring = {t: T, x: ui.spots[k][0], y: ui.spots[k][1]});

  // ------------------------------------------------------------ the tour
  const still = prefersStill();
  if (still) paused = true;
  const AP = {on: !still, t0: 0};
  let lastInput = 0;
  const startTour = () => {
    AP.on = true;
    AP.t0 = T;
    paused = false;
    speed = 1;
    Object.assign(off, {az: 0, el: 0, k: 1});
  };
  const takeOver = () => {
    lastInput = T;
    if (!AP.on) return;
    AP.on = false;
    const cyc = (T - AP.t0) % DURATION;
    const tm = timeAt(cyc);
    mode = tm.mode;
    tau = tm.tau;
    slow = !!tm.slow;
    const [vt0, v] = viewAt(cyc);
    view = v;
    viewT0 = T - (cyc - vt0);
    const is = isolateAt(cyc);
    iso = is.key;
    isoT0 = T - (cyc - is.t0);
    const want = displayAt(cyc);
    for (const k of DISPLAY) disp[k] = {on: want[k], t: -9};
  };
  tourChip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    lastInput = T;
    if (AP.on) takeOver();
    else startTour();
  });
  addEventListener('pointerdown', (e) => {
    if (e.target !== tourChip) takeOver();
  });

  // ------------------------------------------------------------ controls
  const setView = (v) => {
    view = v;
    viewT0 = T;
    Object.assign(off, {az: 0, el: 0, k: 1});
  };
  const click = (k, fn) =>
    ui.btn[k]?.addEventListener('click', () => {
      takeOver();
      pulse(k);
      fn();
    });
  click('teardown', () => {
    mode = 'teardown';
    tau = 0;
    setView(iso ? TEAR_VIEW[iso] : 'hero');
  });
  click('sortie', () => {
    mode = 'sortie';
    tau = 0;
    paused = false;
    iso = null;
    setView('chase');
  });
  click('play', () => {
    if (mode === 'teardown') {
      mode = 'sortie';
      setView('chase');
    }
    if (tau >= PH.dur - 1e-3) tau = 0;
    paused = !paused;
  });
  click('slow', () => (slow = !slow));
  for (const k of SUBSYS)
    click(k, () => {
      iso = iso === k ? null : k;
      isoT0 = T;
      if (iso && mode === 'teardown') setView(TEAR_VIEW[iso]);
    });
  for (const v of VIEWS) click(v, () => setView(v));
  for (const k of DISPLAY)
    click(k, () => {
      disp[k].on = disp[k].on ? 0 : 1;
      disp[k].t = T;
    });
  const slider = (x0, w, y, apply) => {
    const d = document.createElement('div');
    d.className = 'hit';
    Object.assign(d.style, {left: `${x0 - 8}px`, top: `${y - 11}px`, width: `${w + 16}px`, height: '22px'});
    const move = (e) => {
      const [x] = toStage(e.clientX, e.clientY);
      apply(clamp((x - x0) / w, 0, 1));
      lastInput = T;
    };
    d.addEventListener('pointerdown', (e) => {
      takeOver();
      d.setPointerCapture(e.pointerId);
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      move(e);
    });
    ui.root.appendChild(d);
  };
  slider(ui.TL.x, ui.TL.w, 843, (k) => {
    mode = 'sortie';
    tau = k * PH.dur;
    paused = true;
  });
  slider(ui.SP.x, ui.SP.w, 847, (k) => (speed = SPEED[0] + k * (SPEED[1] - SPEED[0])));
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    const v = VIEWS[Number(key) - 1];
    if (v) ui.btn[v].click();
    else if (key === ' ') ui.btn.play.click();
    else if (key === 't') ui.btn.teardown.click();
    else if (key === 'g') ui.btn.sortie.click();
    else if (key === 'm') ui.btn.slow.click();
    else if (key === 'x') ui.btn.xray.click();
    else if (key === 'e') ui.btn.exploded.click();
    else if (key === 'c') ui.btn.cutaway.click();
    else if (key === 'l') ui.btn.labels.click();
    else if (key === 'f') ui.btn.forces.click();
    else if (key === 'r') ui.btn.trail.click();
    else if (key === 'h') ui.root.style.opacity = ui.root.style.opacity === '0' ? '1' : '0';
    else return;
    e.preventDefault();
  });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = {x: e.clientX, y: e.clientY};
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    off.az -= ((e.clientX - drag.x) / scale) * 0.006;
    off.el = clamp(off.el + ((e.clientY - drag.y) / scale) * 0.004, -0.5, 1.2);
    drag = {x: e.clientX, y: e.clientY};
    lastInput = T;
  });
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('drag');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      takeOver();
      off.k = clamp(off.k * Math.exp(e.deltaY * 0.0012), 0.3, 3);
    },
    {passive: false},
  );

  // ------------------------------------------------------------ the frame
  if (!still) startTour();
  let last = performance.now();
  const perf = {n: 0, sum: 0, slow: 0, age: 0};
  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    T += dt;
    // step a tier down when frames run long
    if (tier < TIERS.length - 1) {
      perf.age += dt;
      if (perf.age > 0.8) {
        perf.sum += dt;
        perf.n++;
        if (perf.sum >= 0.5 && perf.n >= 6) {
          perf.slow = perf.sum / perf.n > 0.022 ? perf.slow + 1 : 0;
          perf.sum = 0;
          perf.n = 0;
          if (perf.slow >= (perf.age < 6 ? 1 : 2)) {
            tier++;
            applyTier();
            Object.assign(perf, {age: 0, slow: 0});
          }
        }
      }
    }

    let state;
    if (AP.on) {
      const cyc = (T - AP.t0) % DURATION;
      const tm = timeAt(cyc);
      const is = isolateAt(cyc);
      const [vt0, v] = viewAt(cyc);
      const ed = (k, d) => {
        const on = displayAt(cyc)[k];
        const last0 = SCRIPT.filter((e) => e.display === k && e.t <= cyc).pop()?.t ?? -9;
        const x = ss(last0, last0 + d, cyc);
        return on ? x : 1 - x;
      };
      const D = {labels: ed('labels', 0.5) * ss(vt0 + 1.0, vt0 + 1.6, cyc), cutaway: ed('cutaway', 0.8), xray: ed('xray', 0.8), exploded: ed('exploded', 1), explode: ed('exploded', 1), forces: ed('forces', 0.5), trail: ed('trail', 1), isolate: is.key, isolateK: is.key ? ss(is.t0, is.t0 + 0.6, cyc) : 0, working: is.key};
      state = {
        tau: tm.tau, D, mode: tm.mode, view: v, slow: tm.slow,
        phase: tm.mode === 'teardown' ? TEAR_PHASE(is.key) : null,
        note: tm.mode === 'teardown' ? noteKeyAt(cyc) : v === 'map' ? 'map' : tm.slow ? 'cut' : PH.sample(tm.tau).phase.key,
        demo: tm.mode === 'teardown' ? (S) => benchDemo(S, cyc - is.t0, is.key) : null,
        cam: (S, q, scn) => smoothCam(camAt(cyc, S, q, scn), 0.2),
        cursor: tourCursor(cyc), speed: tm.slow ? 1 / 8 : 1, speedK: speedK(tm.slow ? 1 / 8 : 1),
      };
    } else {
      if (!still && !paused && T - lastInput > IDLE) startTour();
      if (mode === 'sortie' && !paused) tau = Math.min(PH.dur, tau + dt * speed * (slow ? 1 / 8 : 1));
      const D = {labels: eased('labels', 0.5), cutaway: eased('cutaway', 0.8), xray: eased('xray', 0.8), exploded: eased('exploded', 1), explode: eased('exploded', 1), forces: eased('forces', 0.5), trail: eased('trail', 1), isolate: iso, isolateK: iso ? ss(isoT0, isoT0 + 0.6, T) : 0, working: iso};
      const rk = Math.max(0, 1 - (T - ring.t) / 0.55);
      const since = still ? 0 : T - viewT0;
      state = {
        tau: mode === 'teardown' ? 0 : tau, D, mode, view, slow,
        phase: mode === 'teardown' ? TEAR_PHASE(iso) : null,
        note: mode === 'teardown' ? (iso ? {drive: 'drive', reels: 'reels', anchors: 'anchors', tanks: 'gas', handles: 'blades', blades: 'blades', harness: 'harness'}[iso] : 'intro') : PH.sample(tau).phase.key,
        demo: mode === 'teardown' ? (S) => benchDemo(S, still ? 0 : T - isoT0, iso) : null,
        cam: (S, q, scn) => {
          const tgt = VIEW_FN[view](S, q, since, S.speed, scn);
          tgt.az += off.az;
          tgt.el = clamp(tgt.el + off.el, -0.5, 1.4);
          tgt.d *= off.k;
          return smoothCam(tgt, 0.35);
        },
        cursor: {x: -99, y: -99, press: false, ring: rk, ringX: ring.x, ringY: ring.y},
        paused, speed: speed * (slow ? 1 / 8 : 1), speedK: speedK(speed),
      };
    }
    drawScene(sc, state, labels);
    if (tourChip.classList.contains('on') !== AP.on || !tourChip.firstChild) {
      tourChip.classList.toggle('on', AP.on);
      tourChip.innerHTML = AP.on ? '<i></i>AUTO TOUR · CLICK TO TAKE OVER' : '▶ RESUME TOUR';
    }
    if (!window.SIM_SHOWN) {
      window.SIM_SHOWN = true;
      dispatchEvent(new Event('simframe'));
    }
    requestAnimationFrame(tick);
  };
  // the camera eases toward each frame's target (a cut between views glides instead of jumping)
  let lastCamT = 0;
  const smoothCam = (tgt, tauC) => {
    const k = camInit && !still ? 1 - Math.exp(-Math.max(0, T - lastCamT) / tauC) : 1;
    lastCamT = T;
    camInit = true;
    cam.az += wrap(tgt.az - cam.az) * k;
    for (const key of ['el', 'd', 'fov']) cam[key] += ((tgt[key] ?? 32) - cam[key]) * k;
    // the target follows the rider closely so a 25 m/s flight never lags out of frame
    const kt = camInit && !still ? 1 - Math.exp(-Math.max(0, dt0) / 0.06) : 1;
    for (let i = 0; i < 3; i++) cam.target[i] += (tgt.target[i] - cam.target[i]) * Math.max(kt, k);
    return {...cam, target: cam.target.slice(), ao: tgt.ao, haze: tgt.haze};
  };
  let dt0 = 1 / 60;
  const tick = (now) => {
    dt0 = Math.min(0.1, Math.max(0, (now - last) / 1000));
    frame(now);
  };
  enableKeyboard(ui.root);
  warmComposer(st.renderer, st.composer, st.scene, st.camera).then(() => requestAnimationFrame(tick));
  window.LIVE = {sc, startTour, takeOver, get tier() {
    return tier;
  }, get T() {
    return T;
  }};
  void TEAR;
  void THREE;
}
