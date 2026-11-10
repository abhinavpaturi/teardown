// The ODM-E1 sortie, simulated once at load. A point mass (rider + rig) hangs on two Dyneema tethers; each tether is
// paid out and reeled by a speed-controlled drum whose pull is capped by the motor's torque, the bus's power and a
// slip clutch; gas-launched anchors fly ballistically and bite a trunk or a branch; trim jets push; drag follows the
// posture; the posture law reclines the rider so high loads arrive chest-to-back (+Gx); a fairlead kick spins the rider
// for the nape cut. Fixed 1/2400 s steps, recorded at 240 Hz into one Float32Array per channel; sample(tau) interpolates.
// No three.js here, so node can test it (sims/odm-dev/test.mjs). Every panel and pose in the page reads from this.

const REC = 240;
const SUB = 10;
// 1/2400 s: exactly SUB steps per record, so the stored states sit on the 240 Hz grid sample() reads
const DT = 1 / (REC * SUB);
const GAMMA = 1.4;

// ------------------------------------------------------------ small vector and quaternion helpers (arrays)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const madd = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth01 = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};
const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qNorm = (q) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
// rotation whose columns are the body axes x, y, z expressed in world
const qBasis = (x, y, z) => {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qNorm(q);
};
const qNlerp = (a, b, k) => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  return qNorm([lerp(a[0], s * b[0], k), lerp(a[1], s * b[1], k), lerp(a[2], s * b[2], k), lerp(a[3], s * b[3], k)]);
};
const qY = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

// ------------------------------------------------------------ the arena's geometry, shared with world.js
/** Trunk radius of tree i at height y: P.world.trunk profile x the tree's scale (0 above its top). */
export function trunkRadiusAt(P, i, y) {
  const t = P.world.trees[i];
  const prof = P.world.trunk;
  const top = t.h;
  if (y < 0 || y > top) return 0;
  // the profile is authored for an 86 m tree; stretch its heights to this tree
  const k = 86 / top;
  const yy = y * k;
  for (let j = 0; j < prof.length - 1; j++) {
    const [y0, r0] = prof[j];
    const [y1, r1] = prof[j + 1];
    if (yy <= y1) return t.s * lerp(r0, r1, (yy - y0) / (y1 - y0));
  }
  return t.s * prof[prof.length - 1][1];
}
/** Branch j of tree i as a straight tapered capsule: from the trunk axis out along azimuth az (0 = +z). */
export function branchAxis(P, i, j) {
  const t = P.world.trees[i];
  const [h, az, l, r0] = t.branches[j];
  const d = [Math.sin(az), 0, Math.cos(az)];
  const a = [t.x, h, t.z];
  return {tree: i, j, a, d, len: l, b: madd(a, d, l), r0: r0 * t.s, r1: r0 * t.s * 0.35};
}
const branchR = (br, s) => lerp(br.r0, br.r1, clamp(s / br.len, 0, 1));
/** World point on top of branch j of tree i, `along` metres from the trunk axis. */
export function branchTopAt(P, i, j, along) {
  const br = branchAxis(P, i, j);
  const c = madd(br.a, br.d, along);
  c[1] += branchR(br, along);
  return c;
}
/** The nape's centre on the surface, its outward normal and its frame (world). */
export function napeFrame(P) {
  const D = P.world.dummy;
  const face = [Math.sin(D.face), 0, Math.cos(D.face)];
  const n = mul(face, -1);
  const c = [D.x + n[0] * D.nape.back, D.nape.y, D.z + n[2] * D.nape.back];
  const lat = cross([0, 1, 0], n);
  return {c, n, lat, up: [0, 1, 0]};
}

// ------------------------------------------------------------ recorded channels
const CH = [
  'px', 'py', 'pz', 'vx', 'vy', 'vz', 'ax', 'ay', 'az', 'qx', 'qy', 'qz', 'qw', 'spin', 'omega',
  'Gz', 'Gx', 'Gy', 'net', 'limit', 'gloc',
  ...[0, 1].flatMap((i) => ['state', 'tipx', 'tipy', 'tipz', 'exx', 'exy', 'exz', 'len', 'T', 'u', 'slip', 'brake', 'spool', 'rpm', 'slack', 'shuttle', 'aim', 'target', 'power'].map((k) => `w${i}${k}`)),
  'gas', 'p', 'pReg', 'flow', 'gasT', 'drpm', 'dangle', 'dpower', 'bus', 'batt', 'cap',
  'thOn', 'thN', 'thx', 'thy', 'thz', 'antiG',
  'Ekin', 'Epot', 'Estore', 'Ereel', 'Ethrust', 'Edrag', 'Eclutch',
  'bOut', 'bSwing', 'bCut', 'bContact',
  'wStand', 'wHang', 'wStream', 'wCut', 'wLand', 'tuck', 'arms', 'lookx', 'looky', 'lookz',
  'onBranch', 'phase', 'speed', 'alt',
];
const IDX = Object.fromEntries(CH.map((k, i) => [k, i]));
const STATES = ['stowed', 'flight', 'anchored', 'release', 'retract'];

// ------------------------------------------------------------ the sortie script (state-triggered, SPEC section 6)
// Each step waits for its `when` (checked every 0.5 ms after the previous step ran), then runs `do`.
// fire(i, target): i 0 = the line on -x, 1 = +x. With y up and z forward (right-handed), +x is the rider's own
// LEFT: wire 0 is the right line, wire 1 the left, and every label says so. Targets: {tree, y} (trunk, facing point) or {branch: [tree, j], along}.
export const SORTIE = [
  {key: 'ready', label: 'READY ON THE BRANCH', sub: 'T0 · 30 M UP · SYSTEMS CHECK', when: (s) => s.t >= 0},
  {key: 'fire', label: 'ANCHOR L FIRED', sub: 'TO T1 · 85 M/S · 35 G OF AIR', when: (s) => s.t >= 1.0, do: (s, A) => A.fire(1, {branch: ['T1', 0], along: 10.2})},
  {key: 'step', label: 'STEP OFF', sub: 'THE WIRE TAKES THE LOAD', when: (s, A) => A.hitFor(1, 0.35), do: (s, A) => A.stepOff(2.6, 0.6)},
  {key: 'pump', label: 'PUMP', sub: 'REEL IN THROUGH THE BOTTOM OF THE ARC', when: (s, A) => A.since(0.4), do: (s, A) => A.pump(1, A.tune.pump1, 24)},
  {key: 'release', label: 'RELEASE L', sub: 'BALLISTIC · THE ANCHOR UNSCREWS', when: (s, A) => A.pastBottom(1, A.tune.rel1), do: (s, A) => A.release(1)},
  {key: 'fire', label: 'ANCHOR R FIRED', sub: 'TO T2 · IN FLIGHT', when: (s, A) => A.since(0.12), do: (s, A) => A.fire(0, {branch: ['T2', 0], along: 13.8})},
  {key: 'pump', label: 'PUMP', sub: 'R LINE · REEL IN AT THE BOTTOM', when: (s, A) => A.hitFor(0, 0.05), do: (s, A) => A.pump(0, A.tune.pump2, 24)},
  {key: 'release', label: 'RELEASE R', sub: 'BALLISTIC', when: (s, A) => A.pastBottom(0, A.tune.rel2), do: (s, A) => A.release(0)},
  {key: 'jet', label: 'TRIM JET', sub: '110 N FOR 0.3 S · ONLY +0.34 M/S', when: (s, A) => A.since(0.12), do: (s, A) => A.jet(0.3)},
  {key: 'fire', label: 'ANCHOR L FIRED', sub: 'TO T3', when: (s, A) => A.since(0.2), do: (s, A) => A.fire(1, {branch: ['T3', 0], along: 10.2})},
  {key: 'take-up', label: 'TAKE UP THE SLACK', sub: 'REEL AT 14 M/S · THE MOTOR STALLS AT 3.3 KN', when: (s, A) => A.hitFor(1, 0.05), do: (s, A) => A.pump(1, A.tune.pump3, 30)},
  {key: 'release', label: 'RELEASE L', sub: 'LAUNCHED AT THE DUMMY', when: (s, A) => A.pastBottom(1, A.tune.rel3), do: (s, A) => A.release(1)},
  {key: 'fire', label: 'ANCHOR R FIRED', sub: 'INTO THE BRANCH OVER THE NAPE', when: (s, A) => s.x[2] > A.tune.fire4z, do: (s, A) => A.fire(0, {branch: ['T4', 0], along: A.tune.along4})},
  {key: 'arms', label: 'BLADES READY', sub: 'LINE TO 21 M · SWING UNDER THE BRANCH', when: (s, A) => A.hitFor(0, 0.02), do: (s, A) => A.reelTo(0, A.cutLen(0) + A.tune.dLcut, 12)},
  {key: 'kick', label: 'SPIN KICK', sub: 'FAIRLEAD TO THE HIP · TENSION SPINS THE BODY', when: (s, A) => A.toBottom(0) < A.tune.kickLead, do: (s, A) => A.kick(0, A.tune.kick)},
  {key: 'release', label: 'RELEASE R · FREE SPIN', sub: 'BLADES OUT · BALLISTIC PASS', when: (s, A) => A.spinPeaked(), do: (s, A) => A.release(0, true)},
  {key: 'fire', label: 'ANCHOR L FIRED', sub: 'TO T5 · CATCHES THE SPIN', when: (s, A) => A.cutDone(0.04) || s.x[2] > 215, do: (s, A) => A.fire(1, {branch: ['T5', 0], along: 13.6})},
  {key: 'catch', label: 'SOFT CATCH', sub: 'CLUTCH SLIPS AT 2.5 KN · THE SPIN DIES OUT', when: (s, A) => A.hitFor(1, 0.0), do: (s, A) => A.catchSpin(1, A.tune.Lfinal)},
  {key: 'swing', label: 'SWING UP TO THE BRANCH', sub: 'REEL 6 M AT 4 M/S · SPEED TURNS INTO HEIGHT', when: (s, A) => A.since(0.9), do: (s, A) => A.reelTo(1, A.tune.Lfinal, 4, true)},
  {key: 'fire', label: 'ANCHOR R FIRED', sub: 'AT THE TOP OF THE SWING · INTO T6 ABOVE THE BRANCH', when: (s, A) => A.atApex(), do: (s, A) => A.fire(0, {tree: 'T6', y: A.tune.landY})},
  {key: 'hover', label: 'TWO-LINE HOVER', sub: 'BOTH REELS SET THE V · 1.2 M OVER THE BRANCH', when: (s, A) => A.hitFor(0, 0.0), do: (s, A) => A.hover(1.2)},
  {key: 'lower', label: 'LOWER', sub: 'PAY OUT BOTH LINES ONTO THE BRANCH · 0.8 M/S', when: (s, A) => A.hovering(), do: (s, A) => {
    A.lower(0, 0.8);
    A.lower(1, 0.8);
  }},
];
// tuned in sims/odm-dev/tune*.mjs: pump speeds, release angles, where the cut swing starts, its line length, the kick
export const TUNE = {pump1: 6, rel1: 30, pump2: 3, rel2: 30, pump3: 8, rel3: 28, fire4z: 190, along4: 12.502, dLcut: -0.920, kickLead: 0.15, kick: 0.75, Lfinal: 43, landY: 47.4};

export function buildSortie(P, opt = {}) {
  const tune = {...TUNE, ...(opt.tune || {})};
  const m = P.m;
  const g0 = P.g0;
  const W = P.world;
  const GV = [0, -g0, 0];
  const treeIdx = (id) => W.trees.findIndex((t) => t.id === id);
  const BR = W.trees.flatMap((t, i) => t.branches.map((b, j) => branchAxis(P, i, j)));
  const NAPE = napeFrame(P);
  const LIM = P.limits;

  // the start: standing on T0's launch branch over the corridor, facing down it (+z), to step off the branch's side
  const T0 = treeIdx('T0');
  const startFoot = branchTopAt(P, T0, 0, 7.6);
  const start = [startFoot[0], startFoot[1] + P.body.hipY - 0.03, startFoot[2]];
  const heading0 = [0, 0, 1];

  // ------------------------------------------------------------ state
  const mkWire = (i) => ({
    i, side: i === 0 ? -1 : 1, mode: 'stowed', tip: [0, 0, 0], tipV: [0, 0, 0], anchor: null, flightT: 0,
    L: 0, u: 0, uStar: 0, ctl: 'hold', ctlArg: [], T: 0, F: 0, slip: false, brake: 0, spool: 0, rpm: 0,
    shuttle: 0, shTarget: 0, aim: 0, target: -1, slack: 0, power: 0, hitT: -9, bottomSeen: false, prevVy: 0, softUntil: -1,
  });
  const s = {
    t: 0, x: start.slice(), v: [0, 0, 0], a: [0, 0, 0], f: [0, 1, 0],
    stand: true, landed: false, landT: -9, touchdown: 0, landPoint: null,
    q: qBasis(cross([0, 1, 0], heading0), [0, 1, 0], heading0), psi: 0, omega: 0, spinMode: 'off', relT: -9,
    wires: [mkWire(0), mkWire(1)],
    gas: P.gas.bottles * P.gas.air, gasT: 288, flow: 0,
    batt: P.bus.battWh * 3600, cap: P.bus.capJ, bus: 0,
    E: {reel: 0, thrust: 0, drag: 0, clutch: 0, ext: 0},
    jetN: 0, jetUntil: -1, jetDir: [0, 0, 1],
    arms: 0, armsT: 0, cut: 0, cutT: -9, contact: false,
    w: {stand: 1, hang: 0, stream: 0, cut: 0, land: 0}, tuck: 0,
    gloc: LIM.glocBudget, antiG: 0, G: {Gz: 1, Gx: 0, Gy: 0, net: 1},
    step: 0, stepT: 0, phase: 0, dangle: 0, drpm: 0, cdA: P.cdA.hang,
    pAvail: [P.bus.pMax, P.bus.pMax], limit: 5.0, omegaDot: 0, look: null, hits: {ground: 0, trunk: 0, branch: 0},
  };
  const events = [];
  const say = (key, label, sub) => events.push({tau: s.t, key, label, sub});

  // ------------------------------------------------------------ geometry helpers on the live state
  const qOut = () => qMul(s.q, qY(s.psi));
  const parkB = P.shuttle.park;
  const hipB = P.shuttle.hip;
  // the shuttle runs on one rail across the front: 0 parked at the buckle, 1 at its own hip, -1 at the other hip. The
  // rail is the rig's parabola: x moves linearly with the travel, y and z with its square (rig.js, the fairlead eye)
  const exitBody = (w) => {
    const k = clamp(w.shuttle, -1, 1);
    const a2 = k * k;
    return [parkB[0] + hipB[0] * w.side * k, parkB[1] + (hipB[1] - parkB[1]) * a2, parkB[2] + (hipB[2] - parkB[2]) * a2];
  };
  const exitWorld = (w, q) => add(s.x, qRot(q, exitBody(w)));
  const reelR = (L) => {
    const c = P.reel.coreR;
    const f = P.reel.fillR;
    const out = clamp(L / P.tether.len, 0, 1);
    return Math.sqrt(c * c + (f * f - c * c) * (1 - out));
  };
  const trunkHit = (p) => {
    for (let i = 0; i < W.trees.length; i++) {
      const t = W.trees[i];
      const r = trunkRadiusAt(P, i, p[1]);
      if (r <= 0) continue;
      const dx = p[0] - t.x;
      const dz = p[2] - t.z;
      const d = Math.hypot(dx, dz);
      if (d < r) return {tree: i, point: [t.x + (dx / d) * r, p[1], t.z + (dz / d) * r], normal: [dx / d, 0, dz / d]};
    }
    for (const br of BR) {
      const rel = sub(p, br.a);
      const along = clamp(dot(rel, br.d), 0, br.len);
      const c = madd(br.a, br.d, along);
      const off = sub(p, c);
      const d = len(off);
      const r = branchR(br, along);
      if (d < r && along > trunkRadiusAt(P, br.tree, br.a[1])) return {tree: br.tree, branch: br.j, point: madd(c, off, r / (d || 1)), normal: norm(off)};
    }
    return null;
  };
  const targetPoint = (tg, from) => {
    if (tg.branch) {
      const br = BR.find((b) => b.tree === treeIdx(tg.branch[0]) && b.j === tg.branch[1]);
      return {p: madd(br.a, br.d, tg.along), tree: br.tree};
    }
    const i = treeIdx(tg.tree);
    const t = W.trees[i];
    return {p: [t.x, tg.y, t.z], tree: i};
  };
  // drag-free-solve the aim: simulate the anchor's flight without hits and move the aim point by the miss
  const solveAim = (E, vr, Q) => {
    let aimP = Q.slice();
    const k = (0.5 * P.rho * P.anchor.cdA) / P.anchor.mass;
    let dir = norm(sub(Q, E));
    for (let it = 0; it < 6; it++) {
      dir = norm(sub(aimP, E));
      let p = E.slice();
      let v = madd(vr, dir, P.anchor.v0);
      let best = 1e9;
      let bp = p;
      for (let n = 0; n < 4000; n++) {
        const sp = len(v);
        v = add(v, mul(add(GV, mul(v, -k * sp)), 0.001));
        p = madd(p, v, 0.001);
        const d = len(sub(p, Q));
        if (d < best) {
          best = d;
          bp = p;
        } else if (n > 5) break;
      }
      aimP = add(aimP, sub(Q, bp));
      if (best < 0.02) break;
    }
    return dir;
  };

  // ------------------------------------------------------------ actions the script calls
  const A = {
    tune,
    since: (dt) => s.t - s.stepT >= dt,
    hitFor: (i, dt) => s.wires[i].mode === 'anchored' && s.t - s.wires[i].hitT >= dt,
    fire(i, tg) {
      const w = s.wires[i];
      const q = qOut();
      const E = exitWorld(w, q);
      const {p, tree} = targetPoint(tg, E);
      const dir = solveAim(E, s.v, p);
      w.mode = 'flight';
      w.tip = E.slice();
      w.tipV = madd(s.v, dir, P.anchor.v0);
      w.flightT = 0;
      w.target = tree;
      w.shuttle = 0;
      w.shTarget = 0;
      // the launcher's elevation in the body frame, for the rig's trunnion
      const db = qRot(qConj(q), dir);
      w.aim = Math.atan2(db[1], Math.hypot(db[0], db[2]));
      s.gas -= P.anchor.gas;
      gasDraw(P.anchor.gas);
      // powered pay-out: line and drum kinetic energy (tether.md: ~5.7 kJ per shot) from the bus
      busDraw(5700);
    },
    stepOff(fwd, up) {
      s.stand = false;
      const z = qRot(s.q, [0, 0, 1]);
      s.v = madd([0, up, 0], [z[0], 0, z[2]], fwd);
    },
    pump(i, u, halfDeg) {
      const w = s.wires[i];
      w.ctl = 'pump';
      w.ctlArg = [u, (halfDeg * Math.PI) / 180];
    },
    reel(i, u) {
      const w = s.wires[i];
      w.ctl = 'reel';
      w.ctlArg = [u];
    },
    reelTo(i, L, u, keepArms = false) {
      const w = s.wires[i];
      w.ctl = 'reelTo';
      w.ctlArg = [L, u];
      if (!keepArms) s.arms = 1;
    },
    release(i, freeSpin = false) {
      const w = s.wires[i];
      w.mode = 'retract';
      w.anchor = null;
      w.shTarget = 0;
      w.ctl = 'hold';
      if (freeSpin) {
        s.spinMode = 'free';
        s.relT = s.t;
      }
    },
    jet(dur) {
      s.jetN = P.gas.jet;
      s.jetUntil = s.t + dur;
      s.jetDir = norm(s.v);
    },
    kick(i, k) {
      const w = s.wires[i];
      w.shTarget = k;
      s.spinMode = 'kick';
    },
    // the catch: the fairlead stays parked on the centreline, so the line's pull swings the spinning body back into
    // line like a weathervane; the clutch slips at 1.5 kN for 0.6 s so that realignment happens at low load
    catchSpin(i, L) {
      const w = s.wires[i];
      w.ctl = 'reelTo';
      w.ctlArg = [L, 4];
      w.shTarget = 0;
      w.softUntil = s.t + 0.4;
      s.spinMode = 'off';
      s.arms = 0;
    },
    lower(i, u) {
      const w = s.wires[i];
      w.ctl = 'lower';
      w.ctlArg = [u];
    },
    // reel toward the anchor, decelerating so the line arrives at Lf with the drum nearly stopped (a hoist profile)
    approach(i, Lf) {
      const w = s.wires[i];
      w.ctl = 'approach';
      w.ctlArg = [Lf];
      s.arms = 0;
    },
    // the line length that puts the shoulders at nape height at the bottom of the swing: anchor height minus the
    // pelvis height there (nape minus the reclined shoulder offset) minus the stretch under ~3 g
    cutLen(i) {
      const w = s.wires[i];
      const k = 1 / (18 / P.tether.EA + 1 / P.tether.kHarness);
      return w.anchor[1] - (P.world.dummy.nape.y - 0.52 * Math.cos(1.08)) - (3 * m * g0) / k;
    },
    hold(i) {
      s.wires[i].ctl = 'hold';
    },
    // the top of the final swing: climbing has stopped
    atApex: () => s.climbed && s.v[1] <= 0.3,
    // two lines hold the rider in a V over the landing spot: each reel goes to the length that hangs the pelvis there
    hover(u) {
      const LT = treeIdx(W.landing.tree);
      const top = branchTopAt(P, LT, W.landing.branch, W.landing.along);
      s.hoverAt = [top[0], top[1] + P.body.hipY + 1.2, top[2]];
      for (const w of s.wires)
        if (w.mode === 'anchored') {
          w.ctl = 'reelTo';
          w.ctlArg = [len(sub(w.anchor, s.hoverAt)) - 0.12, u];
        }
    },
    hovering: () => s.hoverAt && len(sub(s.x, s.hoverAt)) < 0.25 && len(s.v) < 0.6,
    dangling: (i) => {
      const w = s.wires[i];
      return w.mode === 'anchored' && w.L <= w.ctlArg[0] + 0.15 && len(s.v) < 2.5;
    },
    nearTree(id, d) {
      const t = W.trees[treeIdx(id)];
      return Math.hypot(s.x[0] - t.x, s.x[2] - t.z) < d;
    },
    // anchored line i: the angle of the line from straight down, positive once the rider is past the anchor in the
    // direction of travel (reeling can turn the vertical speed before the bottom, so position decides, not speed)
    lineAngle(i) {
      const w = s.wires[i];
      if (w.mode !== 'anchored') return 0;
      const r = sub(w.anchor, s.x);
      const ang = Math.acos(clamp(r[1] / len(r), -1, 1));
      const past = -(r[0] * s.v[0] + r[2] * s.v[2]) > 0;
      return past ? ang : -ang;
    },
    pastBottom(i, deg) {
      const w = s.wires[i];
      if (w.mode !== 'anchored') return false;
      return A.lineAngle(i) >= (deg * Math.PI) / 180;
    },
    // seconds until the bottom of the swing on line i (angle over angular rate)
    toBottom(i) {
      const w = s.wires[i];
      if (w.mode !== 'anchored' || s.v[1] >= 0) return 9;
      const r = sub(w.anchor, s.x);
      const ang = Math.acos(clamp(r[1] / len(r), -1, 1));
      const omega = len(s.v) / len(r);
      return ang / Math.max(omega, 1e-3);
    },
    spinPeaked: () => s.spinMode === 'kick' && s.omegaDot < 0 && s.omega > 2,
    cutDone: (dt) => s.cutT > 0 && s.t - s.cutT >= dt,
  };

  // ------------------------------------------------------------ bus and gas bookkeeping
  const busDraw = (J) => {
    const fromBatt = Math.min(J, P.bus.battKW * 1000 * 0.5);
    s.batt -= fromBatt;
    s.cap = Math.max(0, s.cap - (J - fromBatt));
  };
  const gasDraw = (dm) => {
    const m1 = s.gas + dm;
    if (m1 > 1e-6 && s.gas > 1e-6) s.gasT *= Math.pow(s.gas / m1, GAMMA - 1);
  };

  // ------------------------------------------------------------ recording
  const DUR_MAX = 60;
  const NMAX = DUR_MAX * REC + 2;
  const data = CH.map(() => new Float32Array(NMAX));
  let N = 0;
  const rec = () => {
    const put = (k, v) => (data[IDX[k]][N] = v);
    const q = qOut();
    put('px', s.x[0]); put('py', s.x[1]); put('pz', s.x[2]);
    put('vx', s.v[0]); put('vy', s.v[1]); put('vz', s.v[2]);
    put('ax', s.a[0]); put('ay', s.a[1]); put('az', s.a[2]);
    put('qx', q[0]); put('qy', q[1]); put('qz', q[2]); put('qw', q[3]);
    put('spin', s.psi); put('omega', s.omega);
    put('Gz', s.G.Gz); put('Gx', s.G.Gx); put('Gy', s.G.Gy); put('net', s.G.net); put('limit', s.limit ?? 5.5);
    put('gloc', s.gloc);
    for (const w of s.wires) {
      const k = (n, v) => put(`w${w.i}${n}`, v);
      const E = exitWorld(w, q);
      k('state', STATES.indexOf(w.mode));
      const tip = w.mode === 'stowed' ? E : w.mode === 'anchored' ? w.anchor : w.tip;
      k('tipx', tip[0]); k('tipy', tip[1]); k('tipz', tip[2]);
      k('exx', E[0]); k('exy', E[1]); k('exz', E[2]);
      k('len', w.L); k('T', w.T); k('u', w.u); k('slip', w.slip ? 1 : 0); k('brake', w.brake);
      k('spool', w.spool); k('rpm', w.rpm); k('slack', w.slack); k('shuttle', w.shuttle); k('aim', w.aim);
      k('target', w.target); k('power', w.power);
    }
    const p = P.gas.p0 * (s.gas / (P.gas.bottles * P.gas.air)) * (s.gasT / 288);
    put('gas', s.gas); put('p', p); put('pReg', Math.min(P.gas.reg, Math.max(0, p - 10e5))); put('flow', s.flow); put('gasT', s.gasT);
    put('drpm', s.drpm); put('dangle', s.dangle); put('dpower', s.bus); put('bus', s.bus); put('batt', s.batt); put('cap', s.cap);
    const jetOn = s.t < s.jetUntil ? 1 : 0;
    put('thOn', jetOn); put('thN', jetOn * s.jetN); put('thx', -s.jetDir[0]); put('thy', -s.jetDir[1]); put('thz', -s.jetDir[2]);
    put('antiG', s.antiG);
    const Ekin = 0.5 * m * dot(s.v, s.v);
    const Epot = m * g0 * s.x[1];
    put('Ekin', Ekin); put('Epot', Epot); put('Estore', s.batt + s.cap); put('Ereel', s.E.reel); put('Ethrust', s.E.thrust); put('Edrag', s.E.drag); put('Eclutch', s.E.clutch);
    put('bOut', 1); put('bSwing', s.arms); put('bCut', s.cut); put('bContact', s.contact ? 1 : 0);
    put('wStand', s.w.stand); put('wHang', s.w.hang); put('wStream', s.w.stream); put('wCut', s.w.cut); put('wLand', s.w.land);
    put('tuck', s.tuck); put('arms', s.arms);
    const look = s.look || madd(s.x, s.v, 0.6);
    put('lookx', look[0]); put('looky', look[1]); put('lookz', look[2]);
    put('onBranch', s.stand || s.landed ? 1 : 0); put('phase', s.phase);
    put('speed', len(s.v)); put('alt', s.x[1]);
    N++;
  };

  // ------------------------------------------------------------ one step
  const E0 = 0.5 * m * dot(s.v, s.v) + m * g0 * s.x[1];
  let closureMax = 0;
  let workAbs = 0;
  let maxJerk = 0;
  const netHist = new Float32Array(Math.round(0.05 / DT));
  let histI = 0;
  let minT = 0;
  let maxSlipT = 0;
  const peaks = {net: 0, Gz: 0, Gx: 0, Gy: 0, T: 0, speed: 0, power: 0, spin: 0, gzOver: 0};

  const step = () => {
    // the script
    while (s.step < SORTIE.length && SORTIE[s.step].when(s, A)) {
      const e = SORTIE[s.step];
      e.do?.(s, A);
      say(e.key, e.label, e.sub);
      s.phase = s.step;
      s.stepT = s.t;
      s.step++;
    }
    const q = qOut();
    const yb = qRot(q, [0, 1, 0]);
    const F = [0, 0, 0];
    let busP = 0;
    const loaded = [];

    for (const w of s.wires) {
      const E = exitWorld(w, q);
      w.power = 0;
      w.slip = false;
      // the fairlead shuttle slides along its rail at 2 m/s (0.2 m in 0.1 s)
      w.shuttle += clamp(w.shTarget - w.shuttle, -DT / 0.1, DT / 0.1);
      if (w.mode === 'flight') {
        const k = (0.5 * P.rho * P.anchor.cdA) / P.anchor.mass;
        const sp = len(w.tipV);
        w.tipV = add(w.tipV, mul(add(GV, mul(w.tipV, -k * sp)), DT));
        const prevL = w.L;
        w.tip = madd(w.tip, w.tipV, DT);
        w.flightT += DT;
        w.L = len(sub(w.tip, E)) + 0.4;
        w.u = -(w.L - prevL) / DT;
        w.T = 0;
        w.slack = 0.4;
        const h = trunkHit(w.tip);
        if (h) {
          w.mode = 'anchored';
          w.anchor = h.point;
          w.hitT = s.t;
          w.target = h.tree;
          w.L = len(sub(h.point, E)) + 0.05;
          w.u = 0;
          w.bottomSeen = false;
          w.ctl = 'hold';
          const W0 = W.trees[h.tree];
          say('hit', `ANCHOR ${w.side < 0 ? 'R' : 'L'} BITES ${W0.id}`, `${(0.5 * P.anchor.mass * sp * sp / 1000).toFixed(2)} KJ · ${Math.round(sp)} M/S · ${h.branch !== undefined ? 'BRANCH' : 'TRUNK'}`);
          events[events.length - 1].point = h.point;
          events[events.length - 1].on = h.branch !== undefined ? `${W0.id}.b${h.branch}` : `${W0.id}.trunk`;
          // the drum stops: some of its spin comes back
          s.cap = Math.min(P.bus.capJ, s.cap + 2900 * P.bus.regen);
        } else if (w.flightT > 1.6) {
          w.mode = 'retract';
          say('miss', `ANCHOR ${w.side < 0 ? 'R' : 'L'} MISSED`, 'RETRIEVING');
        }
      } else if (w.mode === 'retract') {
        const rel = sub(w.tip, E);
        const d = len(rel);
        const nd = Math.max(0, d - P.anchor.retract * DT);
        w.tip = add(E, mul(rel, nd / (d || 1)));
        w.u = (d - nd) / DT;
        w.L = nd;
        w.T = 0;
        w.slack = 0;
        if (nd < 0.15) {
          w.mode = 'stowed';
          w.L = 0;
          w.u = 0;
        }
      } else if (w.mode === 'stowed') {
        w.tip = E;
        w.T = 0;
        w.u = 0;
        w.L = 0;
      } else if (w.mode === 'anchored') {
        const rel = sub(w.anchor, E);
        const d = len(rel);
        const dir = mul(rel, 1 / d);
        const st = d - w.L;
        const k = 1 / (w.L / P.tether.EA + 1 / P.tether.kHarness);
        const c = 2 * P.tether.zeta * Math.sqrt(k * m);
        const sdot = -dot(dir, s.v) + w.u;
        w.T = st > 0 ? Math.max(0, k * st + c * sdot) : 0;
        w.slack = st < 0 ? -st : 0;
        // the controller's command
        let uStar = 0;
        if (w.ctl === 'pump') {
          const ang = Math.acos(clamp(rel[1] / d, -1, 1));
          uStar = ang < w.ctlArg[1] && len(s.v) > 3 ? w.ctlArg[0] : 0;
        } else if (w.ctl === 'reel') uStar = w.ctlArg[0];
        // reel to a length: in or (braking) out, and no slack take-up past the target
        else if (w.ctl === 'reelTo') uStar = clamp((w.L - w.ctlArg[0]) * 4, -6, w.ctlArg[1]);
        else if (w.ctl === 'approach') uStar = clamp(Math.sqrt(2 * 2.5 * Math.max(0, w.L - w.ctlArg[0])), 0, 12);
        else if (w.ctl === 'lower') uStar = -w.ctlArg[0];
        // slack take-up keeps the line taut (80 N) instead of letting it snatch
        // slack take-up follows the rate the slack grows (the closing speed) plus a little, so it never snatches
        if (w.slack > 0.03 && !(w.ctl === 'reelTo' && w.L <= w.ctlArg[0])) uStar = Math.max(uStar, Math.min(P.reel.vMax, Math.max(0, dot(dir, s.v)) + 2 * w.slack));
        // the drum: reflected mass of the drum and half the motor rotor through the gearbox
        const r = reelR(w.L);
        const mD = (P.reel.drumI + 0.5 * P.motor.rotorI * P.gear.ratio * P.gear.ratio) / (r * r);
        const aCmd = clamp(60 * (uStar - w.u), -P.reel.aMax, P.reel.aMax);
        let Fm = w.T + mD * aCmd + (w.slack > 0 ? P.reel.pre : 0);
        // limits: the smart clutch slips at the g-limit or 5.5 kN; the motor's torque and the bus's power cap pull-in
        // the smart clutch: the g-limit, 5.5 kN, or 1.5 kN during a soft catch while the body realigns
        const full = Math.min(P.reel.slip, (s.limit ?? 5.5) * m * g0);
        const SOFT = 2500;
        const tCap = s.t < w.softUntil ? SOFT : lerp(SOFT, full, clamp((s.t - w.softUntil) / 0.5, 0, 1));
        const torqueF = (P.motor.tauPeak * P.gear.ratio * P.gear.eta) / r;
        const powerF = (s.pAvail[w.i] ?? P.bus.pMax) / Math.max(w.u, 0.5);
        const fMax = w.u > 0.05 || uStar > 0 ? Math.min(tCap, torqueF, powerF) : tCap;
        if (Fm > fMax) {
          Fm = fMax;
          if (w.T > fMax && w.u < 0) w.slip = true;
        }
        Fm = Math.max(Fm, -torqueF);
        w.F = Fm;
        // a slipping clutch disconnects the motor: only the drum's own inertia follows the line
        const mEff = w.T > fMax && Fm >= fMax - 1e-6 ? P.reel.drumI / (r * r) : mD;
        w.u += ((Fm - w.T) / mEff) * DT;
        w.u = clamp(w.u, -P.reel.vMax * 1.5, P.reel.vMax);
        w.L = Math.max(0.5, w.L - w.u * DT);
        w.power = Fm * w.u;
        w.brake = w.u < -0.05 ? clamp(w.T / P.reel.slip, 0, 1) : 0;
        if (w.slip) {
          s.E.clutch += w.T * -w.u * DT;
          maxSlipT = Math.max(maxSlipT, w.T);
        }
        busP += w.power > 0 ? w.power / (P.motor.eta * P.gear.eta) : w.power * P.bus.regen;
        F[0] += dir[0] * w.T;
        F[1] += dir[1] * w.T;
        F[2] += dir[2] * w.T;
        if (w.T > 150) loaded.push(w);
        if (s.v[1] >= 0 && w.prevVy < 0) w.bottomSeen = true;
        w.prevVy = s.v[1];
        minT = Math.min(minT, w.T);
      }
      // the drum turns with the line; the wound radius sets the rate
      const r = reelR(w.L);
      w.spool += (w.u * DT) / r;
      w.rpm = (Math.abs(w.u) / r) * (60 / (2 * Math.PI));
    }

    // the bus: the battery gives up to 7 kW, the supercap the rest and takes the regeneration
    s.bus = busP;
    const battP = clamp(busP, 0, P.bus.battKW * 1000);
    s.batt -= battP * DT;
    s.cap = clamp(s.cap - (busP - battP) * DT, 0, P.bus.capJ);
    const capOk = s.cap > 0.25 * P.bus.capJ;
    const pAll = capOk ? P.bus.pMax : P.bus.battKW * 1000;
    const p0 = Math.max(0, s.wires[0].power);
    const p1 = Math.max(0, s.wires[1].power);
    s.pAvail = [Math.max(2000, pAll - p1), Math.max(2000, pAll - p0)];
    s.drpm = Math.max(s.wires[0].rpm * (s.wires[0].u > 0 ? 1 : 0), s.wires[1].rpm * (s.wires[1].u > 0 ? 1 : 0)) * P.gear.ratio;
    s.dangle += (s.drpm / 60) * 2 * Math.PI * DT;

    // trim jet
    let Fj = [0, 0, 0];
    if (s.t < s.jetUntil) {
      Fj = mul(s.jetDir, s.jetN);
      const dm = (s.jetN / (P.gas.isp * g0)) * DT;
      s.gas -= dm;
      gasDraw(dm);
      s.flow = dm / DT;
    } else s.flow = 0;
    s.gasT += (288 - s.gasT) * (DT / 45);

    // drag by posture
    s.cdA = s.w.hang * P.cdA.hang + s.w.stream * P.cdA.stream + s.w.cut * P.cdA.tuck + s.w.land * P.cdA.flare + s.w.stand * P.cdA.hang;
    const sp = len(s.v);
    const Fd = mul(s.v, -0.5 * P.rho * s.cdA * sp);

    const Fng = add(add(F, Fj), Fd);
    if (s.stand) {
      s.a = [0, 0, 0];
      s.f = [0, 1, 0];
    } else if (s.landed) {
      // knees absorb: speed bleeds off over 0.35 s on the branch
      const k = Math.min(1, DT / 0.12);
      s.v = mul(s.v, 1 - k);
      s.x = madd(s.x, s.v, DT);
      s.x[1] = Math.max(s.x[1], s.landPoint[1] + P.body.hipY - 0.22);
      s.a = [0, 0, 0];
      s.f = [0, 1, 0];
    } else {
      s.a = add(GV, mul(Fng, 1 / m));
      s.v = madd(s.v, s.a, DT);
      s.x = madd(s.x, s.v, DT);
      s.f = mul(Fng, 1 / (m * g0));
      const pw = dot(Fng, s.v) * DT;
      s.E.ext += pw;
      workAbs += Math.abs(pw);
      s.E.reel += dot(F, s.v) * DT;
      s.E.thrust += dot(Fj, s.v) * DT;
      s.E.drag += dot(Fd, s.v) * DT;
    }

    // landing: feet reach the landing branch's top while lowering
    if (!s.landed && !s.stand && s.step >= SORTIE.length) {
      const LT = treeIdx(W.landing.tree);
      const lb = branchAxis(P, LT, W.landing.branch);
      const along = clamp(dot(sub(s.x, lb.a), lb.d), 3, lb.len - 1);
      const top = branchTopAt(P, LT, W.landing.branch, along);
      if (s.x[1] - P.body.hipY <= top[1] && Math.hypot(s.x[0] - top[0], s.x[2] - top[2]) < 1.2) {
        s.landed = true;
        s.landT = s.t;
        s.touchdown = len(s.v);
        s.landPoint = top;
        say('land', 'TOUCHDOWN', `${s.touchdown.toFixed(1)} M/S · KNEES ABSORB`);
        for (const w of s.wires) if (w.mode === 'anchored') A.release(w.i);
      }
    }

    // posture law: recline away from the load so it arrives chest-to-back
    const n = len(s.f);
    let target = null;
    let tau = 0.35;
    if (s.stand || s.landed) {
      const z0 = qRot(s.q, [0, 0, 1]);
      const h = norm([z0[0], 0, z0[2]]);
      target = qBasis(cross([0, 1, 0], h), [0, 1, 0], h);
      tau = 0.25;
    } else if (s.spinMode === 'free') {
      target = null;
    } else {
      const loadedNow = loaded.length > 0 && n > 0.35;
      const fhat = loadedNow ? mul(s.f, 1 / n) : [0, 1, 0];
      let h = sub(s.v, mul(fhat, dot(s.v, fhat)));
      if (len(h) < 0.5) {
        const z0 = qRot(s.q, [0, 0, 1]);
        h = sub(z0, mul(fhat, dot(z0, fhat)));
      }
      h = norm(h);
      const phi = loadedNow ? lerp(LIM.recline[0], LIM.recline[1], clamp((n - 1) / 3.3, 0, 1)) : (40 * Math.PI) / 180;
      const y = norm(sub(mul(fhat, Math.cos(phi)), mul(h, Math.sin(phi))));
      const z = norm(add(mul(fhat, Math.sin(phi)), mul(h, Math.cos(phi))));
      target = qBasis(cross(y, z), y, z);
      tau = loadedNow ? 0.1 : 0.35;
    }
    if (target) s.q = qNlerp(s.q, target, 1 - Math.exp(-DT / tau));

    // spin about the spine: torque from each loaded line about the body y axis through the pelvis
    if (!s.stand && !s.landed) {
      const qo = qOut();
      let tq = 0;
      for (const w of s.wires) {
        if (w.mode !== 'anchored' || w.T <= 0) continue;
        const E = exitWorld(w, qo);
        const Fw = mul(norm(sub(w.anchor, E)), w.T);
        const Fb = qRot(qConj(qo), Fw);
        const e = exitBody(w);
        tq += e[2] * Fb[0] - e[0] * Fb[2];
      }
      const I = lerp(P.shuttle.spinI[0], P.shuttle.spinI[1], s.arms);
      // the rider damps the weathervane wobble when not spinning; blades and arms give a little aero damping always
      const c = s.spinMode === 'off' ? 30 : 0.6;
      const od = (tq - c * s.omega) / I;
      s.omegaDot = od;
      s.omega += od * DT;
      s.psi += s.omega * DT;
      peaks.spin = Math.max(peaks.spin, Math.abs(s.omega) / (2 * Math.PI));
    } else {
      s.omega = 0;
      s.omegaDot = 0;
    }

    // g by axis in the (spun) body frame
    const qo = qOut();
    const fb = qRot(qConj(qo), s.f);
    s.G = {Gz: fb[1], Gx: fb[2], Gy: fb[0], net: n};
    // the controller's limit on the felt load (SPEC 2.2): 5 g, 3.5 g once the G-LOC budget runs low
    s.limit = s.gloc > 2 ? 5.0 : 3.5;
    // onset: the rise of the felt load over the last 50 ms (offsets, like a release, are not limited)
    netHist[histI % netHist.length] = n;
    histI++;
    if (histI > netHist.length && !s.stand && !s.landed) {
      const jerk = (n - netHist[histI % netHist.length]) / (netHist.length * DT);
      if (jerk > maxJerk) {
        maxJerk = jerk;
        peaks.jerkT = s.t;
      }
    }
    // anti-G cuffs: the G-valve opens above 2 g of +Gz
    const kPa = clamp((s.G.Gz - P.antiG.onset) / 3, 0, 1) * P.antiG.kPaMax;
    s.antiG += (kPa - s.antiG) * (1 - Math.exp(-DT / 0.25));
    const glocAt = LIM.glocG + (s.antiG > 10 ? P.antiG.gain : 0);
    s.gloc = s.G.Gz > glocAt ? s.gloc - DT : Math.min(LIM.glocBudget, s.gloc + 0.2 * DT);

    // the blades: tips at cutR from the spine axis at shoulder height, out along +/-x; the nape strip is a box
    s.contact = false;
    if (s.w.cut > 0.5 && s.cut < 1) {
      const sh = add(s.x, qRot(qo, [0, 0.52, 0]));
      for (const side of [-1, 1]) {
        const dirB = qRot(qo, [side, 0, 0]);
        for (let k = 0; k <= 8; k++) {
          const p = madd(sh, dirB, lerp(0.6, P.blade.cutR, k / 8));
          const rel = sub(p, NAPE.c);
          const dn = dot(rel, NAPE.n);
          const du = rel[1];
          const dl = dot(rel, NAPE.lat);
          if (dn < 0.005 && dn > -P.world.dummy.nape.depth - 0.02 && Math.abs(du) < P.world.dummy.nape.h / 2 && Math.abs(dl) < 0.6) s.contact = true;
        }
      }
      if (s.contact && s.cutT < 0) {
        s.cutT = s.t;
        say('cut', 'NAPE CUT', `1.0 M CHORD · 0.10 M DEEP · ${len(s.v).toFixed(0)} M/S`);
      }
    }
    if (s.cutT > 0) s.cut = clamp((s.t - s.cutT) / 0.08, 0, 1);

    // pose weights ease toward the stance the state calls for
    const anyLoaded = loaded.length > 0;
    const want = s.stand ? 'stand' : s.landed ? 'land' : s.spinMode === 'kick' || s.spinMode === 'free' || (s.arms > 0.5 && s.cutT < 0) ? 'cut' : anyLoaded ? 'hang' : 'stream';
    const kw = 1 - Math.exp(-DT / 0.16);
    for (const key of Object.keys(s.w)) s.w[key] += ((key === want ? 1 : 0) - s.w[key]) * kw;
    s.tuck += ((anyLoaded ? clamp((n - 1) / 4, 0, 0.6) : 0.1) - s.tuck) * kw;
    const nxt = s.wires.find((w) => w.mode === 'flight' || w.mode === 'anchored');
    s.look = nxt ? (nxt.mode === 'anchored' ? nxt.anchor : nxt.tip) : madd(s.x, s.v, 0.8);

    // the final swing's climb, for the apex trigger
    if (s.step > 0 && SORTIE[s.step - 1].key === 'swing' && s.v[1] > 1.5) s.climbed = true;

    // collisions the sortie must never have: the ground, a trunk, a branch (except the one being landed on)
    if (!s.stand && !s.landed) {
      if (s.x[1] < P.body.hipY - 0.05) s.hits.ground += DT;
      for (let i = 0; i < W.trees.length; i++) {
        const r = trunkRadiusAt(P, i, s.x[1]);
        if (r > 0 && Math.hypot(s.x[0] - W.trees[i].x, s.x[2] - W.trees[i].z) < r + 0.45) s.hits.trunk += DT;
      }
      for (const br of BR) {
        const rel = sub(s.x, br.a);
        const along = clamp(dot(rel, br.d), 0, br.len);
        if (len(sub(s.x, madd(br.a, br.d, along))) < branchR(br, along) + 0.45) {
          s.hits.branch += DT;
          s.hits.branchAt ??= `${W.trees[br.tree].id}.b${br.j} at ${s.t.toFixed(2)} s`;
        }
      }
    }

    // peaks and the energy ledger
    if (!s.stand && !s.landed) {
      if (n > peaks.net) [peaks.net, peaks.netT] = [n, s.t];
      if (s.G.Gz > peaks.Gz) [peaks.Gz, peaks.GzT] = [s.G.Gz, s.t];
      if (s.G.Gx > peaks.Gx) [peaks.Gx, peaks.GxT] = [s.G.Gx, s.t];
      if (Math.abs(s.G.Gy) > peaks.Gy) [peaks.Gy, peaks.GyT] = [Math.abs(s.G.Gy), s.t];
      peaks.T = Math.max(peaks.T, s.wires[0].T, s.wires[1].T);
      peaks.speed = Math.max(peaks.speed, len(s.v));
      peaks.power = Math.max(peaks.power, busP);
      if (s.G.Gz > LIM.GzSus) peaks.gzOver += DT;
      const Eb = 0.5 * m * dot(s.v, s.v) + m * g0 * s.x[1];
      closureMax = Math.max(closureMax, Math.abs(Eb - E0 - s.E.ext));
    }
  };

  // ------------------------------------------------------------ run
  let it = 0;
  rec();
  while (s.t < DUR_MAX) {
    step();
    s.t += DT;
    it++;
    if (it % SUB === 0) rec();
    if (s.landed && s.t - s.landT > 2.0) break;
    if (opt.until && opt.until(s, A)) break;
  }
  const dur = (N - 1) / REC;

  // ------------------------------------------------------------ sample(tau): one reused state object
  const S = {
    tau: 0, phase: {i: 0, key: '', label: '', sub: ''},
    pos: [0, 0, 0], vel: [0, 0, 0], acc: [0, 0, 0], speed: 0, alt: 0, q: [0, 0, 0, 1], spin: 0, omega: 0,
    G: {Gz: 0, Gx: 0, Gy: 0, net: 0, limit: 0, gloc: 0},
    wires: [0, 1].map(() => ({state: 'stowed', tip: [0, 0, 0], exit: [0, 0, 0], length: 0, tension: 0, lineSpeed: 0, slip: false, brake: 0, spool: 0, rpm: 0, target: null, slack: 0, shuttle: 0, aim: 0, power: 0})),
    gas: {mass: 0, p: 0, pReg: 0, flow: 0, T: 0},
    drive: {rpm: 0, angle: 0, power: 0},
    bus: {power: 0, batt: 0, cap: 0},
    thrust: {on: 0, N: 0, dir: [0, 0, 0]},
    antiG: 0,
    E: {kin: 0, pot: 0, store: 0, reel: 0, thrust: 0, drag: 0, clutch: 0},
    blade: {out: 1, swing: 0, cut: 0, contact: false},
    pose: {w: {stand: 1, hang: 0, stream: 0, cut: 0, land: 0}, tuck: 0, arms: 0, look: [0, 0, 0]},
    onBranch: true,
  };
  let i0 = 0;
  let i1 = 0;
  let fk = 0;
  const g = (k) => {
    const a = data[IDX[k]];
    return a[i0] + (a[i1] - a[i0]) * fk;
  };
  const gi = (k) => data[IDX[k]][fk < 0.5 ? i0 : i1];
  const evAt = (tau) => {
    let e = events[0];
    for (const x of events) if (x.tau <= tau + 1e-9 && x.key !== 'hit' && x.key !== 'miss' && x.key !== 'cut' && x.key !== 'land') e = x;
    return e;
  };
  const sample = (tau) => {
    const u = clamp(tau, 0, dur) * REC;
    i0 = Math.min(N - 1, Math.floor(u));
    i1 = Math.min(N - 1, i0 + 1);
    fk = u - i0;
    S.tau = tau;
    const e = evAt(tau);
    S.phase.i = gi('phase');
    S.phase.key = e.key;
    S.phase.label = e.label;
    S.phase.sub = e.sub;
    S.pos[0] = g('px'); S.pos[1] = g('py'); S.pos[2] = g('pz');
    S.vel[0] = g('vx'); S.vel[1] = g('vy'); S.vel[2] = g('vz');
    S.acc[0] = g('ax'); S.acc[1] = g('ay'); S.acc[2] = g('az');
    S.speed = g('speed');
    S.alt = g('alt');
    // nlerp the attitude (the spin is inside it; 240 Hz keeps a 1.25 rev/s spin to 1.9 deg per record)
    const a = [data[IDX.qx][i0], data[IDX.qy][i0], data[IDX.qz][i0], data[IDX.qw][i0]];
    const b = [data[IDX.qx][i1], data[IDX.qy][i1], data[IDX.qz][i1], data[IDX.qw][i1]];
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
    let l = 0;
    for (let k = 0; k < 4; k++) {
      S.q[k] = a[k] + (d * b[k] - a[k]) * fk;
      l += S.q[k] * S.q[k];
    }
    l = Math.sqrt(l) || 1;
    for (let k = 0; k < 4; k++) S.q[k] /= l;
    S.spin = g('spin');
    S.omega = g('omega');
    S.G.Gz = g('Gz'); S.G.Gx = g('Gx'); S.G.Gy = g('Gy'); S.G.net = g('net'); S.G.limit = g('limit'); S.G.gloc = g('gloc');
    for (let i = 0; i < 2; i++) {
      const w = S.wires[i];
      const k = (n) => `w${i}${n}`;
      w.state = STATES[gi(k('state'))];
      w.tip[0] = g(k('tipx')); w.tip[1] = g(k('tipy')); w.tip[2] = g(k('tipz'));
      w.exit[0] = g(k('exx')); w.exit[1] = g(k('exy')); w.exit[2] = g(k('exz'));
      w.length = g(k('len')); w.tension = g(k('T')); w.lineSpeed = g(k('u'));
      w.slip = gi(k('slip')) > 0.5; w.brake = g(k('brake')); w.spool = g(k('spool')); w.rpm = g(k('rpm'));
      w.slack = g(k('slack')); w.shuttle = g(k('shuttle')); w.aim = g(k('aim')); w.power = g(k('power'));
      const tg = gi(k('target'));
      w.target = tg >= 0 ? tg : null;
      // a stowed or retracting anchor never interpolates across a hit
      if (w.state === 'anchored' || w.state === 'stowed') {
        w.tip[0] = data[IDX[k('tipx')]][i1]; w.tip[1] = data[IDX[k('tipy')]][i1]; w.tip[2] = data[IDX[k('tipz')]][i1];
      }
    }
    S.gas.mass = g('gas'); S.gas.p = g('p'); S.gas.pReg = g('pReg'); S.gas.flow = g('flow'); S.gas.T = g('gasT');
    S.drive.rpm = g('drpm'); S.drive.angle = g('dangle'); S.drive.power = g('dpower');
    S.bus.power = g('bus'); S.bus.batt = g('batt'); S.bus.cap = g('cap');
    S.thrust.on = g('thOn'); S.thrust.N = g('thN'); S.thrust.dir[0] = g('thx'); S.thrust.dir[1] = g('thy'); S.thrust.dir[2] = g('thz');
    S.antiG = g('antiG');
    S.E.kin = g('Ekin'); S.E.pot = g('Epot'); S.E.store = g('Estore'); S.E.reel = g('Ereel'); S.E.thrust = g('Ethrust'); S.E.drag = g('Edrag'); S.E.clutch = g('Eclutch');
    S.blade.out = g('bOut'); S.blade.swing = g('bSwing'); S.blade.cut = g('bCut'); S.blade.contact = gi('bContact') > 0.5;
    S.pose.w.stand = g('wStand'); S.pose.w.hang = g('wHang'); S.pose.w.stream = g('wStream'); S.pose.w.cut = g('wCut'); S.pose.w.land = g('wLand');
    S.pose.tuck = g('tuck'); S.pose.arms = g('arms');
    S.pose.look[0] = g('lookx'); S.pose.look[1] = g('looky'); S.pose.look[2] = g('lookz');
    S.onBranch = gi('onBranch') > 0.5;
    return S;
  };

  const series = {t: new Float32Array(N)};
  for (let i = 0; i < N; i++) series.t[i] = i / REC;
  for (const k of ['Gz', 'Gx', 'Gy', 'net', 'limit', 'gloc', 'gas', 'p', 'speed', 'alt', 'dpower', 'bus', 'cap', 'antiG', 'w0T', 'w1T', 'w0len', 'w1len', 'w0u', 'w1u', 'thOn', 'thN', 'px', 'py', 'pz', 'bCut', 'omega', 'Ekin', 'Epot'])
    series[k] = data[IDX[k]].subarray(0, N);
  series.tensionL = series.w0T;
  series.tensionR = series.w1T;
  series.power = series.dpower;
  const track = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    track[i * 3] = data[IDX.px][i];
    track[i * 3 + 1] = data[IDX.py][i];
    track[i * 3 + 2] = data[IDX.pz][i];
  }

  const check = {
    steps: it,
    dur,
    energyClosure: closureMax / Math.max(1, workAbs + Math.abs(m * g0 * 30)),
    closureJ: closureMax,
    maxNet: peaks.net,
    maxGz: peaks.Gz,
    maxGx: peaks.Gx,
    maxGy: peaks.Gy,
    gzOverSus: peaks.gzOver,
    minTension: minT,
    maxTension: peaks.T,
    maxSlipTension: maxSlipT,
    maxSpeed: peaks.speed,
    maxBusKW: peaks.power / 1000,
    maxSpinRev: peaks.spin,
    maxJerk: maxJerk,
    peakT: {net: peaks.netT, Gz: peaks.GzT, Gx: peaks.GxT, Gy: peaks.GyT, jerk: peaks.jerkT},
    glocMin: Math.min(...series.gloc),
    gasUsed: P.gas.bottles * P.gas.air - s.gas,
    gasLeft: s.gas,
    battWh: s.batt / 3600,
    capJ: s.cap,
    cut: s.cutT > 0,
    cutTau: s.cutT,
    landed: s.landed,
    touchdown: s.touchdown,
    eventsFired: s.step,
    hitGround: s.hits.ground,
    hitTrunk: s.hits.trunk,
    hitBranch: s.hits.branch,
    hitBranchAt: s.hits.branchAt,
    eventsTotal: SORTIE.length,
  };
  return {dur, sample, series, events, track, check, channels: CH, REC, napeFrame: NAPE, final: s};
}
