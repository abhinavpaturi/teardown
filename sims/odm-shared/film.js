// ODM-E1, the film: the rider stands on the launch branch while the operator tears the rig down subsystem by subsystem
// (drive, reels, anchors, gas, handles and blades, harness, exploded), then flies the sortie the physics computed at
// load: three pendulum swings, a trim-jet puff, the cut swing with the spin kick, the nape cut in 1/8 slow motion, the
// soft catch, the final climb and the two-line hover onto the landing branch, then the whole track from above.
// Everything on screen is a pure function of film time t: the sortie time, the view, the display toggles, the
// subsystem isolated, the bench demos and the cursor all come from SCRIPT.
import * as THREE from 'three';
import {runSim} from 'teardown-kit/runtime.js';
import {createConsole, DISPLAY} from './console.js';
import {buildFx} from './fx.js';
import {P} from './params.js';
import {buildRider} from './rider.js';
import {buildRig} from './rig.js';
import {createOdmStage} from './stage.js';
import {buildWorld} from './world.js';

const V3 = THREE.Vector3;
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

import {DURATION, displayAt, easedDisplay, filmAt, isolateAt, noteKeyAt, PH, SCRIPT, SLOW, TAIL, TEAR, timeAt, viewAt} from './timeline.js';

export {DURATION, displayAt, easedDisplay, filmAt, isolateAt, noteKeyAt, PH, SCRIPT, TEAR, timeAt, viewAt};
const VIEWS_AT = SCRIPT.filter((e) => e.view).map((e) => [e.t, e.view]);

// ------------------------------------------------------------ the notes: why each moment works, numbers from P and the physics
const c = PH.check;
const f1 = (x) => x.toFixed(1);
export const NOTES = {
  intro: `<b>${P.name}</b> keeps the canon silhouette (butterfly core, hip reels, blade boxes, gas bottles) and replaces every part that cannot work with real engineering. Everything here is computed, not animated.`,
  drive: `<b>The "fan" is a motor.</b> Compressed air gives ~8 Wh/kg of shaft work, Li-ion 260. An axial-flux motor-generator (${P.motor.pCont / 1000} kW, ${P.mass.motor} kg) drives both drums through a ${P.gear.ratio}:1 planetary; its cooling impeller is the fan.`,
  reels: `<b>Dyneema, not iron.</b> ${P.tether.len} m of ${P.tether.d * 1000} mm SK99 per drum breaks at ${f1(P.tether.mbs / 1000)} kN and weighs ${(P.tether.len * P.tether.lin).toFixed(2)} kg. Steel of that strength: 12.6 kg. The clutch slips at ${f1(P.reel.slip / 1000)} kN.`,
  anchors: `<b>Gas fires the anchors.</b> A piston throws a ${P.anchor.mass} kg titanium helical spike at ${P.anchor.v0} m/s (${f1((0.5 * P.anchor.mass * P.anchor.v0 ** 2) / 1000)} kJ, ${P.anchor.gas * 1000} g of air). It bites ~${P.anchor.depth * 100} cm and holds ${P.anchor.hold / 1000} kN, then unscrews to let go.`,
  gas: `<b>Gas cannot lift you.</b> Cold air manages ~${P.gas.isp} s of specific impulse: a full bottle would hover ${Math.round(P.m)} kg for about 1.3 s. It fires anchors, trims and fills the anti-G cuffs. This sortie uses ${Math.round(c.gasUsed * 1000)} g.`,
  blades: `<b>Let the body do the cut.</b> ${P.blade.len} m of ${P.blade.steel}, ${Math.round((P.blade.edge * 180) / Math.PI)}° edge, ${P.blade.scores} snap-off scores. The nape takes ~600 J of the rider's ~26 kJ; the score lines break before the wrist does.`,
  harness: `<b>The load goes chest-to-back.</b> The rider reclines as the pull rises, so +Gx (tolerated to 8 g for 2 s) takes it, not +Gz (G-LOC from 4.7 g). The cuffs add ${P.antiG.gain} g; the cowl holds the head above 2.5 g.`,
  mass: `<b>The honest cost: ${f1(P.rigMass)} kg.</b> That is ${Math.round((P.rigMass / P.rider.mass) * 100)} % of a 70 kg rider; the canon replica weighs 10 kg. Battery and supercaps take 6.1 kg: power, not energy, sets them.`,
  ready: `Standing on the launch branch 30 m up. The right line is fired first: ${P.anchor.v0} m/s, ${P.anchor.gas * 1000} g of air.`,
  fire: `<b>Anchor away.</b> The reel pays line out at the anchor's own speed, so the spike is not dragged down; the drum spins up to ~13,000 rpm.`,
  hit: `<b>Bite.</b> The spike's kinetic energy drives it into the wood; the drum brakes and returns some of its spin to the supercaps.`,
  step: `<b>Step off.</b> For 1.5 s the rider just falls; then the line takes the load and the fall becomes a pendulum.`,
  pump: `<b>Pumping.</b> Reeling in at the bottom of the arc, where tension is highest, adds energy (W = ∫T dL): the rider climbs higher than they fell, with no gas.`,
  release: `<b>Release.</b> The anchor unscrews and the line retrieves at ${P.anchor.retract} m/s; the rider flies ballistic until the next bite.`,
  jet: `<b>The trim jet: ${P.gas.jet} N for 0.3 s.</b> That is ${((P.gas.jet * 0.3) / P.m).toFixed(2)} m/s of Δv for ${Math.round(((P.gas.jet * 0.3) / (P.gas.isp * P.g0)) * 1000)} g of air. This is why canon's gas-flight cannot work.`,
  'take-up': `<b>The motor stalls by design.</b> At the bottom of this swing the line pulls 3.3 kN: exactly what 40 N·m through ${P.gear.ratio}:1 can hold on this drum radius. The reel takes up slack; the swing does the rest.`,
  arms: `<b>Blades ready.</b> The cut line is reeled to the length that puts the shoulders at nape height at the bottom of the swing.`,
  kick: `<b>A spin from tension.</b> The fairlead slides off the centreline: 3.3 kN through the offset spins the body to ${c.maxSpinRev.toFixed(2)} rev/s in 0.15 s. No gas.`,
  cut: `<b>1.0 m chord, 0.10 m deep.</b> A ${P.blade.cutR} m tip radius dipping 10 cm cuts exactly the canon kill strip. The pass is ballistic: the line already let go.`,
  catch: `<b>Soft catch.</b> The clutch slips at 2.5 kN while the centred fairlead swings the spinning body back into line, like a weathervane.`,
  swing: `<b>Speed into height.</b> A gentle 4 m/s reel-in lifts the bottom of the arc off the forest floor; the climb ends almost exactly at the branch.`,
  hover: `<b>Two-line hover.</b> Both reels set a V over the landing branch; the rider hangs 1.2 m above it.`,
  lower: `<b>Touchdown at ${c.touchdown.toFixed(1)} m/s.</b> Peak load this sortie: ${c.maxNet.toFixed(1)} g net, ${c.maxGz.toFixed(1)} g +Gz, under the limits throughout.`,
  map: `<b>${Math.round(PH.track[PH.track.length - 1])} m in ${PH.dur.toFixed(1)} s</b>, ${Math.round(c.gasUsed * 1000)} g of gas, ${Math.round((P.bus.battWh * 3600 - c.battWh * 3600) / 3600)} Wh of battery. The trail is coloured by the felt load.`,
};

const TEAR_TITLE = {drive: ['DRIVE', 'MOTOR-GENERATOR · IMPELLER · 5:1 PLANETARY · CLUTCH-BRAKES'], reels: ['REELS', 'TWO DRUMS · 60 M OF DYNEEMA EACH'], anchors: ['ANCHORS', 'GAS-PISTON LAUNCHERS · TITANIUM HELICAL SPIKES'], tanks: ['GAS', 'TWO 2 L TYPE IV BOTTLES · 300 BAR'], handles: ['HANDLES & BLADES', 'SQUEEZE TO REEL · TRIGGER TO FIRE · HAMMER TO EJECT'], harness: ['HARNESS', 'PELVIC GIRDLE · BACK PLATE · ANTI-G CUFFS · COWL']};
export const TEAR_PHASE = (iso) => {
  const [a, b] = TEAR_TITLE[iso] || ['TEARDOWN', 'ON THE LAUNCH BRANCH · 30 M UP'];
  return {label: iso ? `TEARDOWN · ${a}` : 'TEARDOWN', sub: b};
};

// ------------------------------------------------------------ cameras: each view is a function of the rider state
const yawOf = (q) => {
  const z = new V3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(z.x, z.z);
};
const bodyPt = (S, q, x, y, z) => new V3(x, y, z).applyQuaternion(q).add(new V3(...S.pos));
const NAPE_C = PH.napeFrame.c;
export const VIEW_FN = {
  hero: (S, q, u) => ({target: bodyPt(S, q, 0, 0.18, 0).toArray(), az: yawOf(q) + Math.PI - 0.62 + 0.025 * u, el: 0.15, d: 3.5, fov: 32}),
  front: (S, q, u) => ({target: bodyPt(S, q, 0, 0.2, 0).toArray(), az: yawOf(q) + 0.42 - 0.02 * u, el: 0.08, d: 3.4, fov: 32}),
  // straight at the hub from behind and a little below, as the rig's own bench frames it: the cut quarter opens to it
  core: (S, q, u) => ({target: bodyPt(S, q, 0.0, 0.03, -0.24).toArray(), az: yawOf(q) + Math.PI - 0.18 + 0.03 * u, el: -0.12, d: 0.72, fov: 38, ao: 0}),
  reel: (S, q, u) => ({target: bodyPt(S, q, 0.16, 0.1, -0.21).toArray(), az: yawOf(q) + Math.PI - 1.05 + 0.04 * u, el: 0.3, d: 1.0, fov: 30, ao: 0}),
  hip: (S, q, u) => ({target: bodyPt(S, q, 0.2, -0.04, 0.08).toArray(), az: yawOf(q) + 1.15 + 0.04 * u, el: 0.12, d: 1.15, fov: 30}),
  gas: (S, q, u) => ({target: bodyPt(S, q, 0.22, -0.12, 0.08).toArray(), az: yawOf(q) + 1.8 - 0.04 * u, el: 0.32, d: 1.5, fov: 30}),
  hands: (S, q, u, sp, sc) => {
    // between the two grips, wherever the pose puts them
    const a = sc ? sc.rider.hands.L.getWorldPosition(new V3()) : bodyPt(S, q, -0.3, -0.1, 0);
    const b = sc ? sc.rider.hands.R.getWorldPosition(new V3()) : bodyPt(S, q, 0.3, -0.1, 0);
    return {target: a.add(b).multiplyScalar(0.5).toArray(), az: yawOf(q) + 0.75 + 0.04 * u, el: 0.2, d: 1.55, fov: 34};
  },
  explode: (S, q, u) => ({target: bodyPt(S, q, 0, 0.15, -0.05).toArray(), az: yawOf(q) + Math.PI - 0.85 + 0.12 * u, el: 0.2, d: 4.4, fov: 32}),
  chase: (S, q, u, sp) => {
    const v = S.vel;
    const yaw = Math.hypot(v[0], v[2]) > 1 ? Math.atan2(v[0], v[2]) : yawOf(q);
    return {target: [S.pos[0], S.pos[1] + 0.3, S.pos[2]], az: yaw + Math.PI - 0.42, el: 0.2, d: 7.5 + 0.12 * sp, fov: 40 + 0.5 * sp};
  },
  // inside the corridor: the trees stand 12 m either side of it
  side: (S) => ({target: [S.pos[0], S.pos[1] + 0.2, S.pos[2]], az: Math.PI / 2 + 0.25, el: 0.16, d: 9.5, fov: 54}),
  jet: (S, q) => ({target: bodyPt(S, q, 0, 0, -0.2).toArray(), az: yawOf(q) + Math.PI - 1.3, el: 0.12, d: 4.2, fov: 38}),
  nape: () => ({target: [NAPE_C[0] + 0.9, NAPE_C[1] - 0.2, NAPE_C[2] + 0.4], az: 1.0, el: 0.14, d: 7.2, fov: 36}),
  land: (S) => ({target: [S.pos[0], S.pos[1] - 0.2, S.pos[2]], az: 1.25, el: 0.18, d: 6.5, fov: 36}),
  map: () => ({target: [0, 22, 160], az: 1.42, el: 0.62, d: 280, fov: 32, haze: [500, 1500]}),
};
const blendCam = (a, b, k) => {
  const o = {};
  for (const key of ['az', 'el', 'd', 'fov']) {
    const av = a[key] ?? 32;
    const bv = b[key] ?? 32;
    o[key] = key === 'az' ? av + ((((bv - av + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k) : av + (bv - av) * k;
  }
  o.target = a.target.map((v, i) => v + (b.target[i] - v) * k);
  // a long hop (rig close-up to chase) swings wide so the path never cuts through the body
  const hop = Math.abs(Math.log(b.d / a.d));
  o.d *= 1 + 0.25 * Math.min(1, hop / 2) * Math.sin(Math.PI * k);
  o.ao = k < 0.5 ? a.ao : b.ao;
  o.haze = k < 0.5 ? a.haze : b.haze;
  return o;
};
export const camAt = (t, S, q, sc) => {
  let i = 0;
  while (i < VIEWS_AT.length - 1 && VIEWS_AT[i + 1][0] <= t) i++;
  const sp = S.speed;
  const cur = VIEW_FN[VIEWS_AT[i][1]](S, q, t - VIEWS_AT[i][0], sp, sc);
  if (i === 0) return cur;
  const k = ss(VIEWS_AT[i][0], VIEWS_AT[i][0] + 1.3, t);
  return k < 1 ? blendCam(VIEW_FN[VIEWS_AT[i - 1][1]](S, q, t - VIEWS_AT[i - 1][0], sp, sc), cur, k) : cur;
};

// ------------------------------------------------------------ the teardown's bench demos on top of the standing state
// in the teardown the sortie is frozen at tau 0, so the operator runs the motor, turns the drums, steps the launcher,
// swaps a blade and pressurises the cuffs to show each subsystem working. u = seconds since the subsystem was isolated.
export function benchDemo(S, u, iso) {
  const spin = iso === 'drive' || iso === 'reels';
  const rpm = spin ? 9000 * ss(0.3, 1.4, u) : 0;
  // the angle of a motor ramping to 9,000 rpm over ~1.1 s, then steady
  const w = (9000 / 60) * 2 * Math.PI;
  S.drive.rpm = rpm;
  S.drive.angle = spin ? (w * Math.max(0, u - 0.85)) % (Math.PI * 2 * 64) : 0;
  for (const wr of S.wires) {
    wr.spool = S.drive.angle / P.gear.ratio;
    wr.rpm = rpm / P.gear.ratio;
  }
  // the launchers step through their elevation range
  if (iso === 'anchors') for (const wr of S.wires) wr.aim = 0.12 * Math.sin(u * 1.6);
  // a blade swap on the handles: the old blade ejects and a new one seats, every 4 s
  if (iso === 'handles') S.blade.out = 1 - Math.sin(Math.PI * ss(0.6, 2.0, u % 4));
  // the anti-G cuffs fill and the cowl comes up, every 3.5 s
  if (iso === 'harness') {
    const k = Math.sin(Math.PI * ss(0.2, 2.4, u % 3.5));
    S.antiG = P.antiG.kPaMax * k;
    S.G.net = 1 + 2.4 * k;
  }
  return S;
}

// ------------------------------------------------------------ callouts: the rig's own label points, in two columns
// the rig names its +x parts "right"; with y up and z forward that is the rider's own left, so the callouts swap them
const sideName = (n) => n.replace(/\b(right|left|Right|Left|RIGHT|LEFT)\b/g, (w) => ({right: 'left', left: 'right', Right: 'Left', Left: 'Right', RIGHT: 'LEFT', LEFT: 'RIGHT'})[w]);
export function makeLabels(st, rig, rider) {
  const m = new THREE.Matrix4();
  const v = new V3();
  return (o, iso) => {
    if (o < 0.02) return [];
    m.copy(rider.pelvis.matrixWorld);
    const pts = [];
    for (const L of rig.labels) {
      if (iso && L.group !== iso) continue;
      v.copy(L.at()).applyMatrix4(m);
      const p = st.project(v.x, v.y, v.z);
      if (p && p[0] > 360 && p[0] < 1260 && p[1] > 150 && p[1] < 780) pts.push({L, at: p, name: sideName(L.name)});
    }
    const left = pts.filter((x) => x.at[0] < 800).sort((a, b) => a.at[1] - b.at[1]).slice(0, 7);
    const right = pts.filter((x) => x.at[0] >= 800).sort((a, b) => a.at[1] - b.at[1]).slice(0, 7);
    const out = [];
    const stack = (col, x, isRight) => {
      let y = 170;
      for (const c of col) {
        y = Math.max(y, Math.min(760, c.at[1]));
        out.push({name: c.name, sub: c.L.sub, at: c.at, label: [x, y], right: isRight, o});
        y += 36;
      }
    };
    stack(left, 350, false);
    stack(right, 1250, true);
    return out;
  };
}

// ------------------------------------------------------------ the operator's cursor: walks to each button and presses it
export function makeCursor(ui) {
  const EV = SCRIPT.filter((e) => e.t > 0.5).flatMap((e) => {
    const out = [];
    if (e.sortie) out.push({t: e.t, spot: ui.spots.sortie});
    if ('isolate' in e && e.isolate) out.push({t: e.t, spot: ui.spots[e.isolate]});
    if (e.view && !e.sortie) out.push({t: e.t + ('isolate' in e ? 0.35 : 0), spot: ui.spots[e.view]});
    if (e.display) out.push({t: e.t, spot: ui.spots[e.display]});
    if (e.slow) out.push({t: e.t, spot: ui.spots.slow});
    return out;
  }).filter((e) => e.spot);
  EV.sort((a, b) => a.t - b.t);
  const REST = [[860, 600], [760, 660], [920, 640], [820, 700]];
  const WP = [[0, 900, 620]];
  EV.forEach((e, i) => {
    WP.push([e.t - 0.18, ...e.spot], [e.t + 0.2, ...e.spot]);
    const nxt = EV[i + 1];
    if (!nxt || nxt.t - e.t > 1.6) WP.push([e.t + 1.4, ...REST[i % REST.length]]);
  });
  WP.sort((a, b) => a[0] - b[0]);
  return (t) => {
    let i = 0;
    while (i < WP.length - 2 && t > WP[i + 1][0]) i++;
    const [t0, x0, y0] = WP[i];
    const [t1, x1, y1] = WP[i + 1];
    const k = ss(t0, t1, t);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bow = Math.sin(Math.PI * k) * Math.min(24, len * 0.07);
    let press = false;
    let ring = 0;
    let rx = 0;
    let ry = 0;
    for (const e of EV) {
      if (t >= e.t - 0.07 && t < e.t + 0.09) press = true;
      if (t >= e.t && t < e.t + 0.55) {
        ring = 1 - (t - e.t) / 0.55;
        [rx, ry] = e.spot;
      }
    }
    return {x: x0 + (x1 - x0) * k + (len ? (-(y1 - y0) / len) * bow : 0), y: y0 + (y1 - y0) * k + (len ? ((x1 - x0) / len) * bow : 0), press, ring, ringX: rx, ringY: ry};
  };
}

// ------------------------------------------------------------ the scene: every module, built once
export function buildScene({canvas}) {
  const st = createOdmStage({canvas});
  const world = buildWorld(P, PH);
  const rider = buildRider(P);
  const rig = buildRig(P);
  rider.pelvis.add(rig.root);
  const fx = buildFx(P, PH);
  st.scene.add(world.root, rider.root, fx.root);
  st.aoHide.push(fx.root);
  const ui = createConsole(document.getElementById('app'), P, PH);
  return {st, world, rider, rig, fx, ui};
}

const tmpV = new V3();
/** Pose and draw one frame. state: {tau, D (display), iso, isoK, cam, demo(S), mode, view, slow, cursor, labels, paused, speed, speedK, note}. */
export function drawScene(sc, state, labels) {
  const {st, world, rider, rig, fx, ui} = sc;
  let S = PH.sample(state.tau);
  if (state.demo) S = state.demo(S);
  const D = state.D;
  world.update(S, D);
  rider.update(S, D);
  rider.root.updateMatrixWorld(true);
  rig.update(S, D, {L: rider.hands.L.matrixWorld, R: rider.hands.R.matrixWorld});
  const q = new THREE.Quaternion(...S.q);
  const cam = state.cam(S, q, sc);
  // GTAO ignores the cutaway's clipping planes, so the cut shots go without it
  if ((D.cutaway ?? 0) > 0.01) cam.ao = 0;
  st.place(cam);
  fx.update(S, D, st.camera, st.size);
  st.draw();
  ui.update({
    S,
    tau: state.tau,
    mode: state.mode,
    view: state.view,
    display: Object.fromEntries(DISPLAY.map((k) => [k, (D[k] ?? 0) > 0.5])),
    isolate: D.isolate,
    // callouts belong to close shots: they fade as the camera pulls back past ~6 m
    callouts: labels((D.labels ?? 0) * (state.labelsK ?? 1) * (1 - ss(4.5, 7, st.camera.position.distanceTo(rider.pelvis.getWorldPosition(tmpV)))), D.isolate),
    cursor: state.cursor,
    paused: state.paused ?? false,
    speed: state.speed ?? (state.slow ? 1 / SLOW.k : 1),
    speedK: state.speedK ?? 0.45,
    slow: state.slow,
    note: NOTES[state.note] ?? '',
    phase: state.phase,
  });
  return S;
}

export function makeFilm() {
  return async ({canvas, capture}) => {
    const sc = buildScene({canvas});
    const resize = () => sc.st.resize(1600, 900, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
    resize();
    const cursorAt = makeCursor(sc.ui);
    const labels = makeLabels(sc.st, sc.rig, sc.rider);
    window.SC = sc;
    return {
      resize,
      render(t) {
        const {mode, tau, slow} = timeAt(t);
        const iso = isolateAt(t);
        const isoK = iso.key ? ss(iso.t0, iso.t0 + 0.6, t) : 0;
        const [vt0, view] = viewAt(t);
        const D = {
          labels: easedDisplay('labels', t, 0.5) * ss(vt0 + 1.0, vt0 + 1.6, t),
          cutaway: easedDisplay('cutaway', t, 0.8),
          xray: easedDisplay('xray', t, 0.8),
          exploded: easedDisplay('exploded', t, 1.0),
          explode: easedDisplay('exploded', t, 1.0),
          forces: easedDisplay('forces', t, 0.5),
          trail: easedDisplay('trail', t, 1.0),
          isolate: iso.key,
          isolateK: isoK,
          working: iso.key,
        };
        const noteKey = mode === 'teardown' ? noteKeyAt(t) : view === 'map' ? 'map' : slow ? 'cut' : PH.sample(tau).phase.key;
        drawScene(sc, {
          phase: mode === 'teardown' ? TEAR_PHASE(iso.key) : null,
          tau,
          D,
          mode,
          view,
          slow,
          note: noteKey,
          demo: mode === 'teardown' ? (S) => benchDemo(S, t - iso.t0, iso.key) : null,
          cam: (S, q, scn) => camAt(t, S, q, scn),
          cursor: cursorAt(t),
        }, labels);
        return {};
      },
    };
  };
}

export const DEFAULTS = {duration: DURATION, fps: 60, theme: 'light', hud: {enabled: false, title: 'ODM-E1', subtitle: 'Omni-Directional Mobility Gear'}, director: {enabled: false}, watermark: ''};
export const run = () => runSim(DEFAULTS, makeFilm());
