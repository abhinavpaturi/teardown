// CONTRACT-REQUEST (physics, integrator): the cut stance reads S.omega (signed spin rate about body y, rad/s; physics
//   already provides it, CONTRACT.md does not list it) to trail the blades and lead with the edges for either spin
//   direction; without it (or S.spinRate) the blades stand straight out. rider.bladeTipLocal('L'|'R', out) returns a
//   tip in the body frame for the current pose: in the cut at full spin it sits on P.blade.cutR at y = P.body.shoulder.y.
// CONTRACT-REQUEST (rig): in 'hang' (hip flexion 78-100 deg) the thighs sweep through the fairlead rail in front of the
//   hip joints (y ~0, z 0.13-0.165); the rail needs to sit above the hip crease (y ~ +0.05) or the rider cannot sit.
//
// The rider: a 1.75 m faceless study mannequin in the canon cropped jacket, white trousers and knee boots, wearing the
// full-body harness of the official layout: Y shoulder straps to a chest strap, flank straps down to the
// rig's girdle, an X over the groin, a seat strap under the buttocks, two bands round each thigh, straps down the legs
// that cross over the shins to the ankle bands; at the back an X between the scapulae and an X over the buttocks. Under
// the bands sit the pneumatic anti-G cuffs (abdomen, thighs, calves) that swell with S.antiG.
//
// One skeleton in the body frame (origin at the hip-joint midpoint, x right, y up the spine, z forward). The pelvis
// bone IS the body frame and is never rotated, so the rig hangs straight off it. Every surface is a loft of
// superelliptic rings through a key table (monotone cubic between keys, so no radius overshoots), with the P.body
// landmarks as exact rows: the waist ring is the ellipse the girdle hugs, the chest ring is the jacket the back plate
// sits on. Body, uniform, straps and cuffs are skinned to the same bones with the same weight functions, so a strap
// rides exactly on the skin under it in any pose (and where a strap crosses a joint it bridges like a loaded strap).
//
// update(S, D) is pure and allocation-free: the five stances blend by S.pose.w, tuck and arms add on top, each arm is
// a two-bone IK that puts the fist on a grip frame with the blade where the stance wants it (the forearm takes the
// roll, the wrist only swings), the head turns toward S.pose.look within the neck's limits, the cuffs inflate (morph
// targets), and x-ray / isolate fade the body into the ghost shell while the harness stays solid and warms toward the
// accent with the wire load. In the cut the blades trail the spin (S.omega) with the edges leading and the tips on
// the P.blade.cutR circle at shoulder height, where the physics checks the nape.
import * as THREE from 'three';
import {HEX, ghost, mat} from './materials.js';

const V3 = THREE.Vector3;
const Q = THREE.Quaternion;
const deg = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => clamp(x, 0, 1);
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

// ------------------------------------------------------------ skeleton (body frame, rest = standing, arms down, thumbs forward)
const BONES = ['pelvis', 'spine', 'chest', 'neck', 'head', 'clavR', 'shR', 'elR', 'wrR', 'clavL', 'shL', 'elL', 'wrL', 'hipR', 'kneeR', 'ankR', 'hipL', 'kneeL', 'ankL'];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
const PARENT = {spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck', clavR: 'chest', shR: 'clavR', elR: 'shR', wrR: 'elR', clavL: 'chest', shL: 'clavL', elL: 'shL', wrL: 'elL', hipR: 'pelvis', kneeR: 'hipR', ankR: 'kneeR', hipL: 'pelvis', kneeL: 'hipL', ankL: 'kneeL'};
function restJoints(b) {
  const sh = b.shoulder;
  const J = {pelvis: [0, 0, 0], spine: [0, 0.17, -0.03], chest: [0, 0.31, -0.03], neck: [0, b.neck.y - 0.025, -0.02], head: [0, b.head.y - 0.06, -0.005]};
  for (const [s, sx] of [['R', 1], ['L', -1]]) {
    J['clav' + s] = [sx * 0.03, sh.y - 0.025, 0.035]; // sternoclavicular joint
    J['sh' + s] = [sx * sh.x, sh.y, 0];
    J['el' + s] = [sx * sh.x, sh.y - b.upperArm, 0];
    J['wr' + s] = [sx * sh.x, sh.y - b.upperArm - b.forearm, 0];
    J['hip' + s] = [sx * b.hipX, 0, 0];
    J['knee' + s] = [sx * b.hipX, -b.thigh.len, 0];
    J['ank' + s] = [sx * b.hipX, -b.thigh.len - b.shank.len, 0];
  }
  return J;
}

// ------------------------------------------------------------ shape tables: [s, rx, rzF, rzB, cx, cz, n]
// s runs along the loft axis; rx is the half-width along U, rzF/rzB the half-depth in front/behind along V, (cx, cz) the
// section centre, n the superellipse exponent (2 = ellipse, higher = boxier).
const torsoRows = (b) => [
  [-0.112, 0.098, 0.034, 0.070, 0, -0.054, 2.2], // gluteal fold; the crotch rises in front so the inner thighs show
  [-0.090, 0.128, 0.050, 0.090, 0, -0.040, 2.3],
  [-0.060, 0.152, 0.075, 0.104, 0, -0.022, 2.4],
  [-0.030, 0.168, 0.094, 0.110, 0, -0.010, 2.4],
  [0.0, b.pelvis.rx + 0.003, b.pelvis.rz - 0.01, b.pelvis.rz - 0.002, 0, -0.004, 2.4], // hips (clear of the thigh tops)
  [0.05, 0.170, 0.111, 0.116, 0, -0.002, 2.25],
  [0.095, 0.155, 0.110, 0.111, 0, 0, 2.05],
  [b.waist.y, b.waist.rx, b.waist.rz, b.waist.rz, 0, 0, 2.0], // the girdle's ellipse, exactly
  [0.165, 0.150, 0.108, 0.108, 0, 0, 2.0],
  [0.21, 0.153, 0.106, 0.106, 0, 0, 2.1],
  [0.27, 0.157, 0.110, 0.107, 0, 0, 2.2],
  [0.32, 0.160, 0.113, 0.109, 0, 0, 2.3],
  [b.chest.y, b.chest.rx - 0.004, b.chest.rz - 0.002, b.chest.rz - 0.004, 0, 0, 2.35], // shirt; the jacket lands on the landmark
  [0.42, 0.166, 0.110, 0.112, 0, -0.002, 2.4],
  [0.46, 0.168, 0.098, 0.106, 0, -0.005, 2.4],
  [0.495, 0.164, 0.082, 0.096, 0, -0.008, 2.4],
  [0.52, 0.166, 0.070, 0.088, 0, -0.012, 2.4], // the trapezius runs out to the deltoid
  [0.54, 0.155, 0.062, 0.078, 0, -0.014, 2.3],
  [0.555, 0.128, 0.058, 0.070, 0, -0.014, 2.2],
  [0.57, 0.090, 0.056, 0.064, 0, -0.013, 2.1],
  [b.neck.y, b.neck.r, b.neck.r - 0.004, b.neck.r, 0, -0.012, 2.0],
  [0.63, 0.054, 0.051, 0.055, 0, -0.010, 2.0],
  [0.685, 0.050, 0.048, 0.052, 0, -0.006, 2.0],
];
// right leg, s down from the hip joint, U outward: trousers to the boot top at 0.50, then the loose boot shaft
const legRows = (b) => [
  [-0.02, 0.078, 0.078, 0.080, 0, 0, 2.0],
  [0.01, 0.085, 0.086, 0.088, 0.003, 0, 2.1],
  [0.05, b.thigh.rTop - 0.001, b.thigh.rTop, b.thigh.rTop, 0.006, 0.002, 2.15],
  [0.11, 0.083, 0.085, 0.083, 0.007, 0.004, 2.1],
  [0.2, 0.075, 0.079, 0.073, 0.006, 0.005, 2.05],
  [0.3, 0.066, 0.070, 0.063, 0.004, 0.005, 2.0],
  [0.38, 0.058, 0.060, 0.056, 0.002, 0.004, 2.0],
  [b.thigh.len, b.thigh.rKnee, b.thigh.rKnee - 0.001, b.thigh.rKnee - 0.001, 0, 0.002, 2.0],
  [0.47, 0.053, 0.050, 0.056, 0, -0.002, 2.0],
  [0.494, 0.054, 0.050, 0.060, 0, -0.004, 2.0],
  [0.506, 0.059, 0.055, 0.066, 0, -0.006, 2.0], // boot top
  [0.58, 0.060, 0.051, 0.074, 0, -0.010, 2.0], // calf
  [0.66, 0.054, 0.047, 0.064, 0, -0.010, 2.0],
  [0.74, 0.046, 0.043, 0.050, 0, -0.006, 2.0],
  [0.80, b.shank.rAnkle + 0.009, 0.041, 0.045, 0, -0.003, 2.0],
  [0.84, 0.038, 0.037, 0.040, 0, 0, 2.0], // inside the boot foot
];
// right arm, s down from the shoulder joint, U outward, V forward (thumbs forward): the sleeve, then the bare wrist
const armRows = () => [
  [-0.015, 0.047, 0.047, 0.047, 0, 0, 2.0],
  [0.02, 0.053, 0.050, 0.050, 0.004, 0, 2.0], // deltoid
  [0.07, 0.050, 0.047, 0.047, 0.004, 0, 2.0],
  [0.13, 0.044, 0.046, 0.044, 0.002, 0.002, 2.0], // biceps
  [0.2, 0.041, 0.043, 0.042, 0, 0.001, 2.0],
  [0.26, 0.039, 0.039, 0.040, 0, 0, 2.0],
  [0.3, 0.038, 0.035, 0.042, 0, -0.002, 2.0], // elbow
  [0.35, 0.037, 0.043, 0.040, 0, 0.001, 2.0], // forearm, wide front to back with the thumb forward
  [0.42, 0.033, 0.037, 0.035, 0, 0, 2.0],
  [0.488, 0.029, 0.033, 0.031, 0, 0, 2.0],
  [0.51, 0.029, 0.033, 0.031, 0, 0, 2.0], // sleeve end
  [0.522, 0.020, 0.027, 0.026, 0, 0, 2.0], // wrist
  [0.56, 0.019, 0.026, 0.025, 0, 0, 2.0],
];
// head, s up from the head centre: an egg with a jaw so the facing reads, no features
const HEAD = [
  [-0.104, 0.024, 0.018, 0.018, 0, 0.058, 2.0],
  [-0.092, 0.042, 0.032, 0.034, 0, 0.046, 2.0],
  [-0.074, 0.057, 0.052, 0.055, 0, 0.028, 2.0],
  [-0.048, 0.066, 0.072, 0.068, 0, 0.013, 2.1],
  [-0.018, 0.071, 0.085, 0.082, 0, 0.004, 2.2],
  [0.012, 0.075, 0.088, 0.093, 0, 0, 2.2],
  [0.042, 0.075, 0.085, 0.097, 0, -0.004, 2.2],
  [0.07, 0.068, 0.072, 0.091, 0, -0.008, 2.15],
  [0.09, 0.054, 0.054, 0.072, 0, -0.010, 2.1],
];
// the fist round the grip, in the hand frame: s up the canted grip axis, U across the palm (z), V toward the fingers
const FIST = [
  [-0.044, 0.024, 0.026, 0.022, 0, 0.004, 2.3],
  [-0.026, 0.028, 0.034, 0.028, 0, 0.004, 2.4],
  [0, 0.030, 0.038, 0.032, 0, 0.002, 2.5],
  [0.022, 0.030, 0.038, 0.034, 0, 0, 2.5],
  [0.036, 0.028, 0.032, 0.034, 0, -0.004, 2.3],
];
// boot foot and sole, s forward from the ankle: [z, half width, top, bottom]
const FOOT = [[-0.062, 0.034, -0.84, -0.893], [-0.045, 0.042, -0.805, -0.894], [0, 0.047, -0.792, -0.895], [0.045, 0.048, -0.815, -0.896], [0.09, 0.05, -0.846, -0.896], [0.14, 0.051, -0.864, -0.896], [0.172, 0.046, -0.87, -0.896], [0.188, 0.038, -0.874, -0.896]];
const SOLE = [[-0.066, 0.037, -0.886, -0.91], [-0.04, 0.046, -0.886, -0.91], [-0.012, 0.047, -0.887, -0.909], [0.02, 0.045, -0.892, -0.9], [0.06, 0.052, -0.893, -0.91], [0.14, 0.055, -0.893, -0.91], [0.18, 0.049, -0.893, -0.91], [0.196, 0.04, -0.893, -0.909]];
const footRows = (T, n) => T.map(([z, w, top, bot]) => [z, w, (top - bot) / 2, (top - bot) / 2, 0, (top + bot) / 2, n]);

// the uniform and harness numbers
const U = {
  hem: 0.172, // jacket hem, cropped just above the girdle (0.10-0.16)
  jacket: 0.0055, // jacket thickness over the shirt
  jacketTop: 0.58,
  bootTop: 0.5,
  sleeveEnd: 0.516,
  neckSkin: 0.556, // the shirt gives way to skin under the collar
  strapT: 0.003, // strap thickness
  gap: 0.001, // strap clear of the cloth
  lift: 0.0036, // the upper strap where two cross
  cuffGap: 0.0011,
  cuffH0: 0.0028, // deflated bladder
};
// opening half-angle of the jacket front against height (open V at the collar, nearly closed at the sternum)
const OPEN = [[U.hem, 28], [0.24, 20], [0.33, 13], [0.44, 14], [0.52, 22], [U.jacketTop, 34]];
const openAt = (y) => {
  if (y <= OPEN[0][0]) return OPEN[0][1] * deg;
  for (let i = 0; i < OPEN.length - 1; i++) if (y <= OPEN[i + 1][0]) return lerp(OPEN[i][1], OPEN[i + 1][1], (y - OPEN[i][0]) / (OPEN[i + 1][0] - OPEN[i][0])) * deg;
  return OPEN[OPEN.length - 1][1] * deg;
};

// anti-G bladders: region, axial range, angular range (deg, 0 = front, 90 = outward / right), band pinch lines, swell (m)
const CUFFS = [
  {reg: 'T', a0: -0.025, a1: 0.096, b0: -48, b1: 48, pinch: [], dh: 0.016},
  ...['R', 'L'].flatMap((r) => [
    {reg: r, a0: 0.088, a1: 0.292, b0: -78, b1: 78, pinch: [0.12, 0.26], dh: 0.014},
    {reg: r, a0: 0.535, a1: 0.695, b0: 112, b1: 248, pinch: [0.615], dh: 0.012},
  ]),
];

// the straps: g = load-share group (0 pelvic 1.0, 1 flank 0.65, 2 chest and shoulders 0.4, 3 legs 0.3; after the
// DGUV/IFA finding that the sub-pelvic and thigh straps carry most of a harness load, research/human.md 8.2).
// pts in region coords: ['T', y, theta] on the torso, ['R'|'L', s, phi] on a leg, angles continuous along a strap
// (they interpolate linearly: round the back is 180 -> 206, never 180 -> -154). mirror: also build x -> -x.
// lift: crossing points where this strap rides over another; ends: lift at its start/end (it lands on a band).
const SHARE = [1.0, 0.65, 0.4, 0.3];
const STRAPS = [
  {g: 2, w: 0.034, pts: [['T', 0.4, -150], ['T', 0.4, -90], ['T', 0.4, -40], ['T', 0.4, 0], ['T', 0.4, 40], ['T', 0.4, 90], ['T', 0.4, 150]]},
  {g: 2, w: 0.038, mirror: true, ends: [1, 0], liftR: [['T', 0.468, 180]], pts: [['T', 0.404, 31], ['T', 0.47, 34], ['T', 0.525, 50], ['T', 0.566, 86], ['T', 0.53, 122], ['T', 0.492, 154], ['T', 0.468, 180], ['T', 0.43, 206], ['T', 0.37, 218]]},
  {g: 1, w: 0.034, mirror: true, ends: [1, 0], pts: [['T', 0.396, 31], ['T', 0.33, 40], ['T', 0.25, 53], ['T', 0.19, 62], ['T', 0.152, 66]]},
  {g: 0, w: 0.034, mirror: true, ends: [0, 1], liftR: [['T', -0.016, 0]], pts: [['T', 0.098, 46], ['T', 0.05, 31], ['T', 0.005, 12], ['T', -0.022, -4], ['L', 0.075, -40], ['L', 0.12, -34]]},
  // the buttock X ends on the seat strap; the seat strap runs girdle to girdle under the buttocks (a saddle, as in a
  // parachute harness), both on the pelvis, so a hip flexion never drags them through the thighs
  {g: 0, w: 0.036, mirror: true, ends: [0, 1], liftR: [['T', -0.066, 180]], pts: [['T', 0.098, 128], ['T', 0.03, 150], ['T', -0.04, 172], ['T', -0.066, 180], ['T', -0.088, 194], ['T', -0.1, 208]]},
  {g: 0, w: 0.045, pts: [['T', 0.098, 112], ['T', 0.03, 128], ['T', -0.06, 148], ['T', -0.1, 164], ['T', -0.11, 180], ['T', -0.1, 196], ['T', -0.06, 212], ['T', 0.03, 232], ['T', 0.098, 248]]},
  {g: 0, w: 0.03, mirror: true, ends: [0, 1], lift: [['R', 0.12, 42]], pts: [['T', 0.098, 60], ['R', 0.05, 48], ['R', 0.12, 42], ['R', 0.26, 38]]},
  {g: 0, w: 0.03, mirror: true, ends: [1, 1], pts: [['R', 0.12, 180], ['R', 0.26, 180]]},
  {g: 3, w: 0.026, mirror: true, ends: [1, 1], pts: [['R', 0.26, 86], ['R', 0.43, 92], ['R', 0.615, 96]]},
  {g: 3, w: 0.026, mirror: true, ends: [1, 1], pts: [['R', 0.26, -84], ['R', 0.43, -90], ['R', 0.615, -96]]},
  {g: 3, w: 0.024, mirror: true, ends: [1, 1], liftR: [['R', 0.705, 0]], pts: [['R', 0.615, 96], ['R', 0.70, 30], ['R', 0.80, -45]]},
  {g: 3, w: 0.024, mirror: true, ends: [1, 1], pts: [['R', 0.615, -96], ['R', 0.70, -30], ['R', 0.80, 45]]},
];
// bands round the legs: [s, width, group]
const BANDS = [[0.12, 0.04, 0], [0.26, 0.04, 0], [0.615, 0.03, 3], [0.8, 0.026, 3]];
// buckles: [region, a, b (deg), width across, length along]
const BUCKLES = [
  ['T', 0.4, 0, 0.05, 0.04],
  ['T', 0.4, 31, 0.046, 0.034],
  ['T', 0.4, -31, 0.046, 0.034],
  ...['R', 'L'].flatMap((r) => [[r, 0.12, 22, 0.048, 0.03], [r, 0.26, 22, 0.048, 0.03], [r, 0.615, 62, 0.036, 0.024], [r, 0.8, 58, 0.032, 0.022]]),
];

// ------------------------------------------------------------ build-time geometry helpers
/** Monotone cubic (Fritsch-Carlson) through rows [[s, v1, v2, ...]]: f(s) -> [v1, v2, ...], never overshooting. */
function profile(rows) {
  const n = rows.length;
  const m = rows[0].length - 1;
  const xs = rows.map((r) => r[0]);
  const ys = [];
  const ts = [];
  for (let j = 0; j < m; j++) {
    const y = rows.map((r) => r[j + 1]);
    const d = [];
    for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (xs[i + 1] - xs[i]));
    const t = y.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(d[i]) < 1e-12) {
        t[i] = 0;
        t[i + 1] = 0;
        continue;
      }
      const a = t[i] / d[i];
      const c = t[i + 1] / d[i];
      const h = a * a + c * c;
      if (h > 9) {
        const k = 3 / Math.sqrt(h);
        t[i] = k * a * d[i];
        t[i + 1] = k * c * d[i];
      }
    }
    ys.push(y);
    ts.push(t);
  }
  return (s) => {
    let i = 0;
    if (s >= xs[n - 1]) i = n - 2;
    else while (i < n - 2 && s > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const u = clamp01((s - xs[i]) / h);
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const out = new Array(m);
    for (let j = 0; j < m; j++) out[j] = h00 * ys[j][i] + h10 * h * ts[j][i] + h01 * ys[j][i + 1] + h11 * h * ts[j][i + 1];
    return out;
  };
}

/** Rows of a half-ellipsoid cap closing a table: `len` beyond its first (dir -1) or last (dir +1) row. */
function withCaps(rows, lenA, lenB, k = 7) {
  const cap = (row, len, dir) => {
    const out = [];
    for (let i = 1; i <= k; i++) {
      const a = (i / (k + 1)) * (Math.PI / 2);
      const c = Math.cos(a);
      out.push([row[0] + dir * len * Math.sin(a), row[1] * c, row[2] * c, row[3] * c, row[4], row[5], row[6]]);
    }
    return dir > 0 ? out : out.reverse();
  };
  const first = rows[0];
  const last = rows[rows.length - 1];
  return {rows: [...cap(first, lenA, -1), ...rows, ...cap(last, lenB, 1)], poles: [first[0] - lenA, last[0] + lenB]};
}

/**
 * A loft: point(s, th) = O + s A + (cx + rx X(th)) U + (cz + rz(th) Z(th)) V, th = 0 toward +V, 90 deg toward +U.
 * Also its outward normal, the inverse (a point to section coordinates) and a radial push-out for straps.
 */
function makeLoft({rows, poles}, O, A, U2, V) {
  const f = profile(rows);
  const s0 = rows[0][0];
  const s1 = rows[rows.length - 1][0];
  const hand = Math.sign(new V3().crossVectors(U2, A).dot(V));
  const ring = (s) => f(clamp(s, s0, s1));
  const at = (s, th, out = new V3()) => {
    const [rx, rzF, rzB, cx, cz, n] = ring(s);
    const sn = Math.sin(th);
    const cs = Math.cos(th);
    const e = 2 / n;
    const X = Math.sign(sn) * Math.abs(sn) ** e;
    const Z = Math.sign(cs) * Math.abs(cs) ** e;
    const rz = rzB + (rzF - rzB) * sstep(-0.35, 0.35, cs);
    return out.copy(O).addScaledVector(A, s).addScaledVector(U2, cx + rx * X).addScaledVector(V, cz + rz * Z);
  };
  const center = (s) => {
    const [, , , cx, cz] = ring(s);
    return O.clone().addScaledVector(A, s).addScaledVector(U2, cx).addScaledVector(V, cz);
  };
  const ta = new V3();
  const tb = new V3();
  const normal = (s, th, out = new V3()) => {
    const h = 6e-4;
    const ps = at(Math.min(s1, s + h), th, ta).sub(at(Math.max(s0, s - h), th, tb)).clone();
    at(s, th + h, ta).sub(at(s, th - h, tb));
    return out.crossVectors(ta, ps).multiplyScalar(hand).normalize();
  };
  // a point to section coordinates: s, (u, v) from the centre, the scale lam that puts it on the surface, th
  const local = (p) => {
    const d = new V3().subVectors(p, O);
    const s = d.dot(A);
    const [rx, rzF, rzB, cx, cz, n] = ring(s);
    const u = d.dot(U2) - cx;
    const v = d.dot(V) - cz;
    const rr = Math.hypot(u, v) || 1e-9;
    const rz = rzB + (rzF - rzB) * sstep(-0.35, 0.35, v / rr);
    const F = Math.abs(u / rx) ** n + Math.abs(v / rz) ** n;
    const lam = F > 1e-12 ? F ** (-1 / n) : 1e6;
    const us = (u * lam) / rx;
    const vs = (v * lam) / rz;
    const th = Math.atan2(Math.sign(us) * Math.abs(us) ** (n / 2), Math.sign(vs) * Math.abs(vs) ** (n / 2));
    return {s, u, v, rr, lam, th, inRange: s > s0 && s < s1};
  };
  // push p out radially (in its section) until it clears the surface by `off`
  const push = (p, off) => {
    const L = local(p);
    if (!L.inRange) return false;
    const surf = L.rr * L.lam;
    if (L.rr >= surf + off) return false;
    const k = (surf + off) / L.rr - 1;
    p.addScaledVector(U2, L.u * k).addScaledVector(V, L.v * k);
    return true;
  };
  return {rows, poles, s0, s1, at, normal, center, local, push, hand, O, A, U: U2, V};
}

// a piece: flat arrays of positions, normals, per-vertex weights ([[bone, w]...]), optional morph deltas, triangles with tags
const newPiece = () => ({P: [], N: [], W: [], M: null, MN: null, T: [], G: []});
const addV = (pc, p, w = null) => {
  pc.P.push(p.x, p.y, p.z);
  pc.W.push(w);
  return pc.P.length / 3 - 1;
};
const addT = (pc, a, b, c, tag, flip = false) => {
  if (flip) pc.T.push(a, c, b);
  else pc.T.push(a, b, c);
  pc.G.push(tag);
};
/** Area-weighted vertex normals from a piece's triangles (or any flat position array). */
function normalsOf(P, T) {
  const N = new Array(P.length).fill(0);
  const a = new V3();
  const b = new V3();
  const c = new V3();
  for (let t = 0; t < T.length; t += 3) {
    const i = T[t] * 3;
    const j = T[t + 1] * 3;
    const k = T[t + 2] * 3;
    a.set(P[j] - P[i], P[j + 1] - P[i + 1], P[j + 2] - P[i + 2]);
    b.set(P[k] - P[i], P[k + 1] - P[i + 1], P[k + 2] - P[i + 2]);
    c.crossVectors(a, b);
    for (const v of [i, j, k]) {
      N[v] += c.x;
      N[v + 1] += c.y;
      N[v + 2] += c.z;
    }
  }
  for (let v = 0; v < N.length; v += 3) {
    const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1;
    N[v] /= l;
    N[v + 1] /= l;
    N[v + 2] /= l;
  }
  return N;
}
/** Sample s over a table: every key row, and between keys every `ds` (at least 2 steps). */
function sampleS(rows, ds) {
  const out = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i][0];
    const b = rows[i + 1][0];
    const k = Math.max(2, Math.ceil((b - a) / ds));
    for (let j = 0; j < k; j++) out.push(a + ((b - a) * j) / k);
  }
  out.push(rows[rows.length - 1][0]);
  return out;
}
/** A closed loft as a piece: N columns round, rings every ds, pole fans at both ends; tagOf(s) picks the material. */
function loftPiece(lf, {N = 40, ds = 0.008, wfn, tagOf = () => 0}) {
  const pc = newPiece();
  const ss = sampleS(lf.rows, ds);
  const rings = [];
  const p = new V3();
  for (const s of ss) {
    const ring = [];
    for (let j = 0; j < N; j++) ring.push(addV(pc, lf.at(s, (j / N) * Math.PI * 2, p)));
    rings.push(ring);
  }
  const pa = addV(pc, lf.center(lf.poles[0]));
  const pb = addV(pc, lf.center(lf.poles[1]));
  const flip = lf.hand < 0;
  for (let i = 0; i < rings.length - 1; i++) {
    const tag = tagOf((ss[i] + ss[i + 1]) / 2);
    for (let j = 0; j < N; j++) {
      const j1 = (j + 1) % N;
      addT(pc, rings[i][j], rings[i][j1], rings[i + 1][j], tag, flip);
      addT(pc, rings[i][j1], rings[i + 1][j1], rings[i + 1][j], tag, flip);
    }
  }
  const last = rings[rings.length - 1];
  for (let j = 0; j < N; j++) {
    const j1 = (j + 1) % N;
    addT(pc, pa, rings[0][j1], rings[0][j], tagOf(ss[0]), flip);
    addT(pc, last[j], last[j1], pb, tagOf(ss[ss.length - 1]), flip);
  }
  pc.N = normalsOf(pc.P, pc.T);
  for (let v = 0; v < pc.W.length; v++) pc.W[v] = wfn(p.fromArray(pc.P, v * 3));
  return pc;
}
/** A three.js geometry as a rigid piece on one weight set, transformed by matrix m. */
function geoPiece(geo, m, w, tag = 0) {
  const g = geo;
  const pos = g.attributes.position;
  if (!g.attributes.normal) g.computeVertexNormals();
  const nor = g.attributes.normal;
  const pc = newPiece();
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const p = new V3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m);
    addV(pc, p, w);
    p.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    pc.N.push(p.x, p.y, p.z);
  }
  const n = g.index ? g.index.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const a = g.index ? g.index.getX(t) : t;
    const b = g.index ? g.index.getX(t + 1) : t + 1;
    const c = g.index ? g.index.getX(t + 2) : t + 2;
    addT(pc, a, b, c, tag);
  }
  return pc;
}

// an accumulator per mesh: copied vertices (remapped per piece), 4 skin influences, optional morph target
class Acc {
  constructor(morph = false) {
    this.P = [];
    this.N = [];
    this.SI = [];
    this.SW = [];
    this.M = morph ? [] : null;
    this.MN = morph ? [] : null;
    this.T = [];
  }
  vertex(pc, v) {
    this.P.push(pc.P[v * 3], pc.P[v * 3 + 1], pc.P[v * 3 + 2]);
    this.N.push(pc.N[v * 3], pc.N[v * 3 + 1], pc.N[v * 3 + 2]);
    const w = (pc.W[v] || [[0, 1]]).slice().sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = w.reduce((a, x) => a + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.SI.push(w[k] ? w[k][0] : 0);
      this.SW.push(w[k] ? w[k][1] / sum : 0);
    }
    if (this.M) {
      for (let k = 0; k < 3; k++) {
        this.M.push(pc.M ? pc.M[v * 3 + k] : 0);
        this.MN.push(pc.MN ? pc.MN[v * 3 + k] : 0);
      }
    }
    return this.P.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    if (this.M) {
      g.morphAttributes.position = [new THREE.Float32BufferAttribute(this.M, 3)];
      g.morphAttributes.normal = [new THREE.Float32BufferAttribute(this.MN, 3)];
      g.morphTargetsRelative = true;
    }
    g.setIndex(this.T);
    if (this.groups) for (const [s, c, m] of this.groups) g.addGroup(s, c, m);
    g.computeBoundingSphere();
    return g;
  }
}
/** Copy a piece's triangles into accumulators by tag (accs[tag]; a missing acc drops those triangles). */
function emit(pc, accs) {
  const maps = new Map();
  for (let t = 0; t < pc.G.length; t++) {
    const acc = accs[pc.G[t]];
    if (!acc) continue;
    let mp = maps.get(acc);
    if (!mp) maps.set(acc, (mp = new Map()));
    for (let k = 0; k < 3; k++) {
      const v = pc.T[t * 3 + k];
      let nv = mp.get(v);
      if (nv === undefined) mp.set(v, (nv = acc.vertex(pc, v)));
      acc.T.push(nv);
    }
  }
}
/** A tube of radius r along a polyline with outward normals; closed loops wrap; weights per path point. */
function tubePiece(path, nrm, r, closed, wts, seg = 8) {
  const pc = newPiece();
  const n = path.length;
  const t = new V3();
  const nn = new V3();
  const bn = new V3();
  const p = new V3();
  for (let i = 0; i < n; i++) {
    const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    t.subVectors(b, a).normalize();
    nn.copy(nrm[i]).addScaledVector(t, -nrm[i].dot(t)).normalize();
    bn.crossVectors(t, nn);
    for (let k = 0; k < seg; k++) {
      const a2 = (k / seg) * Math.PI * 2;
      p.copy(path[i]).addScaledVector(nn, r * Math.cos(a2)).addScaledVector(bn, r * Math.sin(a2));
      addV(pc, p, wts[i]);
    }
  }
  const rows = closed ? n : n - 1;
  for (let i = 0; i < rows; i++) {
    const i1 = (i + 1) % n;
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      addT(pc, i * seg + k, i1 * seg + k, i * seg + k1, 0);
      addT(pc, i * seg + k1, i1 * seg + k, i1 * seg + k1, 0);
    }
  }
  pc.N = normalsOf(pc.P, pc.T);
  // make sure the tube faces out (the winding depends on the path's direction)
  const c0 = new V3().fromArray(pc.P, 0);
  if (new V3().fromArray(pc.N, 0).dot(c0.sub(path[0])) < 0) {
    for (let i = 0; i < pc.T.length; i += 3) [pc.T[i + 1], pc.T[i + 2]] = [pc.T[i + 2], pc.T[i + 1]];
    pc.N = pc.N.map((x) => -x);
  }
  return pc;
}

// ------------------------------------------------------------ skin weights
// a chain of bones along one coordinate: smooth hand-overs at [centre, half-width] between consecutive bones
function chainW(x, bones, edges) {
  const out = [];
  let prev = 1;
  for (let i = 0; i < edges.length; i++) {
    const s = sstep(edges[i][0] - edges[i][1], edges[i][0] + edges[i][1], x);
    if (prev - s > 1e-4) out.push([bones[i], prev - s]);
    prev = s;
  }
  if (prev > 1e-4) out.push([bones[bones.length - 1], prev]);
  return out;
}
const blendW = (wa, wb, k) => {
  const m = new Map();
  for (const [b, w] of wa) m.set(b, (m.get(b) || 0) + w * (1 - k));
  for (const [b, w] of wb) m.set(b, (m.get(b) || 0) + w * k);
  return [...m].filter(([, w]) => w > 1e-4);
};

// ------------------------------------------------------------ the ghost shell, skinned (normals follow the pose)
const GHOST_SKIN_VERT = /* glsl */ `varying vec3 vN; varying vec3 vV;
  #include <common>
  #include <skinning_pars_vertex>
  void main(){
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
    vN = normalize(normalMatrix * objectNormal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;

// ------------------------------------------------------------ the five stances (right side; the left mirrors x)
// joint angles in degrees: sp/ch spine and chest flexion, cl clavicle elevation, hf/ha/hr hip flexion/abduction/external
// rotation, kn knee flexion, an ankle (+ toes down). Arms: grip target, blade direction, pistol-up hint, elbow pole.
// The spine stays nearly straight because the rig's back plate is rigid on the pelvis.
const STANCES = [
  {sp: 0, ch: 1, cl: 0, hf: 5, ha: 1.5, hr: 4, kn: 9, an: -4, hand: [0.305, 0.03, -0.035], blade: [0.18, -0.6, -0.78], up: [0.1, 0, 1], pole: [0.6, 0, -1]},
  {sp: 1.5, ch: 2, cl: 2, hf: 78, ha: 0, hr: 6, kn: 62, an: 18, hand: [0.3, 0.07, 0.1], blade: [0.22, -0.5, -0.84], up: [0.1, 0.2, 1], pole: [0.7, -0.2, -0.7]},
  {sp: 0, ch: -1, cl: 0, hf: -4, ha: -2, hr: 0, kn: 5, an: 35, hand: [0.3, -0.01, -0.085], blade: [0.15, -0.72, -0.68], up: [0.1, 0, 1], pole: [0.5, 0, -1]},
  {sp: 0, ch: 0, cl: 12, hf: 10, ha: -2, hr: 0, kn: 18, an: 20}, // cut: the arms are solved in update (spin direction)
  {sp: 3, ch: 3, cl: 4, hf: 55, ha: 4, hr: 6, kn: 75, an: -20, hand: [0.33, 0.2, 0.3], blade: [0.45, -0.45, 0.77], up: [0, 1, 0], pole: [0.7, -0.7, -0.2]},
];
// attack-ready (S.pose.arms = 1): wings back, blades level and trailing behind the shoulders
const ATTACK = {cl: 6, hand: [0.53, 0.27, -0.34], blade: [0.55, 0.05, -0.83], up: [0, 1, 0], pole: [0.3, -1, 0.5]};
// the cut: blades out, swept back against the spin by CUT.sweep (a trailing draw cut, edges leading), tips on the
// cutR circle at shoulder height; arms abducted ~78 deg, swept toward the leading side by CUT.lead
const CUT = {sweep: 30 * deg, lead: 28 * deg, rise: 6 * deg, idleLead: -15 * deg, idleR: 1.52, omegaFull: 3};

export function buildRider(P) {
  const b = P.body;
  const J = restJoints(b);
  const TIP = new V3(0.03 + P.blade.len, 0.07, 0); // blade tip in the hand frame (root at +0.03, +0.07)
  const GRIP = b.gripFromWrist;
  const WH = new V3(-0.951 * GRIP, 0.309 * GRIP, 0); // the wrist joint in the hand frame: behind the fist, toward the thumb

  // ---------------------------------------------------------------- skeleton
  const root = new THREE.Group();
  root.name = 'rider';
  const bone = {};
  const bones = BONES.map((name) => {
    const bn = new THREE.Bone();
    bn.name = name;
    bone[name] = bn;
    return bn;
  });
  for (const name of BONES) {
    const p = J[name];
    const par = PARENT[name];
    if (par) {
      const q = J[par];
      bone[name].position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      bone[par].add(bone[name]);
    } else root.add(bone[name]);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const pelvis = bone.pelvis;

  // the hand frames: grip centre, x along the blade, y pistol-up; in the wrist bone x = -y, y = +z (thumb forward), z = -x
  const C = new Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V3(0, -1, 0), new V3(0, 0, 1), new V3(-1, 0, 0)));
  const Cinv = C.clone().invert();
  const handOff = WH.clone().negate().applyQuaternion(C); // grip centre in the wrist bone
  const hands = {};
  for (const s of ['R', 'L']) {
    const h = new THREE.Object3D();
    h.name = 'hand' + s;
    h.position.copy(handOff);
    h.quaternion.copy(C);
    bone['wr' + s].add(h);
    hands[s] = h;
  }
  const handRest = (sx) => new THREE.Matrix4().compose(new V3(...J[sx > 0 ? 'wrR' : 'wrL']).add(handOff), C, new V3(1, 1, 1));

  // ---------------------------------------------------------------- lofts and their weights
  const X = new V3(1, 0, 0);
  const Y = new V3(0, 1, 0);
  const Z = new V3(0, 0, 1);
  const NY = new V3(0, -1, 0);
  const NX = new V3(-1, 0, 0);
  const torso = makeLoft(withCaps(torsoRows(b), 0.014, 0.03), new V3(), Y, X, Z);
  const legs = {R: makeLoft(withCaps(legRows(b), 0.055, 0.03), new V3(b.hipX, 0, 0), NY, X, Z), L: makeLoft(withCaps(legRows(b), 0.055, 0.03), new V3(-b.hipX, 0, 0), NY, NX, Z)};
  const arms = {R: makeLoft(withCaps(armRows(), 0.03, 0.025), new V3(...J.shR), NY, X, Z), L: makeLoft(withCaps(armRows(), 0.03, 0.025), new V3(...J.shL), NY, NX, Z)};
  const headLf = makeLoft(withCaps(HEAD, 0.012, 0.025), new V3(0, b.head.y, 0.01), Y, X, Z);

  const torsoW = (p) => {
    const w = chainW(p.y, [B.pelvis, B.spine, B.chest, B.neck, B.head], [[0.17, 0.05], [0.3, 0.06], [0.575, 0.018], [0.66, 0.02]]);
    // the shoulder tops follow the clavicles
    const c = sstep(0.085, 0.165, Math.abs(p.x)) * sstep(0.43, 0.5, p.y) * 0.9;
    const ci = w.findIndex(([bn]) => bn === B.chest);
    if (c > 0 && ci >= 0) {
      const wc = w[ci][1];
      w[ci][1] = wc * (1 - c);
      w.push([p.x > 0 ? B.clavR : B.clavL, wc * c]);
    }
    return w;
  };
  const legW = (sx) => (p) => chainW(-p.y, sx > 0 ? [B.hipR, B.kneeR, B.ankR] : [B.hipL, B.kneeL, B.ankL], [[b.thigh.len, 0.035], [b.thigh.len + b.shank.len, 0.025]]);
  const armW = (sx) => (p) => chainW(b.shoulder.y - p.y, sx > 0 ? [B.shR, B.elR, B.wrR] : [B.shL, B.elL, B.wrL], [[b.upperArm, 0.03], [b.upperArm + b.forearm, 0.015]]);
  const one = (bn) => () => [[bn, 1]];
  const REG = {T: {lf: torso, w: torsoW}, R: {lf: legs.R, w: legW(1)}, L: {lf: legs.L, w: legW(-1)}};

  // ---------------------------------------------------------------- mesh accumulators
  const acc = {
    trousers: new Acc(), // torso (shirt and trousers), legs to the boot top, knee balls
    suit: new Acc(), // sleeves, elbow balls
    skin: new Acc(), // neck, head, wrists, mitts
    leather: new Acc(), // boot shafts and feet
    jacket: new Acc(), // the jacket shell, collar and edge rolls (no ghost of their own)
    rims: new Acc(), // boot top rims
    soles: new Acc(),
    knees: new Acc(), // joint fillers: inside the limb when straight, so they get no ghost
    elbows: new Acc(),
    straps: [0, 1, 2, 3].map(() => new Acc(true)),
    cuffs: new Acc(true),
    metal: new Acc(true),
  };

  // torso: shirt / trousers below the collar, skin above
  emit(loftPiece(torso, {N: 48, ds: 0.008, wfn: torsoW, tagOf: (s) => (s > U.neckSkin ? 1 : 0)}), [acc.trousers, acc.skin]);
  for (const [s, sx] of [['R', 1], ['L', -1]]) {
    emit(loftPiece(legs[s], {N: 40, ds: 0.008, wfn: legW(sx), tagOf: (t) => (t > U.bootTop ? 1 : 0)}), [acc.trousers, acc.leather]);
    emit(loftPiece(arms[s], {N: 32, ds: 0.007, wfn: armW(sx), tagOf: (t) => (t > U.sleeveEnd ? 1 : 0)}), [acc.suit, acc.skin]);
    // joint balls fill what linear skinning shaves off a deep knee or elbow bend
    const knee = new THREE.SphereGeometry(1, 24, 16).scale(b.thigh.rKnee - 0.004, b.thigh.rKnee - 0.004, b.thigh.rKnee - 0.006);
    emit(geoPiece(knee, new THREE.Matrix4().makeTranslation(...J['knee' + s]), [[B['knee' + s], 1]]), [acc.knees]);
    const elbow = new THREE.SphereGeometry(1, 20, 14).scale(0.034, 0.034, 0.033);
    emit(geoPiece(elbow, new THREE.Matrix4().makeTranslation(...J['el' + s]), [[B['el' + s], 1]]), [acc.elbows]);
    // the boot foot and its sole, rigid on the ankle
    const foot = makeLoft(withCaps(footRows(FOOT, 2.6), 0.008, 0.016), new V3(sx * b.hipX, 0, 0), Z, sx > 0 ? X : NX, Y);
    emit(loftPiece(foot, {N: 32, ds: 0.01, wfn: one(B['ank' + s])}), [acc.leather]);
    const sole = makeLoft(withCaps(footRows(SOLE, 4), 0.006, 0.01), new V3(sx * b.hipX, 0, 0), Z, sx > 0 ? X : NX, Y);
    emit(loftPiece(sole, {N: 32, ds: 0.01, wfn: one(B['ank' + s])}), [acc.soles]);
    // the mitt: a fist round the canted grip, the back of the hand to the wrist, the thumb over the side
    const hm = handRest(sx);
    const cant = P.handle.cant;
    const fist = makeLoft(withCaps(FIST, 0.014, 0.014), new V3(), new V3(Math.sin(cant), Math.cos(cant), 0), Z, new V3(Math.cos(cant), -Math.sin(cant), 0));
    const fp = loftPiece(fist, {N: 28, ds: 0.006, wfn: one(B['wr' + s])});
    for (let v = 0; v < fp.P.length; v += 3) {
      const q = new V3().fromArray(fp.P, v).applyMatrix4(hm);
      fp.P[v] = q.x;
      fp.P[v + 1] = q.y;
      fp.P[v + 2] = q.z;
    }
    fp.N = normalsOf(fp.P, fp.T);
    emit(fp, [acc.skin]);
    const back = new THREE.SphereGeometry(1, 20, 14).scale(0.044, 0.03, 0.026).translate(-0.042, 0.02, 0);
    emit(geoPiece(back, hm, [[B['wr' + s], 1]]), [acc.skin]);
    const tA = new V3(-0.02, 0.04, -sx * 0.019);
    const tB = new V3(0.022, 0.032, -sx * 0.024);
    const thumb = new THREE.CapsuleGeometry(0.0105, tA.distanceTo(tB), 4, 12);
    const tm = new THREE.Matrix4().compose(tA.clone().add(tB).multiplyScalar(0.5), new Q().setFromUnitVectors(Y, tB.clone().sub(tA).normalize()), new V3(1, 1, 1));
    emit(geoPiece(thumb, hm.clone().multiply(tm), [[B['wr' + s], 1]]), [acc.skin]);
  }
  emit(loftPiece(headLf, {N: 40, ds: 0.007, wfn: one(B.head)}), [acc.skin]);

  // ---------------------------------------------------------------- the jacket: an open-fronted shell over the shirt, collar, edge rolls
  {
    const pc = newPiece();
    const ys = [];
    for (let y = U.hem; y < U.jacketTop - 1e-6; y += 0.007) ys.push(y);
    ys.push(U.jacketTop);
    const NC = 64;
    const p = new V3();
    const n = new V3();
    const grid = ys.map((y) => {
      const a = openAt(y);
      const row = [];
      for (let j = 0; j <= NC; j++) {
        const th = a + ((Math.PI * 2 - 2 * a) * j) / NC;
        torso.at(y, th, p);
        torso.normal(y, th, n);
        p.addScaledVector(n, U.jacket);
        row.push(addV(pc, p, torsoW(torso.at(y, th))));
      }
      return row;
    });
    for (let i = 0; i < ys.length - 1; i++) for (let j = 0; j < NC; j++) {
      addT(pc, grid[i][j], grid[i][j + 1], grid[i + 1][j], 0);
      addT(pc, grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j], 0);
    }
    pc.N = normalsOf(pc.P, pc.T);
    emit(pc, [acc.jacket]);
    // edge rolls: the hem and both lapels
    const roll = (pts) => {
      const path = [];
      const nr = [];
      const w = [];
      for (const [y, th, o] of pts) {
        const q = torso.at(y, th);
        const nn = torso.normal(y, th);
        w.push(torsoW(q));
        path.push(q.addScaledVector(nn, o));
        nr.push(nn);
      }
      return {path, nr, w};
    };
    const hem = [];
    const a0 = openAt(U.hem);
    for (let j = 0; j <= 72; j++) hem.push([U.hem, a0 + ((Math.PI * 2 - 2 * a0) * j) / 72, U.jacket + 0.0015]);
    let r = roll(hem);
    emit(tubePiece(r.path, r.nr, 0.003, false, r.w), [acc.jacket]);
    for (const sg of [1, -1]) {
      const lap = [];
      for (let y = U.hem; y <= U.jacketTop + 1e-6; y += 0.008) lap.push([y, sg > 0 ? openAt(y) : Math.PI * 2 - openAt(y), U.jacket + 0.0012]);
      r = roll(lap);
      emit(tubePiece(r.path, r.nr, 0.0026, false, r.w), [acc.jacket]);
    }
    // the stand collar round the neck, open at the front, flaring a little
    const cl = newPiece();
    const rowsC = [];
    for (let i = 0; i <= 8; i++) {
      const y = 0.552 + (0.062 * i) / 8;
      const k = i / 8;
      const row = [];
      for (let j = 0; j <= 40; j++) {
        const th = 40 * deg + ((280 * deg) * j) / 40;
        p.set(Math.sin(th) * (0.064 + 0.012 * k), y, -0.012 + Math.cos(th) * (0.062 + 0.012 * k));
        row.push(addV(cl, p, torsoW(p)));
      }
      rowsC.push(row);
    }
    for (let i = 0; i < 8; i++) for (let j = 0; j < 40; j++) {
      addT(cl, rowsC[i][j], rowsC[i][j + 1], rowsC[i + 1][j], 0);
      addT(cl, rowsC[i][j + 1], rowsC[i + 1][j + 1], rowsC[i + 1][j], 0);
    }
    cl.N = normalsOf(cl.P, cl.T);
    emit(cl, [acc.jacket]);
    const top = [];
    const tn = [];
    const tw = [];
    for (let j = 0; j <= 40; j++) {
      const th = 40 * deg + ((280 * deg) * j) / 40;
      top.push(new V3(Math.sin(th) * 0.0765, 0.614, -0.012 + Math.cos(th) * 0.0745));
      tn.push(new V3(Math.sin(th), 0, Math.cos(th)));
      tw.push(torsoW(top[j]));
    }
    emit(tubePiece(top, tn, 0.0028, false, tw), [acc.jacket]);
    // sleeve cuffs and boot top rims
    for (const [s, sx] of [['R', 1], ['L', -1]]) {
      const ring = (lf, t, off, wf) => {
        const path = [];
        const nr = [];
        const w = [];
        for (let j = 0; j < 40; j++) {
          const th = (j / 40) * Math.PI * 2;
          const nn = lf.normal(t, th);
          const q = lf.at(t, th);
          w.push(wf(q));
          path.push(q.addScaledVector(nn, off));
          nr.push(nn);
        }
        return {path, nr, w};
      };
      r = ring(arms[s], 0.508, 0.0015, armW(sx));
      emit(tubePiece(r.path, r.nr, 0.0042, true, r.w), [acc.jacket]);
      r = ring(legs[s], 0.503, 0.002, legW(sx));
      emit(tubePiece(r.path, r.nr, 0.0045, true, r.w), [acc.rims]);
    }
  }

  // ---------------------------------------------------------------- harness: cuffs, straps, buckles
  // what lies under a strap at a region point: cloth (jacket, hem roll, boot rim) and a bladder (static + per unit swell)
  const regB = (reg, b0) => (reg === 'T' ? b0 * deg : b0 * deg);
  const cloth = (reg, a) => {
    if (reg === 'T') return U.jacket * sstep(U.hem - 0.008, U.hem + 0.004, a) + 0.0058 * Math.exp(-(((a - U.hem) / 0.0055) ** 2));
    return 0.0072 * Math.exp(-(((a - 0.503) / 0.006) ** 2));
  };
  const cuffAt = (reg, a, bd) => {
    for (const c of CUFFS) {
      if (c.reg !== reg) continue;
      const u = (a - c.a0) / (c.a1 - c.a0);
      if (u < 0 || u > 1) continue;
      let bb = bd;
      while (bb < c.b0) bb += 360;
      while (bb - 360 >= c.b0) bb -= 360;
      const v = (bb - c.b0) / (c.b1 - c.b0);
      if (v < 0 || v > 1) continue;
      const ev = sstep(0, 0.14, u) * sstep(0, 0.14, 1 - u) * sstep(0, 0.1, v) * sstep(0, 0.1, 1 - v);
      let pinch = 1;
      for (const pa of c.pinch) pinch = Math.min(pinch, 1 - 0.72 * Math.exp(-(((a - pa) / 0.02) ** 2)));
      const pil = Math.sqrt(Math.max(0, Math.sin(Math.PI * u) * Math.sin(Math.PI * v)));
      return [U.cuffGap + U.cuffH0 * ev, c.dh * ev * pil * pinch];
    }
    return [0, 0];
  };

  // the bladders: pillows over the cloth, inflated by a morph target (with its own normals)
  for (const c of CUFFS) {
    const lf = REG[c.reg].lf;
    const wf = REG[c.reg].w;
    const pc = newPiece();
    const NA = 28;
    const NB = 36;
    const p = new V3();
    const n = new V3();
    const inf = [];
    const idx = [];
    for (let i = 0; i <= NA; i++) {
      const a = lerp(c.a0, c.a1, i / NA);
      const row = [];
      for (let j = 0; j <= NB; j++) {
        const bd = lerp(c.b0, c.b1, j / NB);
        lf.at(a, regB(c.reg, bd), p);
        lf.normal(a, regB(c.reg, bd), n);
        const [h0, dh] = cuffAt(c.reg, a, bd);
        const q = p.clone();
        row.push(addV(pc, p.addScaledVector(n, h0 + cloth(c.reg, a)), wf(q)));
        inf.push(n.x * dh, n.y * dh, n.z * dh);
      }
      idx.push(row);
    }
    const flip = lf.hand < 0;
    for (let i = 0; i < NA; i++) for (let j = 0; j < NB; j++) {
      addT(pc, idx[i][j], idx[i][j + 1], idx[i + 1][j], 0, flip);
      addT(pc, idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j], 0, flip);
    }
    pc.N = normalsOf(pc.P, pc.T);
    const Pin = pc.P.map((x, k) => x + inf[k]);
    const Nin = normalsOf(Pin, pc.T);
    pc.M = inf;
    pc.MN = Nin.map((x, k) => x - pc.N[k]);
    emit(pc, [acc.cuffs]);
  }

  // a region point under a strap: surface point, normal, static offset, swell, weights
  const regPoint = (reg, a, bd) => {
    const lf = REG[reg].lf;
    const s = lf.at(a, regB(reg, bd));
    const n = lf.normal(a, regB(reg, bd));
    const [h0, dh] = cuffAt(reg, a, bd);
    return {s, n, off: U.gap + cloth(reg, a) + h0, m: dh, w: REG[reg].w(s), regs: [reg]};
  };
  const catmull = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  // dense samples along a strap: Catmull-Rom in region coordinates on one surface, a pushed-out chord across regions
  const strapSamples = (spec) => {
    const pts = spec.pts;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i];
      const Bp = pts[i + 1];
      const pa = regPoint(...A);
      const pb = regPoint(...Bp);
      const k = Math.max(3, Math.ceil(pa.s.distanceTo(pb.s) / 0.006));
      for (let j = i === 0 ? 0 : 1; j <= k; j++) {
        const t = j / k;
        if (A[0] === Bp[0]) {
          const P0 = i > 0 && pts[i - 1][0] === A[0] ? pts[i - 1] : A;
          const P3 = i < pts.length - 2 && pts[i + 2][0] === A[0] ? pts[i + 2] : Bp;
          out.push(regPoint(A[0], catmull(P0[1], A[1], Bp[1], P3[1], t), catmull(P0[2], A[2], Bp[2], P3[2], t)));
        } else {
          const q = pa.s.clone().lerp(pb.s, t);
          REG[A[0]].lf.push(q, 0);
          REG[Bp[0]].lf.push(q, 0);
          const n = pa.n.clone().lerp(pb.n, t).normalize();
          // the bridge stays on the pelvis until near the leg band: a hip flexion then pulls a short taut span to
          // the band instead of dragging a blended strap through the buttock
          const kw = A[0] === 'T' ? sstep(0.5, 0.97, t) : Bp[0] === 'T' ? sstep(0.03, 0.5, t) : sstep(0.15, 0.85, t);
          out.push({s: q, n, off: lerp(pa.off, pb.off, t), m: lerp(pa.m, pb.m, t), w: blendW(REG[A[0]].w(q), REG[Bp[0]].w(q), kw), regs: [A[0], Bp[0]]});
        }
      }
    }
    return out;
  };
  // lifts where this strap rides over another, then the base line (surface + offset), smoothed and kept outside
  const finish = (smp, lifts, closed) => {
    const L = lifts.map(([r, a, bd]) => REG[r].lf.at(a, regB(r, bd)));
    for (const sm of smp) {
      let lf = 0;
      for (const c of L) lf = Math.max(lf, U.lift * Math.exp(-(sm.s.distanceToSquared(c) / (0.026 * 0.026))));
      sm.off += lf;
      sm.p = sm.s.clone().addScaledVector(sm.n, sm.off);
    }
    const n = smp.length;
    for (let pass = 0; pass < 3; pass++) {
      const P0 = smp.map((sm) => sm.p.clone());
      const N0 = smp.map((sm) => sm.n.clone());
      for (let i = 0; i < n; i++) {
        if (!closed && (i === 0 || i === n - 1)) continue;
        const a = (i - 1 + n) % n;
        const c = (i + 1) % n;
        smp[i].p.copy(P0[a]).add(P0[c]).multiplyScalar(0.25).addScaledVector(P0[i], 0.5);
        smp[i].n.copy(N0[a]).add(N0[c]).addScaledVector(N0[i], 2).normalize();
      }
      for (const sm of smp) for (const r of sm.regs) REG[r].lf.push(sm.p, sm.off);
    }
    return smp;
  };
  // the ribbon: a flat strap, top face and both edges (and end caps), all vertices of a sample on its weights
  const ribbon = (smp, width, closed) => {
    const pc = newPiece();
    pc.M = [];
    const n = smp.length;
    const t = new V3();
    const bn = new V3();
    const nn = new V3();
    const q = new V3();
    const ids = [];
    for (let i = 0; i < n; i++) {
      const sm = smp[i];
      const a = smp[closed ? (i - 1 + n) % n : Math.max(0, i - 1)].p;
      const c = smp[closed ? (i + 1) % n : Math.min(n - 1, i + 1)].p;
      t.subVectors(c, a).normalize();
      bn.crossVectors(t, sm.n).normalize();
      nn.crossVectors(bn, t).normalize();
      const hw = width / 2;
      const v = [];
      const put = (dx, dy, nor) => {
        q.copy(sm.p).addScaledVector(bn, dx).addScaledVector(nn, dy);
        v.push(addV(pc, q, sm.w));
        pc.N.push(nor.x, nor.y, nor.z);
        pc.M.push(sm.n.x * sm.m, sm.n.y * sm.m, sm.n.z * sm.m);
      };
      const nb = bn.clone().negate();
      put(-hw, U.strapT, nn); // 0 top left
      put(hw, U.strapT, nn); // 1 top right
      put(-hw, 0, nb); // 2 left bottom
      put(-hw, U.strapT, nb); // 3 left top
      put(hw, 0, bn); // 4 right bottom
      put(hw, U.strapT, bn); // 5 right top
      ids.push(v);
    }
    const rows = closed ? n : n - 1;
    for (let i = 0; i < rows; i++) {
      const A = ids[i];
      const C2 = ids[(i + 1) % n];
      addT(pc, A[0], A[1], C2[0], 0);
      addT(pc, A[1], C2[1], C2[0], 0);
      addT(pc, A[2], A[3], C2[2], 0);
      addT(pc, A[3], C2[3], C2[2], 0);
      addT(pc, A[4], C2[4], A[5], 0);
      addT(pc, A[5], C2[4], C2[5], 0);
    }
    if (!closed) {
      const s0 = ids[0];
      const s1 = ids[n - 1];
      addT(pc, s0[2], s0[4], s0[3], 0);
      addT(pc, s0[4], s0[5], s0[3], 0);
      addT(pc, s1[2], s1[3], s1[4], 0);
      addT(pc, s1[3], s1[5], s1[4], 0);
    }
    return pc;
  };
  const mirrorPt = ([r, a, bd]) => (r === 'T' ? ['T', a, -bd] : [r === 'R' ? 'L' : 'R', a, bd]);
  for (const spec of STRAPS) {
    const variants = [{pts: spec.pts, lift: [...(spec.lift || []), ...(spec.liftR || [])]}];
    if (spec.mirror) variants.push({pts: spec.pts.map(mirrorPt), lift: (spec.lift || []).map(mirrorPt)});
    for (const vr of variants) {
      const lifts = [...vr.lift];
      const ends = spec.ends || [0, 0];
      if (ends[0]) lifts.push(vr.pts[0]);
      if (ends[1]) lifts.push(vr.pts[vr.pts.length - 1]);
      const smp = finish(strapSamples({pts: vr.pts}), lifts, false);
      emit(ribbon(smp, spec.w, false), [acc.straps[spec.g]]);
    }
  }
  for (const [a, w, g] of BANDS) for (const r of ['R', 'L']) {
    const smp = [];
    for (let j = 0; j < 72; j++) smp.push(regPoint(r, a, -180 + (360 * j) / 72));
    emit(ribbon(finish(smp, [], true), w, true), [acc.straps[g]]);
  }
  // buckles: a rounded frame with a bar, flat on the strap, rigid on the strap's weights
  {
    const rr = (w, h, r) => {
      const sh = new THREE.Shape();
      sh.moveTo(-w / 2 + r, -h / 2);
      sh.lineTo(w / 2 - r, -h / 2);
      sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      sh.lineTo(w / 2, h / 2 - r);
      sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      sh.lineTo(-w / 2 + r, h / 2);
      sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      sh.lineTo(-w / 2, -h / 2 + r);
      sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      return sh;
    };
    for (const [reg, a, bd, w, h] of BUCKLES) {
      const sh = rr(w, h, 0.006);
      const hole = rr(w - 0.009, h - 0.009, 0.003);
      sh.holes.push(new THREE.Path(hole.getPoints(2)));
      const fg = new THREE.ExtrudeGeometry(sh, {depth: 0.0026, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 1, curveSegments: 2});
      const bar = new THREE.BoxGeometry(w - 0.006, 0.0032, 0.003).translate(0, 0, 0.0016);
      const rp = regPoint(reg, a, bd);
      const lf = REG[reg].lf;
      const along = lf.at(a, regB(reg, bd + 0.5)).sub(lf.at(a, regB(reg, bd - 0.5))).normalize();
      const nrm = rp.n;
      const across = new V3().crossVectors(along, nrm).normalize();
      const al = new V3().crossVectors(nrm, across);
      const pos = rp.s.clone().addScaledVector(nrm, rp.off + U.lift + U.strapT + 0.0004);
      const m = new THREE.Matrix4().makeBasis(across, al, nrm).setPosition(pos);
      // the buckle rides the swelling bladder with its band
      for (const g of [fg, bar]) {
        const pc = geoPiece(g, m, rp.w);
        pc.M = [];
        for (let v = 0; v < pc.P.length; v += 3) pc.M.push(nrm.x * rp.m, nrm.y * rp.m, nrm.z * rp.m);
        emit(pc, [acc.metal]);
      }
    }
  }

  // ---------------------------------------------------------------- materials and meshes
  const M = {
    trousers: mat('trousers'),
    suit: mat('suit'),
    skin: mat('mannequin'),
    leather: mat('leather'),
    jacket: mat('suit', {side: THREE.DoubleSide}),
    rims: mat('leather'),
    soles: mat('rubber'),
    straps: [0, 1, 2, 3].map(() => mat('webbing', {roughness: 0.62})),
    cuffs: mat('suit', {roughness: 0.5}),
    metal: mat('steel'),
  };
  const ghostMat = ghost();
  ghostMat.vertexShader = GHOST_SKIN_VERT;
  const I4 = new THREE.Matrix4();
  const skinned = (geo, m, parent) => {
    const mesh = new THREE.SkinnedMesh(geo, m);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    mesh.bind(skeleton, I4);
    return mesh;
  };
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const harness = new THREE.Group();
  harness.name = 'harness';
  root.add(harness);
  const solid = [];
  const ghosts = [];
  for (const k of ['trousers', 'suit', 'skin', 'leather']) {
    const g = acc[k].geometry();
    solid.push(skinned(g, M[k], body));
    const gm = skinned(g, ghostMat, body);
    gm.castShadow = false;
    gm.receiveShadow = false;
    gm.visible = false;
    gm.renderOrder = 2;
    ghosts.push(gm);
  }
  for (const k of ['jacket', 'rims', 'soles']) solid.push(skinned(acc[k].geometry(), M[k], body));
  solid.push(skinned(acc.knees.geometry(), M.trousers, body), skinned(acc.elbows.geometry(), M.suit, body));
  // straps: one mesh, four load-share groups
  const sAcc = new Acc(true);
  sAcc.groups = [];
  for (let g = 0; g < 4; g++) {
    const a = acc.straps[g];
    const v0 = sAcc.P.length / 3;
    const t0 = sAcc.T.length;
    for (const k of ['P', 'N', 'SI', 'SW', 'M', 'MN']) for (let i = 0; i < a[k].length; i++) sAcc[k].push(a[k][i]);
    for (let i = 0; i < a.T.length; i++) sAcc.T.push(a.T[i] + v0);
    sAcc.groups.push([t0, a.T.length, g]);
  }
  const strapMesh = skinned(sAcc.geometry(), M.straps, harness);
  const cuffMesh = skinned(acc.cuffs.geometry(), M.cuffs, harness);
  const metalMesh = skinned(acc.metal.geometry(), M.metal, harness);
  const harnessMeshes = [strapMesh, cuffMesh, metalMesh];
  const bodyMats = [M.trousers, M.suit, M.skin, M.leather, M.jacket, M.rims, M.soles];
  const harnessMats = [...M.straps, M.cuffs, M.metal];

  // ---------------------------------------------------------------- per-frame scratch (update allocates nothing)
  const ACC = new THREE.Color(HEX.accent);
  const EMPTY = {};
  const Wt = new Float64Array(5);
  const side = ['R', 'L'].map((s, i) => ({
    s,
    sx: i ? -1 : 1,
    clav: bone['clav' + s],
    sh: bone['sh' + s],
    el: bone['el' + s],
    wr: bone['wr' + s],
    hip: bone['hip' + s],
    knee: bone['knee' + s],
    ank: bone['ank' + s],
    G: new V3(),
    bx: new V3(),
    up: new V3(),
    pole: new V3(),
    S: new V3(),
    qCl: new Q(),
    qClInv: new Q(),
    hx: new V3(),
    hy: new V3(),
    hz: new V3(),
  }));
  const qChB = new Q();
  const pChB = new V3();
  const qTmp = new Q();
  const qA = new Q();
  const qB = new Q();
  const qUa = new Q();
  const qFl = new Q();
  const qW = new Q();
  const qR = new Q();
  const eul = new THREE.Euler();
  const m4 = new THREE.Matrix4();
  const vA = new V3();
  const vB = new V3();
  const vW = new V3();
  const vE = new V3();
  const vU = new V3();
  const vV = new V3();
  const vN = new V3();
  const u1 = new V3();
  const u2 = new V3();
  const vX = new V3();
  const vY = new V3();
  const vZ = new V3();
  const AXX = new V3(-1, 0, 0);
  const tmp = new V3();
  const tipOff = new V3();
  const inv4 = new THREE.Matrix4();

  const setAlpha = (m, a) => {
    const f = a < 0.999;
    if (m.transparent !== f) {
      m.transparent = f;
      m.needsUpdate = true;
    }
    m.opacity = a;
    m.depthWrite = !f || a > 0.6;
  };
  const setAccent = (m, k) => {
    m.color.copy(m.userData.base).lerp(ACC, k * 0.85);
    m.emissive.copy(ACC).multiplyScalar(k * 0.18);
  };
  const setBone = (bn, x, y, z, order) => {
    eul.set(x, y, z, order);
    bn.quaternion.setFromEuler(eul);
  };

  // the cut stance's arm for one side: blade direction, pistol-up, grip and pole from the spin (pure)
  const cutArm = (sd, e) => {
    const sx = sd.sx;
    const ae = Math.abs(e);
    // trailing side of this hand for the spin (+z for the right hand when spinning +y), zero with no spin
    const tz = sx * Math.sign(e);
    const sw = CUT.sweep * ae;
    sd.bx.set(sx * Math.cos(sw) * Math.cos(CUT.rise), Math.sin(CUT.rise), tz * Math.sin(sw) * Math.cos(CUT.rise));
    // edges leading: pistol-up toward the trailing side once spinning; thumbs up before
    sd.up.set(0, 1 - ae, tz * ae);
    if (sd.up.lengthSq() < 1e-6) sd.up.set(0, 1, 0);
    vX.copy(sd.bx).normalize();
    vY.copy(sd.up).addScaledVector(vX, -sd.up.dot(vX)).normalize();
    tipOff.copy(vX).multiplyScalar(TIP.x).addScaledVector(vY, TIP.y);
    // arm azimuth from the shoulder (positive toward +z): forward a little at rest, toward the leading side when spinning
    const gam = lerp(-CUT.idleLead, -tz * CUT.lead, ae);
    vU.set(sx * Math.cos(gam), 0, Math.sin(gam));
    // grip distance rho along vU so the tip lands on radius R from the spine axis (horizontal plane)
    const R = lerp(CUT.idleR, P.blade.cutR, ae);
    const ax = sd.S.x + tipOff.x;
    const az = sd.S.z + tipOff.z;
    const au = ax * vU.x + az * vU.z;
    const disc = au * au - (ax * ax + az * az) + R * R;
    const rho = clamp(-au + Math.sqrt(Math.max(0, disc)), 0.22, 0.62);
    sd.G.set(sd.S.x + rho * vU.x, b.shoulder.y - tipOff.y, sd.S.z + rho * vU.z);
    sd.pole.set(0, -0.6, -tz * 0.8 + (1 - ae) * -0.6);
  };

  // two-bone IK: shoulder -> elbow -> wrist onto the grip frame (sd.G, sd.hx/hy/hz)
  const solveArm = (sd) => {
    const a = b.upperArm;
    const c = b.forearm;
    vW.copy(sd.G).addScaledVector(sd.hx, WH.x).addScaledVector(sd.hy, WH.y);
    vU.subVectors(vW, sd.S);
    let d = vU.length();
    vU.divideScalar(d || 1);
    d = clamp(d, Math.abs(a - c) + 0.02, a + c - 1e-4);
    vV.copy(sd.pole).addScaledVector(vU, -sd.pole.dot(vU));
    if (vV.lengthSq() < 1e-8) vV.set(0, 0, -1).addScaledVector(vU, -vU.z);
    vV.normalize();
    const ca = clamp((a * a + d * d - c * c) / (2 * a * d), -1, 1);
    const sa = Math.sqrt(1 - ca * ca);
    vE.copy(sd.S).addScaledVector(vU, a * ca).addScaledVector(vV, a * sa);
    vW.copy(sd.S).addScaledVector(vU, d);
    u1.subVectors(vE, sd.S).divideScalar(a);
    u2.subVectors(vW, vE).divideScalar(c);
    vN.crossVectors(vV, vU).normalize(); // the elbow's flexion axis, which is local -x
    // upper arm: local -y onto u1, local -x onto vN
    vX.copy(vN).negate();
    vY.copy(u1).negate();
    vZ.crossVectors(vX, vY);
    qUa.setFromRotationMatrix(m4.makeBasis(vX, vY, vZ));
    sd.sh.quaternion.multiplyQuaternions(sd.qClInv, qUa);
    // elbow flexion, then the forearm roll that leaves the wrist only a swing
    qFl.setFromAxisAngle(AXX, Math.acos(clamp(u1.dot(u2), -1, 1)));
    qA.multiplyQuaternions(qUa, qFl); // forearm before roll (body)
    qW.setFromRotationMatrix(m4.makeBasis(sd.hx, sd.hy, sd.hz)).multiply(Cinv); // wrist bone wanted (body)
    qB.copy(qA).invert().multiply(qW); // forearm -> wrist
    qR.set(0, qB.y, 0, qB.w);
    if (qR.w < 0) qR.set(0, -qR.y, 0, -qR.w);
    qR.normalize();
    sd.el.quaternion.multiplyQuaternions(qFl, qR);
    sd.wr.quaternion.copy(qR).invert().multiply(qB);
  };

  const update = (S, D) => {
    D = D || EMPTY;
    const pose = S.pose || EMPTY;
    const pw = pose.w || EMPTY;
    root.position.fromArray(S.pos);
    root.quaternion.fromArray(S.q);
    // stance weights
    Wt[0] = pw.stand || 0;
    Wt[1] = pw.hang || 0;
    Wt[2] = pw.stream || 0;
    Wt[3] = pw.cut || 0;
    Wt[4] = pw.land || 0;
    let sum = Wt[0] + Wt[1] + Wt[2] + Wt[3] + Wt[4];
    if (sum < 1e-6) {
      Wt[0] = 1;
      sum = 1;
    }
    let sp = 0;
    let ch = 0;
    let cl = 0;
    let hf = 0;
    let ha = 0;
    let hr = 0;
    let kn = 0;
    let an = 0;
    for (let k = 0; k < 5; k++) {
      Wt[k] /= sum;
      const st = STANCES[k];
      const w = Wt[k];
      sp += w * st.sp;
      ch += w * st.ch;
      cl += w * st.cl;
      hf += w * st.hf;
      ha += w * st.ha;
      hr += w * st.hr;
      kn += w * st.kn;
      an += w * st.an;
    }
    const tuck = clamp01(pose.tuck || 0);
    // the tuck folds mostly at the knees: past ~100 deg of hip flexion the thighs would sink into the belly and the
    // seat straps into the buttocks (and the rig's fairlead rail sits in front of the hip joints)
    hf = Math.min(100, hf + 35 * tuck);
    kn = Math.min(135, kn + 80 * tuck);
    an += 12 * tuck;
    const arms = clamp01(pose.arms || 0) * (1 - Wt[3]);
    cl += arms * ATTACK.cl;

    // spine, chest, legs
    setBone(bone.spine, sp * deg, 0, 0, 'XYZ');
    setBone(bone.chest, ch * deg, 0, 0, 'XYZ');
    for (let i = 0; i < 2; i++) {
      const sd = side[i];
      setBone(sd.hip, -hf * deg, sd.sx * hr * deg, sd.sx * ha * deg, 'XZY');
      setBone(sd.knee, kn * deg, 0, 0, 'XYZ');
      setBone(sd.ank, an * deg, 0, 0, 'XYZ');
      setBone(sd.clav, 0, 0, sd.sx * cl * deg, 'XYZ');
    }
    // body-frame chest and shoulders (the pelvis is the body frame)
    qChB.multiplyQuaternions(bone.spine.quaternion, bone.chest.quaternion);
    pChB.copy(bone.chest.position).applyQuaternion(bone.spine.quaternion).add(bone.spine.position);
    const omega = S.omega ?? S.spinRate ?? 0;
    const e = clamp(omega / CUT.omegaFull, -1, 1);
    for (let i = 0; i < 2; i++) {
      const sd = side[i];
      sd.qCl.multiplyQuaternions(qChB, sd.clav.quaternion);
      sd.qClInv.copy(sd.qCl).invert();
      sd.S.copy(sd.sh.position).applyQuaternion(sd.qCl).add(tmp.copy(sd.clav.position).applyQuaternion(qChB)).add(pChB);
      // blend the arm targets over the stances (the cut is solved for the spin first)
      const sx = sd.sx;
      vA.set(0, 0, 0);
      vB.set(0, 0, 0);
      vW.set(0, 0, 0);
      vE.set(0, 0, 0);
      for (let k = 0; k < 5; k++) {
        const w = Wt[k];
        if (w < 1e-6) continue;
        if (k === 3) {
          cutArm(sd, e);
          vA.addScaledVector(sd.G, w);
          vB.addScaledVector(sd.bx, w);
          vW.addScaledVector(sd.up, w);
          vE.addScaledVector(sd.pole, w);
          continue;
        }
        const st = STANCES[k];
        vA.x += w * sx * st.hand[0];
        vA.y += w * st.hand[1];
        vA.z += w * st.hand[2];
        vB.x += w * sx * st.blade[0];
        vB.y += w * st.blade[1];
        vB.z += w * st.blade[2];
        vW.x += w * sx * st.up[0];
        vW.y += w * st.up[1];
        vW.z += w * st.up[2];
        vE.x += w * sx * st.pole[0];
        vE.y += w * st.pole[1];
        vE.z += w * st.pole[2];
      }
      if (arms > 0) {
        vB.normalize();
        vA.lerp(tmp.set(sx * ATTACK.hand[0], ATTACK.hand[1], ATTACK.hand[2]), arms);
        vB.lerp(tmp.set(sx * ATTACK.blade[0], ATTACK.blade[1], ATTACK.blade[2]).normalize(), arms);
        vW.normalize().lerp(tmp.set(sx * ATTACK.up[0], ATTACK.up[1], ATTACK.up[2]).normalize(), arms);
        vE.normalize().lerp(tmp.set(sx * ATTACK.pole[0], ATTACK.pole[1], ATTACK.pole[2]).normalize(), arms);
      }
      sd.G.copy(vA);
      sd.pole.copy(vE);
      // the hand frame: x along the blade, y pistol-up (orthogonalised), z = x cross y
      sd.hx.copy(vB).normalize();
      sd.hy.copy(vW).addScaledVector(sd.hx, -vW.dot(sd.hx));
      if (sd.hy.lengthSq() < 1e-8) sd.hy.set(0, 1, 0).addScaledVector(sd.hx, -sd.hx.y);
      sd.hy.normalize();
      sd.hz.crossVectors(sd.hx, sd.hy);
      solveArm(sd);
    }

    // the head turns toward S.pose.look within the neck's limits (less while spinning; never snaps round behind)
    let yaw = 0;
    let pitch = 0;
    const lk = pose.look;
    if (lk) {
      tmp.set(lk[0] - S.pos[0], lk[1] - S.pos[1], lk[2] - S.pos[2]).applyQuaternion(qA.copy(root.quaternion).invert());
      vA.copy(bone.neck.position).applyQuaternion(qChB).add(pChB);
      tmp.sub(vA).applyQuaternion(qB.copy(qChB).invert());
      const yw = Math.atan2(tmp.x, tmp.z);
      const fade = (1 - sstep(100 * deg, 165 * deg, Math.abs(yw))) * (1 - Wt[3]);
      yaw = clamp(yw, -72 * deg, 72 * deg) * fade;
      pitch = clamp(Math.atan2(-tmp.y, Math.hypot(tmp.x, tmp.z)), -12 * deg, 38 * deg) * fade;
    }
    setBone(bone.neck, 0.4 * pitch, 0.4 * yaw, 0, 'YXZ');
    setBone(bone.head, 0.6 * pitch, 0.6 * yaw, 0, 'YXZ');

    // anti-G cuffs
    const p = clamp01((S.antiG || 0) / P.antiG.kPaMax);
    strapMesh.morphTargetInfluences[0] = p;
    cuffMesh.morphTargetInfluences[0] = p;
    metalMesh.morphTargetInfluences[0] = p;

    // x-ray and isolate: the body goes to the ghost shell, the harness stays solid and warms with the load
    const xr = clamp01(D.xray || 0);
    const iso = D.isolate || null;
    const ik = iso ? clamp01(D.isolateK ?? 1) : 0;
    const isoH = iso === 'harness' ? ik : 0;
    const isoO = iso && iso !== 'harness' ? ik : 0;
    // another subsystem isolated: the body recedes to a faint ghost shell (a 12 % solid would show every inner layer),
    // the harness to 12 % opacity
    const xe = Math.max(xr, isoH, isoO);
    const dim = 1 - 0.88 * isoO;
    const aBody = 1 - xe;
    const gA = Math.max(xr, isoH) * dim + 0.3 * isoO;
    ghostMat.uniforms.uA.value = gA;
    for (let i = 0; i < bodyMats.length; i++) setAlpha(bodyMats[i], aBody);
    for (let i = 0; i < solid.length; i++) {
      solid[i].visible = aBody > 0.004;
      solid[i].castShadow = aBody > 0.5;
    }
    for (let i = 0; i < ghosts.length; i++) ghosts[i].visible = gA > 0.004;
    const w0 = S.wires ? S.wires[0] : null;
    const w1 = S.wires ? S.wires[1] : null;
    const load = clamp01(((w0 ? w0.tension || 0 : 0) + (w1 ? w1.tension || 0 : 0)) / 5500);
    const show = Math.max(xr, D.working === 'harness' ? 1 : 0);
    for (let g = 0; g < 4; g++) setAccent(M.straps[g], Math.max(isoH, show * load * SHARE[g]));
    setAccent(M.cuffs, Math.max(isoH, Math.max(xr, D.working === 'antiG' ? 1 : 0) * p * 0.8));
    setAccent(M.metal, 0);
    for (let i = 0; i < harnessMats.length; i++) setAlpha(harnessMats[i], dim);
    for (let i = 0; i < harnessMeshes.length; i++) harnessMeshes[i].castShadow = dim > 0.5;

    root.updateMatrixWorld(true);
  };

  /** The blade tip of hand 'L' or 'R' in the body frame for the current pose (call after update; pass out to reuse). */
  const bladeTipLocal = (s, out = new V3()) => {
    inv4.copy(pelvis.matrixWorld).invert();
    return out.copy(TIP).applyMatrix4(hands[s === 'L' ? 'L' : 'R'].matrixWorld).applyMatrix4(inv4);
  };

  update({pos: [0, b.hipY, 0], q: [0, 0, 0, 1], pose: {w: {stand: 1}}}, EMPTY);
  return {root, pelvis, hands, harness, update, bladeTipLocal};
}
