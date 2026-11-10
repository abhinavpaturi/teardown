// CONTRACT-REQUEST (stage/integrator): GTAOPass draws its normal/depth pass with one override material that ignores
//   per-material clipping, so the cut-away housing still feeds the AO: a faint grey film over the open quarter in close
//   cutaway shots. Frame close cutaways with cam.ao = 0 (the bench does), or accept the faint film.
// CONTRACT-REQUEST (physics, fx): the fairlead rail is the parabola eye(u) = park + (hip - park) * (u, u^2, u^2) per
//   axis (x mirrored for the left line), one continuous arc hip-centre-hip through P.shuttle.park. rig.fairlead.L/R is
//   the roller eye on that curve, updated every frame (both rollers stand 15 mm either side of the centre when parked,
//   so they never overlap). rig.muzzle.L/R (body frame) is where a seated anchor's tip sits, for the stowed tether.
//
// The ODM-E1 gear itself, built from code in metres in the body frame (origin at the hip-joint midpoint, x right, y up
// the spine, z forward), so root hangs straight off the rider's pelvis. Everything a soldier wears below the shoulders:
// the leather-over-carbon pelvic girdle with its buckle, side fittings and the fairlead rail across the front of the
// hips; the contoured carbon back plate with the battery and supercaps inside and the occipital cowl on top; the central
// unit (the canon "butterfly core"): a domed hub holding the cooling impeller behind a louvred grille, an axial-flux
// motor and a planetary stage (P.gear.ratio), bell arms flaring out to two drums tilted 35 degrees up like wings, each with its
// clutch-brake, wound Dyneema, vented housing and slot bar; the guide tubes around the hips; the anchor launchers on
// elevation trunnions with their titanium helical spikes; two blade magazines with Type IV bottles on top; the two
// pistol-grip handles in the rider's hands with their snap-off blades and cables. update(S, D, hands) poses it all
// from the physics state and the display state, without allocating. The right side is built once; the left is its
// mirror (scale.x = -1), and the handles are not mirrored (both hand frames follow the same rule).
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {HEX, mat} from './materials.js';

const V3 = THREE.Vector3;
const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
const lerp = (a, b, k) => a + (b - a) * k;

// ------------------------------------------------------------ shapes around P (SPEC §4; right side, metres)
// Two moves from SPEC §4, both to stop parts passing through each other (rule 7: fix collisions with a number):
// the drums sit 15 mm further back (z -0.225, not -0.21) so their housings clear the back plate's edge, and the
// launchers ride above the bottles on a trunnion at (0.242, 0.012, 0) with the barrel from z -0.03 to 0.37 (SPEC puts
// the barrel at y -0.035, inside the gas bottle, and over the fairlead rail's hip end).
const G = {
  girdle: {y0: 0.10, y1: 0.16, gap: 0.005, t: 0.012},
  fitting: [0.178, 0.10, 0], // side fitting centre (SPEC: 0.165 is its inner face on the girdle)
  plate: {y0: -0.05, y1: 0.45, T: 0.035, gap: 0.016},
  hub: [0, 0.06, -0.21],
  drum: [0.155, 0.10, -0.225],
  tilt: 35 * D2R,
  launcher: {pivot: [0.242, 0.012, 0], toe: 5 * D2R, z0: -0.03, r: 0.017},
  mag: [0.225, -0.17, 0.10],
  bottle: {c: [0.228, -0.072, 0.08], r: 0.045, len: 0.46},
  hipBlock: [0.204, -0.012, 0.095],
  impBlades: 14, // the cooling impeller: the canon "fan"
  cowlG: 2.5, // SPEC §4: the cowl folds flat under 2.5 g and deploys above it (no P field yet)
  cowl: {fold: [0, 0.49, -0.04], up: [0, 0.715, 0], r: 0.124},
  cableBase: [0.199, 0.062, 0.03],
};

// ------------------------------------------------------------ small geometry helpers
const v2 = (x, y) => new THREE.Vector2(x, y);
// rounded boxes: two rounding segments on anything big enough to show them, one on bolts, ribs and magnets
const rb = (w, h, d, r = Math.min(w, h, d) * 0.25, seg = Math.min(w, h, d) < 0.012 ? 1 : 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) * 0.49));
// a closed profile [[r, h], ...] made counter-clockwise (outward normals) with every corner chamfered, so lathed
// parts get crisp bevelled edges instead of smeared normals
function ccw(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? pts.slice().reverse() : pts;
}
function chamfer(pts, c) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ka = Math.min(c, da / 3) / da;
    const kb = Math.min(c, db / 3) / db;
    out.push([p[0] + (a[0] - p[0]) * ka, p[1] + (a[1] - p[1]) * ka], [p[0] + (b[0] - p[0]) * kb, p[1] + (b[1] - p[1]) * kb]);
  }
  out.push(out[0]);
  return out;
}
/** a solid of revolution about y (or z) from a closed profile [[r, h], ...] */
function lathe(prof, seg = 48, axis = 'y', ch = 0.0007, phi0 = 0, phiL = TAU) {
  const pts = chamfer(ccw(prof), ch).map(([r, h]) => v2(Math.max(0, r), h));
  const g = new THREE.LatheGeometry(pts, seg, phi0, phiL);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}
const shapeOf = (pts) => {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
};
const pathOf = (pts) => {
  const s = new THREE.Path();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
};
function rrect(w, h, r, cx = 0, cy = 0, n = 4) {
  const pts = [];
  const q = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 1], [-w / 2 + r, -h / 2 + r, 2], [w / 2 - r, -h / 2 + r, 3]];
  for (const [x, y, k] of q) for (let i = 0; i <= n; i++) {
    const a = (k + i / n) * (Math.PI / 2);
    pts.push([cx + x + r * Math.cos(a), cy + y + r * Math.sin(a)]);
  }
  return pts;
}
const extrude = (shape, depth, bev = 0.0012, cs = 12) => {
  const g = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: cs});
  g.translate(0, 0, -depth / 2);
  return g;
};
const tube = (pts, r, seg = 48, rad = 10) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new V3(...p))), seg, r, rad, false);
const hexBolt = (r = 0.0028, h = 0.0022) => new THREE.CylinderGeometry(r, r, h, 6);
// a toothed outline (gear), teeth outward
function gearPts(teeth, rOut, rRoot) {
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * TAU;
    const da = TAU / teeth;
    for (const [r, f] of [[rRoot, 0], [rRoot, 0.18], [rOut, 0.34], [rOut, 0.6], [rRoot, 0.76]]) pts.push([r * Math.cos(a0 + da * f), r * Math.sin(a0 + da * f)]);
  }
  return pts;
}
const circlePts = (r, n = 32, cx = 0, cy = 0) => Array.from({length: n}, (_, i) => [cx + r * Math.cos((i / n) * TAU), cy + r * Math.sin((i / n) * TAU)]);

// many small parts of one material merged into one mesh: fewer draw calls for bolts, ribs, coils and blades
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new V3();
const _s = new V3();
class Bag {
  constructor() {
    this.list = [];
  }
  add(geo, p = [0, 0, 0], r = [0, 0, 0], s = 1, order = 'XYZ') {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _e.set(r[0], r[1], r[2], order);
    _m4.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e), typeof s === 'number' ? _s.set(s, s, s) : _s.set(s[0], s[1], s[2]));
    g.applyMatrix4(_m4);
    this.list.push(g);
    return this;
  }
  geo() {
    let n = 0;
    for (const g of this.list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of this.list) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return out;
  }
}

// a blade: x along it (root 0 .. tip L), y across (spine +w/2, edge -w/2), z its thickness. The edge bevel (18 deg
// included) is its own face set, the tip is clipped by a straight cut whose spine end sits `run` behind the point, so
// the point is on the edge side like a snap-off cutter blade. Returns {body, edge} flat-shaded geometries.
function bladeGeo(L, w, t, bev, run) {
  const h = w / 2;
  const ys = -h + bev;
  const tz = t / 2;
  const xc = (y) => L - (run * (y + h)) / w;
  const A = [0, h], B = [0, ys], C = [0, -h], D = [L, -h], E = [xc(h), h], F = [xc(ys), ys];
  const body = [];
  const edge = [];
  const tri = (list, out, ...ps) => {
    // order the polygon so its normal faces `out`, then fan it
    const [a, b, c] = ps;
    const n = new V3().subVectors(new V3(...b), new V3(...a)).cross(new V3().subVectors(new V3(...c), new V3(...a)));
    if (n.dot(new V3(...out)) < 0) ps.reverse();
    for (let i = 1; i < ps.length - 1; i++) list.push(...ps[0], ...ps[i], ...ps[i + 1]);
  };
  const at = (p, z) => [p[0], p[1], z];
  for (const sg of [1, -1]) {
    tri(body, [0, 0, sg], at(A, sg * tz), at(B, sg * tz), at(F, sg * tz), at(E, sg * tz));
    tri(edge, [0, -0.2, sg], at(B, sg * tz), at(C, 0), at(D, 0), at(F, sg * tz));
  }
  tri(body, [0, 1, 0], at(A, tz), at(E, tz), at(E, -tz), at(A, -tz));
  tri(body, [1, 0.6, 0], at(E, tz), at(F, tz), at(F, -tz), at(E, -tz));
  tri(edge, [1, 0, 0], at(F, tz), at(D, 0), at(F, -tz));
  tri(body, [-1, 0, 0], at(A, tz), at(B, tz), at(B, -tz), at(A, -tz));
  tri(edge, [-1, 0, 0], at(B, tz), at(C, 0), at(B, -tz));
  const mk = (arr) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const uv = [];
    for (let i = 0; i < arr.length; i += 3) uv.push(arr[i] / L, (arr[i + 1] + h) / w);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  return {body: mk(body), edge: mk(edge)};
}
// the diagonal score lines, parallel to the clipped tip so every snapped segment leaves the same point; drawn across
// the flat of the blade only (the bevel is 5 mm), proud of both faces by a hair
function scoreGeo(Pb, w, t, bev, run, L) {
  const bag = new Bag();
  const h = w / 2;
  const fl = (w - bev) / w; // fraction of the width that is flat
  const dx = run * fl;
  const dy = w - bev;
  const len = Math.hypot(dx, dy);
  const box = new THREE.BoxGeometry(len, 0.0009, t + 0.0004);
  for (let k = 0; k < Pb.scores; k++) {
    const xm = Pb.root + k * Pb.pitch; // the line crosses the blade's centre here
    const xs = xm - run / 2; // spine end
    if (xs + dx > L - run) break;
    bag.add(box, [xs + dx / 2, h - dy / 2, 0], [0, 0, Math.atan2(-dy, dx)]);
  }
  return bag.geo();
}

// a closed slab whose two faces meet in a rounded rim (the back plate, the battery tray): the domain s, w in -1..1 is
// mapped onto a superellipse and place(s, w, h, out) puts the point at half-thickness fraction h (+1 inner face)
function slabGeo(N, Mn, place, n = 5, rim = 0.16) {
  const pos = [];
  const uv = [];
  const idx = [];
  const u = (i, k) => Math.sin((i / k - 0.5) * Math.PI);
  const p = new V3();
  for (let side = 0; side < 2; side++) {
    const sg = side ? -1 : 1;
    for (let j = 0; j <= Mn; j++)
      for (let i = 0; i <= N; i++) {
        const a = u(i, N);
        const b = u(j, Mn);
        const rho = Math.max(Math.abs(a), Math.abs(b));
        const sup = Math.pow(Math.pow(Math.abs(a), n) + Math.pow(Math.abs(b), n), 1 / n) || 1;
        const k = rho / sup;
        const q = (rho - (1 - rim)) / rim;
        const hh = q > 0 ? Math.sqrt(Math.max(0, 1 - q * q)) : 1;
        place(a * k, b * k, sg * hh, p);
        pos.push(p.x, p.y, p.z);
        uv.push(i / N, j / Mn);
      }
    const o = side * (N + 1) * (Mn + 1);
    for (let j = 0; j < Mn; j++)
      for (let i = 0; i < N; i++) {
        const a = o + j * (N + 1) + i;
        const b = a + 1;
        const c = a + N + 1;
        const d = c + 1;
        if (side === 0) idx.push(a, b, d, a, d, c);
        else idx.push(a, d, b, a, c, d);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// a tube whose centreline is rewritten every frame (cables, the line along the rail): fixed buffers, parallel-transport
// frames, no allocation after build. Fill .P (n+1 points), then call build().
class DynTube {
  constructor(n, m, r) {
    Object.assign(this, {n, m, r});
    const cnt = (n + 1) * (m + 1);
    this.pos = new Float32Array(cnt * 3);
    this.nor = new Float32Array(cnt * 3);
    const idx = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) {
        const a = i * (m + 1) + j;
        const b = a + m + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.P = Array.from({length: n + 1}, () => new V3());
    this.t = new V3();
    this.nv = new V3();
    this.b = new V3();
    this.d = new V3();
  }
  build() {
    const {n, m, r, P, t, nv, b, d, pos, nor} = this;
    for (let i = 0; i <= n; i++) {
      t.subVectors(P[i < n ? i + 1 : n], P[i > 0 ? i - 1 : 0]);
      if (t.lengthSq() < 1e-14) t.set(0, -1, 0);
      t.normalize();
      if (i === 0) nv.set(Math.abs(t.y) > 0.9 ? 1 : 0, Math.abs(t.y) > 0.9 ? 0 : 1, 0);
      nv.addScaledVector(t, -nv.dot(t));
      if (nv.lengthSq() < 1e-12) nv.set(1, 0, 0);
      nv.normalize();
      b.crossVectors(t, nv);
      for (let j = 0; j <= m; j++) {
        const a = (j / m) * TAU;
        const c = Math.cos(a);
        const s = Math.sin(a);
        d.set(nv.x * c + b.x * s, nv.y * c + b.y * s, nv.z * c + b.z * s);
        const k = (i * (m + 1) + j) * 3;
        pos[k] = P[i].x + d.x * r;
        pos[k + 1] = P[i].y + d.y * r;
        pos[k + 2] = P[i].z + d.z * r;
        nor[k] = d.x;
        nor[k + 1] = d.y;
        nor[k + 2] = d.z;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }
}
const bez = (out, a, b, c, d, t) => {
  const u = 1 - t;
  const k0 = u * u * u;
  const k1 = 3 * u * u * t;
  const k2 = 3 * u * t * t;
  const k3 = t * t * t;
  return out.set(a.x * k0 + b.x * k1 + c.x * k2 + d.x * k3, a.y * k0 + b.y * k1 + c.y * k2 + d.y * k3, a.z * k0 + b.z * k1 + c.z * k2 + d.z * k3);
};

// procedural greyscale patterns for bump and colour maps (diamond knurl, wound line, filament winding)
function patternTex(w, h, fn, rep = [1, 1], srgb = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const im = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round(255 * clamp01(fn(x / w, y / h)));
      const k = (y * w + x) * 4;
      im.data[k] = im.data[k + 1] = im.data[k + 2] = v;
      im.data[k + 3] = 255;
    }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep[0], rep[1]);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const frac = (x) => x - Math.floor(x);
const tri = (x) => 1 - Math.abs(2 * frac(x) - 1);

// piecewise curve through [y, value] knots, eased between them so outlines have no kinks
function knots(tab) {
  return (y) => {
    if (y <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++)
      if (y <= tab[i][0]) {
        const [y0, a] = tab[i - 1];
        const [y1, b] = tab[i];
        return lerp(a, b, smooth((y - y0) / (y1 - y0)));
      }
    return tab[tab.length - 1][1];
  };
}

const ACC = new THREE.Color(HEX.accent);
const CAP_HOUSING = new THREE.Color('#d8cdbd').convertSRGBToLinear();
const CAP_LINE = new THREE.Color('#d6c8a6').convertSRGBToLinear();

export function buildRig(P) {
  const B = P.body;
  const RL = P.reel;
  const root = new THREE.Group();
  root.name = 'odm-rig';
  const groups = {tanks: [], drive: [], reels: [], anchors: [], handles: [], blades: [], harness: []};

  // ---------------------------------------------------------------- materials: one per (subsystem, part, kind), so
  // isolate fades whole subsystems and the accent can light one part
  const recs = [];
  const recOf = new Map();
  // how strongly a part takes its subsystem's accent: the hub's internals full, housings less, and the big near-black
  // back plate none (any lerp of near-black toward the accent reads as maroon), so a cutaway of the core reads first;
  // a part named directly by D.working ('battery', 'motor', 'drumR') always takes the full accent
  const WEIGHT = {battery: 0, cowl: 0.5, rail: 0.7, guide: 0.6, gas: 0.7, hip: 0.6};
  const cache = new Map();
  const M = (key, g, p, over = null, tag = '') => {
    const id = g + '|' + p + '|' + key + '|' + tag;
    let m = cache.get(id);
    if (!m) {
      m = mat(key, over || {});
      cache.set(id, m);
      const r = {m, g, p, k: 0, a: 1, cut: null, line: false, meshes: [], w: WEIGHT[p.split('.')[0].replace(/[LR]$/, '')] ?? (p.includes('.') ? 0.4 : 1)};
      recs.push(r);
      recOf.set(m, r);
    }
    return m;
  };
  // a section cap without stencils: the cut material draws both sides and paints every back face flat in the cap
  // colour, so a clipped solid reads as solid through the cut (the parts must be closed, which every cut part is)
  const capPatch = (m, cap) => {
    m.userData.cap = {value: cap};
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCap = m.userData.cap;
      sh.fragmentShader = 'uniform vec3 uCap;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if (!gl_FrontFacing) gl_FragColor = vec4(uCap, gl_FragColor.a);');
    };
    m.customProgramCacheKey = () => 'odm-cap';
  };
  const CUT = {hub: [new THREE.Plane(), new THREE.Plane(), new THREE.Plane()], drum: [new THREE.Plane(), new THREE.Plane()]};
  const MC = (key, g, p, which, cap = CAP_HOUSING, over = null, tag = '') => {
    const m = M(key, g, p, over, tag);
    const r = recOf.get(m);
    if (!r.cut) {
      r.cut = which;
      capPatch(m, cap || m.userData.base.clone().multiplyScalar(1.35));
    }
    return m;
  };
  // the hub's internals are sectioned by the same wedge as its housing, each cut face in its own (brighter) colour
  const MI = (key, p, over = null, tag = '') => MC(key, 'drive', p, 'hub', null, over, tag);

  const add = (parent, geo, m, p = null, r = null) => {
    const o = new THREE.Mesh(geo, m);
    if (p) o.position.set(p[0], p[1], p[2]);
    if (r) o.rotation.set(r[0], r[1], r[2]);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const grp = (parent, p = null, r = null) => {
    const o = new THREE.Group();
    if (p) o.position.set(p[0], p[1], p[2]);
    if (r) o.rotation.set(r[0], r[1], r[2]);
    parent.add(o);
    return o;
  };
  // explode: each part leaves along its own vector (in its parent's frame), staggered by t0 so outer parts go first
  const EX = [];
  const exv = (o, v, t0 = 0) => {
    EX.push({o, p0: o.position.clone(), v: new V3(...v), t0});
    return o;
  };
  // labels: a point fixed to a part, reported in the body frame wherever the part has gone (explode, hands)
  const labels = [];
  const rootInv = new THREE.Matrix4();
  const label = (key, name, sub, group, obj, local) => {
    const loc = new V3(...local);
    const out = new V3();
    labels.push({
      key, name, sub, group,
      at: () => {
        root.updateWorldMatrix(true, false);
        rootInv.copy(root.matrixWorld).invert();
        return out.copy(loc).applyMatrix4(obj.matrixWorld).applyMatrix4(rootInv);
      },
    });
  };

  const knurl = patternTex(64, 64, (u, v) => Math.min(tri(u + v), tri(u - v)) * 1.25, [7, 9]);
  const weave = knurl.clone();
  weave.repeat.set(10, 14);
  weave.needsUpdate = true;
  const twill = knurl.clone();
  twill.repeat.set(18, 30);
  twill.needsUpdate = true;
  // the wound line: 20 wraps across the drum, laid as a helix so a turning drum shows the lay walking across it
  const lay = patternTex(64, 256, (u, v) => 0.62 + 0.38 * Math.pow(0.5 + 0.5 * Math.cos(TAU * (v * 20 + u)), 0.6), [1, 1], true);
  const layBump = patternTex(64, 256, (u, v) => Math.pow(0.5 + 0.5 * Math.cos(TAU * (v * 20 + u)), 0.5));

  // ================================================================ HARNESS: girdle, buckle, side fittings
  const harness = grp(root);
  groups.harness.push(harness);
  const W = B.waist;
  {
    const mL = M('leather', 'harness', 'girdle');
    const ell = (rx, rz, n = 72) => Array.from({length: n}, (_, i) => [rx * Math.cos((i / n) * TAU), rz * Math.sin((i / n) * TAU)]);
    const gi = G.girdle;
    const b = 0.002;
    const sh = shapeOf(ell(W.rx + gi.gap + gi.t - b, W.rz + gi.gap + gi.t - b));
    sh.holes.push(pathOf(ell(W.rx + gi.gap + b, W.rz + gi.gap + b)));
    const band = new THREE.ExtrudeGeometry(sh, {depth: gi.y1 - gi.y0 - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: b, bevelSegments: 2, curveSegments: 8});
    band.rotateX(-Math.PI / 2);
    band.translate(0, gi.y0 + 0.003, 0);
    add(harness, band, mL);
    // carbon edge binding top and bottom, stitched on
    const mC = M('carbon', 'harness', 'girdle');
    const rm = W.rx + gi.gap + gi.t / 2;
    const rz = W.rz + gi.gap + gi.t / 2;
    for (const y of [gi.y0 + 0.002, gi.y1 - 0.002]) {
      const pts = ell(rm, rz, 48).map(([x, z]) => new V3(x, y, -z));
      add(harness, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.0042, 6, true), mC);
    }
    // rivets around the band, and four D-rings on its top edge where the rider's straps clip on
    const mS = M('steel', 'harness', 'girdle');
    const rv = new Bag();
    const dome = new THREE.SphereGeometry(0.0035, 8, 4, 0, TAU, 0, Math.PI / 2);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + 0.07;
      const x = Math.cos(a) * (W.rx + gi.gap + gi.t + 0.0005);
      const z = Math.sin(a) * (W.rz + gi.gap + gi.t + 0.0005);
      const nrm = new V3(x / (W.rx * W.rx), 0, z / (W.rz * W.rz)).normalize();
      _q.setFromUnitVectors(new V3(0, 1, 0), nrm);
      _e.setFromQuaternion(_q);
      for (const y of [gi.y0 + 0.014, gi.y1 - 0.014]) rv.add(dome, [x, y, z], [_e.x, _e.y, _e.z]);
    }
    const dr = new THREE.TorusGeometry(0.011, 0.0022, 6, 14, Math.PI);
    for (const [x, zs] of [[0.075, 1], [-0.075, 1], [0.082, -1], [-0.082, -1]]) {
      const z = zs * (W.rz + gi.gap + gi.t) * Math.sqrt(1 - (x / (W.rx + gi.gap + gi.t)) ** 2);
      rv.add(dr, [x, gi.y1 - 0.002, z + zs * 0.003], [0, Math.atan2(x, z), 0]);
    }
    add(harness, rv.geo(), mS);
    // the buckle: a plate, a frame and its bar, at the front of the band
    const zf = W.rz + gi.gap + gi.t;
    add(harness, rb(0.088, 0.054, 0.008, 0.003), M('gunmetal', 'harness', 'girdle'), [0, 0.13, zf + 0.003]);
    const fr = shapeOf(rrect(0.074, 0.046, 0.008));
    fr.holes.push(pathOf(rrect(0.054, 0.028, 0.004)));
    add(harness, extrude(fr, 0.004, 0.0012), mS, [0, 0.13, zf + 0.0095]);
    add(harness, rb(0.006, 0.03, 0.006, 0.002), mS, [-0.008, 0.13, zf + 0.0105]);
    label('girdle', 'Pelvic girdle', 'carbon under leather, carries every load', 'harness', harness, [0.1, 0.146, 0.103]);
    // the master fairlead bracket: from the buckle down to the centre of the rail
    const pk = P.shuttle.park;
    const br = add(harness, rb(0.008, 0.112, 0.009, 0.003), M('gunmetal', 'harness', 'girdle'), [0, (0.104 + pk[1]) / 2, (zf + 0.004 + pk[2] - 0.012) / 2]);
    br.rotation.x = -Math.atan2(pk[2] - 0.012 - zf - 0.004, 0.104 - pk[1]);
  }

  // ================================================================ BACK PLATE: battery, supercaps, carbon cover
  const PL = G.plate;
  const rzB = knots([[-0.05, 0.125], [0.0, 0.12], [0.13, W.rz], [0.36, B.chest.rz], [0.45, 0.112]]);
  const rxB = knots([[-0.05, 0.17], [0.0, B.pelvis.rx], [0.13, W.rx], [0.36, B.chest.rx], [0.45, 0.165]]);
  // contoured: 0.23 wide at the sacrum, waisted to 0.20 where the drums tuck in beside it, 0.30 across the scapulae
  const hwB = knots([[-0.05, 0.115], [0.03, 0.10], [0.16, 0.10], [0.3, 0.143], [0.45, 0.15]]);
  const zIn = (x, y) => -(rzB(y) + PL.gap) * Math.sqrt(Math.max(0.1, 1 - (x / (rxB(y) + 0.03)) ** 2));
  const plateAt = (T, inset = 0, zc = -PL.T / 2) => (s, w, h, out) => {
    const y = lerp(PL.y0 + inset, PL.y1 - inset, (w + 1) / 2);
    const x = s * (hwB(y) - inset);
    out.set(x, y, zIn(x, y) + zc + (h * T) / 2);
  };
  const plateGrp = grp(root);
  groups.drive.push(plateGrp);
  const lid = exv(grp(plateGrp), [0, 0.04, -0.15], 0.08);
  {
    const mC = M('carbon', 'drive', 'battery', {bumpMap: twill, bumpScale: 0.22});
    add(lid, slabGeo(28, 36, plateAt(PL.T)), mC);
    // bolts round the edge and the hub's mounting flange seat
    const bg = new Bag();
    const hb = hexBolt(0.0032, 0.003);
    for (const [s, w] of [[-0.82, -0.86], [0.82, -0.86], [-0.84, 0.88], [0.84, 0.88], [-0.86, 0.3], [0.86, 0.3]]) {
      const y = lerp(PL.y0, PL.y1, (w + 1) / 2);
      const x = s * hwB(y);
      bg.add(hb, [x, y, zIn(x, y) - PL.T - 0.0008], [Math.PI / 2, 0, 0]);
    }
    add(lid, bg.geo(), M('steel', 'drive', 'battery'));
    // the battery access panel, proud of the shell by a millimetre, its screws, the bus connector and a vent row
    const pz = (x, y) => zIn(x, y) - PL.T;
    const panel = slabGeo(14, 18, (s, w, h, out) => {
      const y = lerp(0.2, 0.41, (w + 1) / 2);
      const x = s * lerp(0.09, 0.11, (w + 1) / 2);
      out.set(x, y, pz(x, y) + 0.0008 + h * 0.0016);
    }, 4, 0.2);
    add(lid, panel, M('carbon', 'drive', 'battery', {color: '#33363c', roughness: 0.38}, 'panel'));
    const ps = new Bag();
    for (const [x, y] of [[-0.085, 0.215], [0.085, 0.215], [-0.1, 0.395], [0.1, 0.395], [-0.093, 0.305], [0.093, 0.305]]) ps.add(new THREE.CylinderGeometry(0.0026, 0.0026, 0.002, 10), [x, y, pz(x, y) - 0.0018], [Math.PI / 2, 0, 0]);
    ps.add(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 20), [0.06, 0.37, pz(0.06, 0.37) - 0.006], [Math.PI / 2, 0, 0]);
    add(lid, ps.geo(), M('steel', 'drive', 'battery'));
    add(lid, new THREE.TorusGeometry(0.0095, 0.0018, 6, 20), M('brass', 'drive', 'battery'), [0.06, 0.37, pz(0.06, 0.37) - 0.012]);
    const vs = new Bag();
    for (let i = 0; i < 5; i++) {
      const x = -0.04 + i * 0.02;
      vs.add(rb(0.006, 0.04, 0.003, 0.0012), [x, 0.17, pz(x, 0.17) - 0.0002]);
    }
    add(lid, vs.geo(), M('rubber', 'drive', 'battery'));
    // two clamps that seat the plate on the girdle
    for (const x of [-0.07, 0.07]) add(lid, rb(0.026, 0.03, 0.014, 0.004), M('gunmetal', 'drive', 'battery'), [x, 0.13, zIn(x, 0.13) + 0.004]);
  }
  label('battery', 'Back plate: battery', `${P.bus.battWh} Wh + ${Math.round(P.bus.capJ / 1000)} kJ supercap`, 'drive', lid, [-0.085, 0.36, zIn(-0.085, 0.36) - PL.T]);
  const pack = exv(grp(plateGrp), [0, 0, -0.05], 0.08);
  {
    // 20s2p of 21700 cells lying across the plate on its mid-surface, a supercap bank either side at the top
    const cell = new THREE.CylinderGeometry(0.0104, 0.0104, 0.068, 14);
    cell.rotateZ(Math.PI / 2);
    const cb = new Bag();
    for (let i = 0; i < 20; i++)
      for (const x of [-0.036, 0.036]) {
        const y = -0.018 + i * 0.0215;
        cb.add(cell, [x, y, zIn(x, y) - PL.T / 2]);
      }
    add(pack, cb.geo(), M('gunmetal', 'drive', 'battery', {color: '#4c6b7a', metalness: 0.35, roughness: 0.5}, 'cell'));
    const sc = new Bag();
    for (const x of [-0.104, 0.104]) for (let i = 0; i < 6; i++) {
      const y = 0.29 + i * 0.024;
      sc.add(rb(0.03, 0.021, 0.02, 0.004), [x, y, zIn(x, y) - PL.T / 2]);
    }
    add(pack, sc.geo(), M('steel', 'drive', 'battery', null, 'cap'));
    const bus = new Bag();
    for (let i = 0; i < 20; i += 2)
      for (const x of [-0.036, 0.036]) {
        const y = -0.018 + i * 0.0215 + 0.011;
        bus.add(rb(0.06, 0.006, 0.002, 0.0008), [x, y, zIn(x, y) - PL.T / 2 - 0.0108]);
      }
    add(pack, bus.geo(), M('copper', 'drive', 'battery'));
    add(pack, slabGeo(12, 16, plateAt(0.003, 0.012, -0.0045)), M('carbon', 'drive', 'battery', null, 'tray'));
  }

  // ================================================================ COWL: the padded C that holds the head above G.cowlG
  const cowl = exv(grp(lid), [0, 0.06, 0], 0.15);
  groups.harness.push(cowl);
  const CW = G.cowl;
  const cdir = new V3(CW.up[0] - CW.fold[0], CW.up[1] - CW.fold[1], CW.up[2] - CW.fold[2]);
  const cTravel = cdir.length();
  cdir.normalize();
  const cowlPad = grp(cowl, CW.fold);
  const stages = [];
  {
    const arc = 110 * D2R;
    const pad = new THREE.TorusGeometry(CW.r, 0.011, 10, 28, arc);
    pad.rotateZ(-Math.PI / 2 - arc / 2);
    pad.rotateX(Math.PI / 2);
    pad.scale(1, 2.6, 1);
    add(cowlPad, pad, M('leather', 'harness', 'cowl'));
    const sh = new THREE.TorusGeometry(CW.r + 0.013, 0.004, 6, 28, arc * 0.96);
    sh.rotateZ(-Math.PI / 2 - (arc * 0.96) / 2);
    sh.rotateX(Math.PI / 2);
    sh.scale(1, 6, 1);
    add(cowlPad, sh, M('carbon', 'harness', 'cowl'));
    const cap = new THREE.SphereGeometry(0.011, 10, 8);
    cap.scale(1, 2.6, 1);
    for (const s of [-1, 1]) add(cowlPad, cap, M('leather', 'harness', 'cowl'), [s * CW.r * Math.sin(arc / 2), 0, -CW.r * Math.cos(arc / 2)]);
    // two telescopes (4 stages) from clamps on the plate to the back of the pad
    const mS = M('steel', 'harness', 'cowl');
    for (const s of [-1, 1]) {
      const x = s * 0.06;
      const att = new V3(x, CW.fold[1], CW.fold[2] - Math.sqrt((CW.r + 0.013) ** 2 - x * x));
      const bot = att.clone().addScaledVector(cdir, -0.1);
      for (let k = 0; k < 4; k++) {
        const r = 0.0078 - k * 0.0011;
        const m = add(cowl, new THREE.CylinderGeometry(r, r, 0.1, 12), k ? mS : M('gunmetal', 'harness', 'cowl'));
        m.quaternion.setFromUnitVectors(new V3(0, 1, 0), cdir);
        stages.push({m, bot, k});
      }
      const yc = bot.y + 0.02;
      add(cowl, rb(0.022, 0.028, Math.abs(zIn(x, yc) - PL.T - bot.z) + 0.012, 0.004), M('gunmetal', 'harness', 'cowl'), [x, yc, (zIn(x, yc) - PL.T + bot.z) / 2]);
    }
  }
  label('cowl', 'Occipital cowl', `deploys above ${G.cowlG} g, holds the head`, 'harness', cowlPad, [0, 0.03, -CW.r - 0.014]);

  // ================================================================ CENTRAL UNIT: hub, impeller, motor, planetary
  const hub = exv(grp(root, G.hub), [0, 0.12, -0.3], 0);
  groups.drive.push(hub);
  const mH = MC('steel', 'drive', 'hub.housing', 'hub');
  // the can, its band a third of the way down, the flange on the plate, the dome with its grille opening
  add(hub, lathe([[0.061, -0.035], [0.065, -0.035], [0.065, 0.037], [0.061, 0.037]], 64, 'z'), mH);
  add(hub, lathe([[0.064, -0.001], [0.0685, -0.001], [0.0685, 0.007], [0.064, 0.007]], 64, 'z'), mH);
  add(hub, lathe([[0.03, 0.036], [0.077, 0.036], [0.077, 0.045], [0.03, 0.045]], 64, 'z'), mH);
  {
    const bg = new Bag();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.3;
      bg.add(hexBolt(0.003, 0.003), [Math.cos(a) * 0.071, Math.sin(a) * 0.071, 0.0345], [Math.PI / 2, 0, 0]);
    }
    add(hub, bg.geo(), MC('darkSteel', 'drive', 'hub.housing', 'hub'));
  }
  const dome = exv(grp(hub), [0, 0, -0.17], 0.12);
  add(dome, lathe([[0.061, -0.035], [0.065, -0.035], [0.0645, -0.041], [0.0625, -0.0465], [0.059, -0.051], [0.054, -0.0545], [0.05, -0.0562], [0.0478, -0.0562], [0.0478, -0.052], [0.051, -0.0505], [0.0555, -0.0475], [0.0585, -0.043], [0.0605, -0.038]], 64, 'z', 0.0005), mH);
  add(dome, lathe([[0, -0.049], [0.021, -0.049], [0.021, -0.057], [0.017, -0.0625], [0.009, -0.0655], [0, -0.066]], 40, 'z', 0.0005), mH);
  {
    // 16 louvred bars across the opening: the canon "fan" grille, louvres pitched so the impeller shows between them
    const bg = new Bag();
    const bar = rb(0.029, 0.004, 0.0055, 0.0012);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      bg.add(bar, [Math.cos(a) * 0.0345, Math.sin(a) * 0.0345, -0.054], [0.55, 0, a], 1, 'ZYX');
    }
    add(dome, bg.geo(), MC('darkSteel', 'drive', 'hub.housing', 'hub'));
  }
  label('fan', 'Cooling impeller', `${G.impBlades} blades behind the grille: the canon "fan"`, 'drive', dome, [0, 0, -0.066]);
  const motorRot = [];
  const impeller = exv(grp(hub), [0, 0, -0.125], 0.18);
  {
    const mF = MI('steel', 'fan');
    add(impeller, lathe([[0.007, -0.029], [0.048, -0.029], [0.048, -0.0265], [0.007, -0.0265]], 48, 'z'), mF);
    add(impeller, lathe([[0, -0.029], [0.012, -0.029], [0.011, -0.047], [0, -0.049]], 24, 'z'), mF);
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      pts.push([0.014 + 0.032 * f, -0.62 * f * f]);
    }
    const side = (sg) => pts.map(([r, a]) => [r * Math.cos(a + (sg * 0.0009) / r), r * Math.sin(a + (sg * 0.0009) / r)]);
    const blade = new THREE.ExtrudeGeometry(shapeOf([...side(1), ...side(-1).reverse()]), {depth: 0.0135, bevelEnabled: false, curveSegments: 2});
    blade.translate(0, 0, -0.0425);
    const bg = new Bag();
    for (let i = 0; i < G.impBlades; i++) bg.add(blade, [0, 0, 0], [0, 0, (i / G.impBlades) * TAU]);
    add(impeller, bg.geo(), mF);
    motorRot.push(impeller);
  }
  const rotorB = exv(grp(hub), [0, 0, -0.095], 0.24);
  const stator = exv(grp(hub), [0, 0, -0.07], 0.28);
  const rotorF = exv(grp(hub), [0, 0, -0.05], 0.32);
  {
    const mR = MI('steel', 'motor');
    const mMag = MI('darkSteel', 'motor');
    const disc = (z0, z1) => lathe([[0.008, z0], [0.058, z0], [0.058, z1], [0.008, z1]], 56, 'z');
    add(rotorB, disc(-0.026, -0.0205), mR);
    add(rotorF, disc(0.0205, 0.026), mR);
    for (const [g, z] of [[rotorB, -0.018], [rotorF, 0.018]]) {
      const bg = new Bag();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        bg.add(rb(0.017, 0.0115, 0.0045, 0.001), [Math.cos(a) * 0.041, Math.sin(a) * 0.041, z], [0, 0, a]);
      }
      add(g, bg.geo(), mMag);
    }
    add(rotorB, new THREE.CylinderGeometry(0.007, 0.007, 0.066, 16).rotateX(Math.PI / 2), mR, [0, 0, 0.002]);
    motorRot.push(rotorB, rotorF);
    add(stator, lathe([[0.016, -0.0125], [0.057, -0.0125], [0.057, 0.0125], [0.016, 0.0125]], 56, 'z'), MI('carbon', 'motor'));
    const bg = new Bag();
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + 0.17;
      bg.add(rb(0.03, 0.0105, 0.029, 0.003), [Math.cos(a) * 0.0385, Math.sin(a) * 0.0385, 0], [0, 0, a]);
    }
    add(stator, bg.geo(), MI('copper', 'motor'));
  }
  label('motor', 'Axial-flux motor', `${P.motor.pCont / 1000} kW cont, ${P.motor.pPeak / 1000} kW peak, ${P.mass.motor} kg`, 'drive', stator, [0.042, 0.042, 0]);
  // the planetary: sun on the motor shaft, three planets, a fixed ring; tooth counts chosen for P.gear.ratio
  // (ring fixed: ratio = 1 + ZR / ZS, and ZR = ZS + 2 ZP), e.g. 12 / 18 / 48 for 5 : 1
  const planetary = exv(grp(hub), [0, 0, -0.03], 0.36);
  let ZS = 12, ZP = 18, ZR = 48;
  {
    let best = 1e9;
    for (let zs = 10; zs <= 24; zs++) {
      const zr = Math.round((P.gear.ratio - 1) * zs);
      if ((zr - zs) % 2 || zr - zs < 12) continue;
      const err = Math.abs(1 + zr / zs - P.gear.ratio) + zs * 1e-4;
      if (err < best) [best, ZS, ZR, ZP] = [err, zs, zr, (zr - zs) / 2];
    }
  }
  const mod = (2 * 0.0405) / ZR;
  const sun = grp(planetary);
  const carrier = grp(planetary);
  const planets = [];
  {
    const mB = MI('brass', 'planetary');
    const sunS = shapeOf(gearPts(ZS, (ZS * mod) / 2 + mod, (ZS * mod) / 2 - 1.2 * mod));
    sunS.holes.push(pathOf(circlePts(Math.min(0.006, (ZS * mod) / 2 - 2 * mod), 16)));
    add(sun, extrude(sunS, 0.008, 0.0006, 4), mB, [0, 0, 0.031]);
    const plS = shapeOf(gearPts(ZP, (ZP * mod) / 2 + mod, (ZP * mod) / 2 - 1.2 * mod));
    plS.holes.push(pathOf(circlePts(0.003, 12)));
    const plG = extrude(plS, 0.008, 0.0006, 4);
    const rc = ((ZS + ZP) * mod) / 2;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const pg = grp(carrier, [Math.cos(a) * rc, Math.sin(a) * rc, 0.031]);
      add(pg, plG, mB);
      planets.push(pg);
    }
    add(carrier, lathe([[0.008, 0.0355], [0.036, 0.0355], [0.036, 0.0385], [0.008, 0.0385]], 40, 'z'), MI('gunmetal', 'planetary'));
    const ring = shapeOf(circlePts(0.05, 56));
    ring.holes.push(pathOf(gearPts(ZR, (ZR * mod) / 2 + 1.2 * mod, (ZR * mod) / 2 - mod)));
    add(planetary, extrude(ring, 0.008, 0.0006, 4), MI('steel', 'planetary'), [0, 0, 0.031]);
  }
  label('planetary', `Planetary ${+(1 + ZR / ZS).toFixed(2)} : 1`, `${ZS}-tooth sun, 3 x ${ZP} planets, ${ZR}-tooth ring`, 'drive', planetary, [0.03, 0.03, 0.031]);
  // the bevel gear case under the hub where both drum shafts meet the carrier, and the trim-jet slot on its tail
  add(hub, rb(0.1, 0.05, 0.07, 0.012), M('steel', 'drive', 'hub.case'), [0, -0.054, -0.005]);
  const nozzle = grp(hub, [0, -0.086, -0.035], [-40 * D2R, 0, 0]);
  groups.tanks.push(nozzle);
  {
    const mN = M('darkSteel', 'tanks', 'nozzle');
    add(nozzle, rb(0.088, 0.026, 0.05, 0.005), mN, [0, 0, 0.025]);
    add(nozzle, rb(0.07, 0.015, 0.004, 0.0015), M('rubber', 'tanks', 'nozzle'), [0, 0, -0.0005]);
    for (const s of [-1, 1]) add(nozzle, rb(0.084, 0.003, 0.012, 0.001), mN, [0, s * 0.0105, -0.003]);
  }
  label('nozzle', 'Trim-jet slot', `${P.gas.jet} N cold gas: ${(P.gas.jet / P.m).toFixed(1)} m/s² on ${Math.round(P.m)} kg`, 'tanks', nozzle, [0, 0, -0.004]);
  const nozzleOut = {pos: new V3(), dir: new V3()};

  // ================================================================ one side: drum, bell, clutch, guide tube, launcher,
  // anchor, magazine, bottle, hip arc and shuttle. s = +1 right (wires[1]), -1 left (wires[0]).
  const drumAxis = new V3(Math.cos(G.tilt), Math.sin(G.tilt), 0);
  const P_ = P.shuttle;
  const eyeAt = (u, out) => out.set(P_.park[0] + (P_.hip[0] - P_.park[0]) * u, P_.park[1] + (P_.hip[1] - P_.park[1]) * u * u, P_.park[2] + (P_.hip[2] - P_.park[2]) * u * u);
  const normAt = (u, out) => out.set(-2 * (P_.hip[2] - P_.park[2]) * u, 0, P_.hip[0] - P_.park[0]).normalize(); // outward, in the horizontal plane
  const SIDES = [];
  const buildSide = (s) => {
    const R = s > 0 ? 'R' : 'L';
    const side = grp(root);
    side.scale.x = s;
    const sd = {s, R, side};

    // ---------------------------------------------------------- the drum: housing (vents, slot bar), spool, line
    const drum = exv(grp(side, G.drum), [0.25, 0.1, -0.2], 0.04);
    drum.quaternion.setFromUnitVectors(new V3(0, 1, 0), drumAxis);
    groups.reels.push(drum);
    sd.drum = drum;
    const cutWhich = s > 0 ? 'drum' : null;
    const mHs = cutWhich ? MC('steel', 'reels', `drum${R}.housing`, 'drum') : M('steel', 'reels', `drum${R}.housing`);
    const mHd = cutWhich ? MC('gunmetal', 'reels', `drum${R}.housing`, 'drum') : M('gunmetal', 'reels', `drum${R}.housing`);
    add(drum, lathe([[0.076, -0.0545], [0.0935, -0.0545], [0.0935, -0.0445], [0.076, -0.0445]], 56), mHs);
    add(drum, lathe([[0.076, 0.0445], [0.0935, 0.0445], [0.0935, 0.0515], [0.076, 0.0515]], 56), mHs);
    {
      const bg = new Bag();
      const rib = rb(0.008, 0.092, 0.011, 0.002);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        bg.add(rib, [Math.cos(a) * 0.0885, 0, Math.sin(a) * 0.0885], [0, -a, 0]);
      }
      add(drum, bg.geo(), mHs);
    }
    const face = exv(grp(drum), [0, 0.07, 0], 0.3);
    add(face, lathe([[0, 0.0515], [0.0935, 0.0515], [0.0955, 0.0545], [0.092, 0.059], [0, 0.059]], 64), mHs);
    {
      const fr = shapeOf(rrect(0.132, 0.026, 0.012));
      fr.holes.push(pathOf(rrect(0.108, 0.008, 0.004)));
      const bar = extrude(fr, 0.006, 0.0015);
      bar.rotateX(-Math.PI / 2);
      add(face, bar, mHd, [0, 0.062, 0], [0, 0.6, 0]);
      const bg = new Bag();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + 0.31;
        bg.add(hexBolt(0.0028, 0.003), [Math.cos(a) * 0.084, 0.06, Math.sin(a) * 0.084]);
      }
      add(face, bg.geo(), mHd);
    }
    // the exit eye where the line leaves for the guide tube, at the bottom of the rim (local +x is down-and-out)
    add(drum, new THREE.CylinderGeometry(0.0085, 0.0095, 0.016, 14), M('steel', 'reels', `guide${R}`), [0.097, -0.01, 0], [0, 0, -Math.PI / 2]);
    const spool = grp(drum);
    sd.spool = spool;
    {
      const mSp = M('darkSteel', 'reels', `drum${R}`);
      add(spool, lathe([[0, -0.045], [RL.coreR, -0.045], [RL.coreR, 0.045], [0, 0.045]], 40), M('steel', 'reels', `drum${R}`));
      const fl = shapeOf(circlePts(RL.flangeR - 0.0012, 64));
      for (let i = 0; i < 6; i++) fl.holes.push(pathOf(circlePts(0.0105, 16, Math.cos((i / 6) * TAU) * 0.054, Math.sin((i / 6) * TAU) * 0.054)));
      const flg = extrude(fl, 0.0024, 0.0006, 16);
      flg.rotateX(-Math.PI / 2);
      for (const y of [-0.0425, 0.0425]) add(spool, flg, mSp, [0, y, 0]);
      const line = new THREE.CylinderGeometry(1, 1, 0.081, 64, 1);
      const mLine = cutWhich ? MC('tether', 'reels', `drum${R}.line`, 'drum', CAP_LINE, {map: lay, bumpMap: layBump, bumpScale: 2}) : M('tether', 'reels', `drum${R}.line`, {map: lay, bumpMap: layBump, bumpScale: 2});
      sd.pack = add(spool, line, mLine);
    }
    label(`drum${R}`, `Drum ${R === 'R' ? 'right' : 'left'}`, `Ø${Math.round(RL.flangeR * 2000)} mm, ${P.tether.len} m of Ø${P.tether.d * 1000} mm SK99`, 'reels', face, [0, 0.066, 0]);

    // ---------------------------------------------------------- the bell arm to the hub, clutch-brake, drum shaft
    const bellPts = [[0.0235, -0.172], [0.026, -0.15], [0.031, -0.113], [0.04, -0.1], [0.052, -0.087], [0.064, -0.075], [0.07, -0.065], [0.073, -0.0555], [0.0695, -0.0545], [0.0665, -0.0635], [0.0605, -0.0725], [0.0488, -0.0845], [0.0368, -0.0975], [0.0278, -0.111], [0.0225, -0.15], [0.02, -0.172]];
    const mBell = cutWhich ? MC('steel', 'drive', `clutch${R}.bell`, 'drum') : M('steel', 'drive', `clutch${R}.bell`);
    add(drum, lathe(bellPts, 56, 'y', 0.0006), mBell);
    add(drum, lathe([[0.066, -0.0585], [0.0805, -0.0585], [0.0805, -0.0545], [0.066, -0.0545]], 56), mBell);
    const clutch = grp(drum);
    const clutchStatic = grp(drum);
    {
      add(clutchStatic, lathe([[0.012, -0.0745], [0.052, -0.0745], [0.052, -0.0695], [0.012, -0.0695]], 48), M('darkSteel', 'drive', `clutch${R}`));
      add(clutchStatic, lathe([[0.034, -0.0695], [0.047, -0.0695], [0.047, -0.0685], [0.034, -0.0685]], 48, 'y', 0.0003), M('copper', 'drive', `clutch${R}`));
      const disc = (y, r0, r1) => lathe([[r0, y - 0.00125], [r1, y - 0.00125], [r1, y + 0.00125], [r0, y + 0.00125]], 48, 'y', 0.0003);
      add(clutch, disc(-0.066, 0.012, 0.049), M('brass', 'drive', `clutch${R}`));
      add(clutch, disc(-0.0627, 0.016, 0.051), M('steel', 'drive', `clutch${R}`));
      add(clutch, disc(-0.0594, 0.012, 0.049), M('brass', 'drive', `clutch${R}`));
      add(clutch, lathe([[0.006, -0.0575], [0.054, -0.0575], [0.054, -0.0555], [0.006, -0.0555]], 48), M('steel', 'drive', `clutch${R}`));
      add(clutch, new THREE.CylinderGeometry(0.0062, 0.0062, 0.125, 14), M('steel', 'drive', `clutch${R}`), [0, -0.105, 0]);
      add(clutch, lathe([[0.004, -0.168], [0.0165, -0.168], [0.0105, -0.158], [0.004, -0.158]], 24), M('brass', 'drive', `clutch${R}`));
    }
    sd.clutch = clutch;
    label(`clutch${R}`, 'Clutch-brake', `slips at ${P.reel.slip / 1000} kN, regen ${Math.round(P.bus.regen * 100)} %`, 'drive', drum, [-0.07, -0.066, 0]);

    // ---------------------------------------------------------- the hip: arc bar, hip block, rail end, clevis
    const mHarn = M('gunmetal', 'harness', `hip${R}`);
    add(side, rb(0.04, 0.08, 0.075, 0.007), mHarn, G.fitting);
    {
      const bg = new Bag();
      for (const [y, z] of [[0.075, -0.024], [0.075, 0.024], [0.125, -0.024], [0.125, 0.024]]) bg.add(hexBolt(0.0035, 0.003), [G.fitting[0] + 0.0205, y, z], [0, 0, Math.PI / 2]);
      add(side, bg.geo(), M('steel', 'harness', `hip${R}`));
    }
    add(side, tube([[0.182, 0.07, 0.022], [0.19, 0.04, 0.045], [0.199, 0.012, 0.066], [0.204, -0.002, 0.084]], 0.0068, 24, 10), mHarn);
    add(side, rb(0.028, 0.026, 0.07, 0.005), mHarn, G.hipBlock);
    add(side, rb(0.016, 0.012, 0.02, 0.003), mHarn, [0.206, -0.025, 0.079]);

    // ---------------------------------------------------------- the guide tube from the drum eye around the hip
    const mG = M('rubber', 'reels', `guide${R}`);
    const gp = [[0.209, 0.023, -0.225], [0.214, 0.008, -0.205], [0.209, -0.006, -0.165], [0.2, -0.011, -0.1], [0.196, -0.012, -0.03], [0.2, -0.012, 0.03], [0.204, -0.012, 0.062]];
    add(side, tube(gp, 0.0062, 64, 10), mG);
    for (const k of [0, 6]) add(side, new THREE.CylinderGeometry(0.0085, 0.0085, 0.012, 14), M('steel', 'reels', `guide${R}`), gp[k], k ? [Math.PI / 2, 0, 0] : [0, 0, -0.9]);
    recOf.get(mG).line = true;
    if (s > 0) label('guide', 'Line guide tube', 'drum to fairlead, around the hip', 'reels', side, [0.198, -0.003, -0.07]);

    // ---------------------------------------------------------- the fairlead shuttle on the rail
    const shuttle = grp(side);
    groups.reels.push(shuttle);
    {
      add(shuttle, rb(0.02, 0.026, 0.02, 0.004), M('gunmetal', 'reels', `shuttle${R}`), [0, 0, -0.012]);
      const rl = new THREE.CylinderGeometry(0.0046, 0.0046, 0.018, 14);
      for (const x of [-0.0052, 0.0052]) add(shuttle, rl, M('steel', 'reels', `shuttle${R}`), [x, 0, -0.0015]);
      add(shuttle, new THREE.TorusGeometry(0.0042, 0.0016, 8, 18), M('brass', 'reels', `shuttle${R}`), [0, 0, 0.002]);
    }
    sd.shuttle = shuttle;
    sd.eye = new V3();
    sd.n = new V3();
    if (s > 0) label('shuttle', 'Fairlead shuttle', `slides ${Math.round(Math.abs(P_.hip[0] - P_.park[0]) * 1000)} mm: tension x offset spins the rider`, 'reels', shuttle, [0, 0.014, 0]);
    // the line in the rail's groove, from the hip block to the roller
    sd.railLine = new DynTube(16, 6, P.tether.d / 2);
    {
      const m = add(side, sd.railLine.geo, M('tether', 'reels', `shuttle${R}`));
      m.frustumCulled = false;
    }

    // ---------------------------------------------------------- the anchor launcher on its elevation trunnion
    const L = G.launcher;
    const mount = exv(grp(side, L.pivot, [0, L.toe, 0]), [0.13, 0.15, 0.12], 0.1);
    groups.anchors.push(mount);
    const elev = grp(mount);
    sd.elev = elev;
    {
      const mBar = M('steel', 'anchors', `launcher${R}`);
      const mGun = M('gunmetal', 'anchors', `launcher${R}`);
      const z1 = L.z0 + P.anchor.barrel;
      const rB = P.anchor.bore / 2;
      add(elev, lathe([[0, L.z0], [L.r - 0.002, L.z0], [L.r, L.z0 + 0.004], [L.r, z1 - 0.04], [L.r + 0.0025, z1 - 0.036], [L.r + 0.0025, z1 - 0.006], [L.r + 0.0005, z1], [rB, z1], [rB, z1 - 0.14], [0, z1 - 0.14]], 40, 'z'), mBar);
      for (const z of [0.11, 0.23]) add(elev, lathe([[L.r - 0.001, z - 0.005], [L.r + 0.002, z - 0.005], [L.r + 0.002, z + 0.005], [L.r - 0.001, z + 0.005]], 40, 'z'), mGun);
      // gas reservoir along the outer top, valve block at the breech, the slot the line runs out of
      add(elev, new THREE.CylinderGeometry(0.0105, 0.0105, 0.13, 20).rotateX(Math.PI / 2), mGun, [0.0175, 0.017, 0.095]);
      for (const z of [0.03, 0.16]) add(elev, new THREE.SphereGeometry(0.0105, 16, 8), mGun, [0.0175, 0.017, z]);
      add(elev, rb(0.03, 0.026, 0.032, 0.005), M('brass', 'anchors', `launcher${R}`), [0.006, 0.02, 0.004]);
      add(elev, rb(0.002, 0.0055, 0.15, 0.0008), M('rubber', 'anchors', `launcher${R}`), [-L.r, 0, z1 - 0.08]);
      add(elev, new THREE.CylinderGeometry(0.011, 0.011, 0.01, 20).rotateZ(Math.PI / 2), mGun, [-L.r - 0.003, 0, 0]);
      sd.muzzleLocal = new V3(0, 0, z1);
    }
    // the yoke from the side fitting down to the trunnion pin (static: the barrel turns in it)
    {
      const a = new V3(0.197, 0.07, 0);
      const b = new V3(L.pivot[0] - L.r - 0.006, L.pivot[1], 0);
      const lk = add(side, rb(0.008, a.distanceTo(b) + 0.012, 0.022, 0.003), mHarn, [(a.x + b.x) / 2, (a.y + b.y) / 2, 0]);
      lk.rotation.z = Math.atan2(-(b.x - a.x), b.y - a.y) + Math.PI;
      add(side, new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 14).rotateZ(Math.PI / 2), M('steel', 'harness', `hip${R}`), [L.pivot[0] - 0.024, L.pivot[1], 0]);
    }
    label(`launcher${R}`, 'Anchor launcher', `gas piston, ${P.anchor.v0} m/s, ${P.anchor.gas * 1000} g per shot`, 'anchors', elev, [0, L.r + 0.002, 0.2]);
    // the anchor: a titanium helical spike with a steel tip, swivel and eye, seated with its point out of the muzzle
    const anchor = exv(grp(elev, [0, 0, L.z0 + P.anchor.barrel + 0.04 - P.anchor.len]), [0, 0, 0.14], 0.35);
    groups.anchors.push(anchor);
    {
      const AL = P.anchor.len;
      const r = P.anchor.d / 2;
      const mTi = M('steel', 'anchors', `anchor${R}`, {color: '#b4b8bd'});
      add(anchor, lathe([[0, 0.002], [r - 0.0012, 0.002], [r, 0.008], [r, AL - 0.04], [0, AL - 0.04]], 24, 'z'), mTi);
      add(anchor, lathe([[0, AL - 0.041], [r - 0.0002, AL - 0.041], [0, AL]], 24, 'z', 0.0004), M('darkSteel', 'anchors', `anchor${R}`));
      const hp = [];
      for (let i = 0; i <= 120; i++) {
        const f = i / 120;
        const a = f * 4 * TAU;
        const rr = r + 0.0008 - f * 0.001;
        hp.push([Math.cos(a) * rr, Math.sin(a) * rr, 0.02 + f * (AL - 0.065)]);
      }
      add(anchor, tube(hp, 0.0016, 160, 6), mTi);
      add(anchor, new THREE.CylinderGeometry(0.0045, 0.0045, 0.012, 14).rotateX(Math.PI / 2), M('steel', 'anchors', `anchor${R}`), [0, 0, -0.003]);
      add(anchor, new THREE.TorusGeometry(0.0055, 0.0017, 8, 16), M('steel', 'anchors', `anchor${R}`), [0, 0, -0.014], [0, Math.PI / 2, 0]);
    }
    sd.anchor = anchor;
    label(`anchor${R}`, 'Ti helical anchor', `${P.anchor.mass} kg, ${P.anchor.hold / 1000} kN hold`, 'anchors', anchor, [0, 0.009, 0.15]);

    // ---------------------------------------------------------- the blade magazine
    const mag = exv(grp(side, G.mag), [0.19, -0.11, 0], 0);
    groups.blades.push(mag);
    {
      const MG = P.magazine;
      const mB = M('steel', 'blades', `magazine${R}`);
      const mK = M('darkSteel', 'blades', `magazine${R}`);
      const mS = M('gunmetal', 'blades', `magazine${R}`);
      const hw = MG.w / 2;
      add(mag, rb(MG.w - 0.018, MG.h, MG.len, 0.006), mB, [-0.009, 0, 0]);
      const wall = shapeOf(rrect(MG.len - 0.003, MG.h - 0.003, 0.006));
      wall.holes.push(pathOf(rrect(0.3, 0.044, 0.004, 0.03, 0)));
      const wg = extrude(wall, 0.0035, 0.0012);
      wg.rotateY(Math.PI / 2);
      add(mag, wg, mB, [hw - 0.003, 0, 0]);
      for (const y of [-1, 1]) add(mag, rb(0.016, 0.004, MG.len - 0.006, 0.0015), mB, [hw - 0.011, y * (MG.h / 2 - 0.0035), 0]);
      for (const z of [-1, 1]) add(mag, rb(0.016, MG.h - 0.004, 0.004, 0.0015), mB, [hw - 0.011, 0, z * (MG.len / 2 - 0.003)]);
      const ribs = new Bag();
      for (let i = 0; i < 13; i++) ribs.add(rb(0.0035, 0.046, 0.0045, 0.001), [hw - 0.0025, 0, -0.03 - 0.135 + i * 0.0225]);
      add(mag, ribs.geo(), mK);
      // two spare blades in the gap behind the window (the 0.8 m blade does not fit the 0.7 m box: drawn 0.68 long)
      const BL = P.blade;
      const bev = BL.spine / 2 / Math.tan(BL.edge / 2);
      const run = BL.width / Math.tan(BL.tip);
      const sp = bladeGeo(MG.len - 0.02, BL.width, BL.spine, bev, run);
      for (const [x, y] of [[hw - 0.012, 0.002], [hw - 0.0075, -0.003]]) {
        add(mag, sp.body, M('blade', 'blades', `magazine${R}`), [x, y, -MG.len / 2 + 0.01], [0, -Math.PI / 2, 0]);
        add(mag, sp.edge, M('blade', 'blades', `magazine${R}`, {color: HEX.bladeEdge}, 'edge'), [x, y, -MG.len / 2 + 0.01], [0, -Math.PI / 2, 0]);
      }
      // the rear slot the handle head plunges into, and the front cap
      const slot = shapeOf(rrect(0.046, 0.082, 0.008));
      slot.holes.push(pathOf(rrect(0.03, 0.066, 0.004)));
      add(mag, extrude(slot, 0.006, 0.0012), mS, [0, 0, -MG.len / 2 - 0.003]);
      add(mag, rb(0.03, 0.066, 0.004, 0.0015), M('rubber', 'blades', `magazine${R}`), [0, 0, -MG.len / 2 - 0.0012]);
      add(mag, rb(MG.w + 0.003, MG.h + 0.003, 0.012, 0.004), mK, [0, 0, MG.len / 2 - 0.004]);
      const fb = new Bag();
      for (const [x, y] of [[-0.018, -0.032], [0.018, -0.032], [-0.018, 0.032], [0.018, 0.032]]) fb.add(hexBolt(0.0032, 0.003), [x, y, MG.len / 2 + 0.003], [Math.PI / 2, 0, 0]);
      add(mag, fb.geo(), mS);
      // three slotted bracket bands at 10, 47 and 83 % of the length; the middle one also wraps the bottle
      const band = shapeOf(rrect(MG.w + 0.0075, MG.h + 0.0075, 0.008));
      band.holes.push(pathOf(rrect(MG.w + 0.0005, MG.h + 0.0005, 0.005)));
      const bandG = extrude(band, 0.022, 0.001);
      const plate = shapeOf(rrect(0.028, 0.14, 0.008, 0, 0.005));
      plate.holes.push(pathOf(rrect(0.008, 0.1, 0.004, 0, 0.008)));
      const plateG = extrude(plate, 0.0035, 0.001);
      plateG.rotateY(Math.PI / 2);
      const bc = new V3(G.bottle.c[0] - G.mag[0], G.bottle.c[1] - G.mag[1], G.bottle.c[2] - G.mag[2]);
      const bandB = shapeOf(circlePts(G.bottle.r + 0.0035, 48));
      bandB.holes.push(pathOf(circlePts(G.bottle.r + 0.0003, 48)));
      const bandBG = extrude(bandB, 0.022, 0.001);
      for (const f of [0.1, 0.47, 0.83]) {
        const z = -MG.len / 2 + f * MG.len;
        add(mag, bandG, mS, [0, 0, z]);
        add(mag, plateG, mS, [hw + 0.0055, 0, z]);
        if (f === 0.47) sd.band47 = {g: bandBG, z: z - bc.z};
      }
      // saddles that cradle the bottle on the box between the bands
      for (const z of [bc.z - 0.15, bc.z + 0.15]) add(mag, rb(0.05, 0.01, 0.018, 0.003), mK, [bc.x, MG.h / 2 + 0.004, z]);
    }
    label(`magazine${R}`, 'Blade magazine', `${P.magazine.spares} spares, rear slot swaps a blade`, 'blades', mag, [P.magazine.w / 2, -0.01, 0.12]);

    // ---------------------------------------------------------- the Type IV gas bottle with valve and regulator
    const bottle = exv(grp(side, G.bottle.c), [0.19, 0.02, 0], 0.05);
    groups.tanks.push(bottle);
    {
      const r = G.bottle.r;
      const hl = G.bottle.len / 2;
      const prof = [[0, -hl]];
      for (let i = 1; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        prof.push([r * Math.sin(a), -hl + 0.034 * (1 - Math.cos(a))]);
      }
      for (let i = 8; i >= 1; i--) {
        const a = (i / 8) * (Math.PI / 2);
        prof.push([r * Math.sin(a), hl - 0.034 * (1 - Math.cos(a))]);
      }
      prof.push([0, hl]);
      add(bottle, lathe(prof, 48, 'z', 0.0004), M('carbon', 'tanks', `bottle${R}`, {bumpMap: weave, bumpScale: 0.8, roughness: 0.46}));
      const mSt = M('steel', 'tanks', `bottle${R}`);
      add(bottle, lathe([[0, hl - 0.004], [0.014, hl - 0.004], [0.014, hl + 0.012], [0.011, hl + 0.016], [0, hl + 0.016]], 24, 'z'), mSt);
      add(bottle, lathe([[0, -hl - 0.008], [0.01, -hl - 0.008], [0.012, -hl + 0.004], [0, -hl + 0.004]], 24, 'z'), mSt);
      add(bottle, rb(0.03, 0.032, 0.03, 0.005), M('brass', 'tanks', `bottle${R}`), [0, 0, hl + 0.031]);
      add(bottle, new THREE.TorusGeometry(0.011, 0.0028, 8, 20), M('rubber', 'tanks', `bottle${R}`), [0.021, 0, hl + 0.031], [0, Math.PI / 2, 0]);
      add(bottle, new THREE.CylinderGeometry(0.0025, 0.0025, 0.012, 8).rotateZ(Math.PI / 2), mSt, [0.017, 0, hl + 0.031]);
      // the strap rings: the middle bracket band and the two saddle straps
      const mBd = M('gunmetal', 'tanks', `bottle${R}`);
      add(bottle, sd.band47.g, mBd, [0, 0, sd.band47.z]);
      for (const z of [-0.15, 0.15]) add(bottle, new THREE.TorusGeometry(r + 0.0015, 0.0018, 6, 40), mBd, [0, 0, z]);
    }
    const reg = grp(bottle, [0, 0, G.bottle.len / 2 + 0.047]);
    {
      const mRg = M('steel', 'tanks', `regulator${R}`);
      add(reg, lathe([[0, 0], [0.016, 0], [0.016, 0.042], [0.012, 0.046], [0, 0.046]], 28, 'z'), mRg);
      add(reg, new THREE.CylinderGeometry(0.013, 0.013, 0.009, 24), M('darkSteel', 'tanks', `regulator${R}`), [0, 0.019, 0.022]);
      add(reg, new THREE.CylinderGeometry(0.0105, 0.0105, 0.0015, 24), M('blade', 'tanks', `regulator${R}`, {color: '#e9e6df', metalness: 0, roughness: 0.4}), [0, 0.0237, 0.022]);
      add(reg, rb(0.002, 0.0006, 0.008, 0.0002), M('rubber', 'tanks', `regulator${R}`), [0, 0.0247, 0.024], [0, 0.7, 0]);
      add(reg, new THREE.CylinderGeometry(0.005, 0.005, 0.012, 12), mRg, [0, 0.013, 0.04]);
    }
    if (s > 0) label('regulator', 'Regulator', `${P.gas.p0 / 1e5} to ${P.gas.reg / 1e5} bar`, 'tanks', reg, [0, 0.025, 0.022]);
    label(`bottle${R}`, 'Type IV gas bottle', `${P.gas.vol * 1000} L at ${P.gas.p0 / 1e5} bar`, 'tanks', bottle, [0, G.bottle.r, 0]);
    // gas lines: regulator to the launcher trunnion (fed through the pin), regulator to the trim jets under the hub
    {
      const mL = M('copper', 'tanks', `gas${R}`);
      const rc = G.bottle.c;
      const z0 = rc[2] + G.bottle.len / 2 + 0.087;
      add(side, tube([[rc[0], rc[1] + 0.025, z0], [0.232, -0.03, 0.362], [0.234, -0.019, 0.28], [0.233, -0.017, 0.12], [0.226, -0.012, 0.035], [0.222, -0.0, 0.008], [0.222, 0.008, 0.0]], 0.0026, 64, 8), mL);
      add(side, tube([[rc[0] + 0.006, rc[1] + 0.012, z0 + 0.002], [0.256, -0.04, 0.33], [0.265, -0.038, 0.15], [0.265, -0.042, -0.1], [0.24, -0.04, -0.178], [0.17, -0.034, -0.228], [0.09, -0.03, -0.232], [0.052, -0.03, -0.222]], 0.0026, 96, 8), mL);
      recOf.get(mL).line = true;
    }

    // ---------------------------------------------------------- the handle, its blade and its cable, in the hand frame
    const hand = new THREE.Group();
    hand.matrixAutoUpdate = false;
    root.add(hand);
    sd.hand = hand;
    const handle = grp(hand);
    groups.handles.push(handle);
    sd.lever = null;
    sd.cuff = null;
    buildHandle(handle, sd, R);
    const blade = grp(hand, [0.03, 0.07, 0]);
    groups.blades.push(blade);
    sd.blade = blade;
    sd.bladePlane = new THREE.Plane();
    {
      const BL = P.blade;
      const bev = BL.spine / 2 / Math.tan(BL.edge / 2);
      const run = BL.width / Math.tan(BL.tip);
      const bg = bladeGeo(BL.len, BL.width, BL.spine, bev, run);
      const cp = [sd.bladePlane];
      add(blade, bg.body, M('blade', 'blades', `blade${R}`, {clippingPlanes: cp}));
      add(blade, bg.edge, M('blade', 'blades', `blade${R}`, {color: HEX.bladeEdge, clippingPlanes: cp}, 'edge'));
      add(blade, scoreGeo(BL, BL.width, BL.spine, bev, run, BL.len), M('rubber', 'blades', `blade${R}`, {color: HEX.ink, clippingPlanes: cp}));
    }
    label(`blade${R}`, 'Snap-off blade', `${P.blade.len} m ${P.blade.steel}, ${P.blade.scores} score lines`, 'blades', blade, [0.42, 0.02, 0]);
    sd.cable = new DynTube(28, 7, 0.0034);
    {
      const m = add(side, sd.cable.geo, M('rubber', 'handles', `cable${R}`));
      m.frustumCulled = false;
      // the cable leaves the side fitting through a strain-relief boot
      add(side, new THREE.CylinderGeometry(0.0045, 0.007, 0.018, 12), M('rubber', 'handles', `cable${R}`), [G.cableBase[0], G.cableBase[1] - 0.004, G.cableBase[2]], [0, 0, 0]);
    }
    sd.cableOut = new V3(G.cableBase[0], G.cableBase[1] - 0.013, G.cableBase[2]);
    sd.cP1 = new V3();
    sd.cP2 = new V3();
    sd.g = new V3();
    SIDES.push(sd);
  };

  // the pistol-grip handle in the hand frame: x along the blade, y toward the socket, grip down through the fist canted
  // 17 deg back, a receiver block with the blade socket on top-front, a two-window guard with two triggers, the long
  // squeeze lever, a guarded rear hammer, thumb controls, a fold-down forearm cuff and an end cap with the cable boot
  const gDir = new V3(-Math.sin(P.handle.cant), -Math.cos(P.handle.cant), 0);
  const cableStart = gDir.clone().multiplyScalar(0.094);
  function buildHandle(h, sd, R) {
    const mG = M('steel', 'handles', `handle${R}`);
    const mK = M('darkSteel', 'handles', `handle${R}`);
    const mS = M('steel', 'handles', `handle${R}`, {color: '#c3c7cc'}, 'lever');
    add(h, extrude(shapeOf([[-0.064, 0.048], [-0.063, 0.093], [-0.054, 0.103], [0.027, 0.103], [0.043, 0.094], [0.043, 0.046], [0.012, 0.045], [-0.02, 0.048]]), 0.028, 0.002), mG);
    add(h, rb(0.004, 0.048, 0.007, 0.0012), M('rubber', 'handles', `handle${R}`), [0.0442, 0.07, 0]);
    add(h, rb(0.07, 0.006, 0.012, 0.002), mK, [-0.012, 0.1045, 0]);
    for (const z of [-1, 1]) {
      add(h, rb(0.05, 0.03, 0.003, 0.0012), mK, [-0.014, 0.074, z * 0.016]);
      add(h, rb(0.016, 0.008, 0.004, 0.002), M('rubber', 'handles', `handle${R}`), [-0.036, 0.088, z * 0.0175]);
      add(h, new THREE.CylinderGeometry(0.0042, 0.0042, 0.004, 14).rotateX(Math.PI / 2), M('brass', 'handles', `handle${R}`), [-0.012, 0.088, z * 0.0175]);
    }
    // the grip: knurled leather, oval, canted
    const grip = new THREE.CapsuleGeometry(0.0145, 0.094, 6, 20);
    grip.scale(1.12, 1, 0.92);
    add(h, grip, M('grip', 'handles', `handle${R}`, {bumpMap: knurl, bumpScale: 3}), [0, 0, 0], [0, 0, -P.handle.cant]);
    const at = (k) => [gDir.x * k, gDir.y * k, 0];
    add(h, new THREE.CylinderGeometry(0.0165, 0.0152, 0.012, 24), mS, at(0.066), [0, 0, -P.handle.cant]);
    add(h, new THREE.CylinderGeometry(0.0042, 0.0068, 0.022, 12), M('rubber', 'handles', `handle${R}`), at(0.082), [0, 0, -P.handle.cant]);
    add(h, new THREE.TorusGeometry(0.0072, 0.0017, 6, 16), mS, [gDir.x * 0.07 - 0.019, gDir.y * 0.07 + 0.004, 0]);
    // the two-window guard and its triggers
    const gs = shapeOf([[0.022, 0.048], [0.07, 0.048], [0.078, 0.04], [0.076, -0.03], [0.068, -0.04], [-0.008, -0.04]]);
    gs.holes.push(pathOf(rrect(0.034, 0.03, 0.005, 0.05, 0.025)), pathOf(rrect(0.038, 0.031, 0.005, 0.0455, -0.0145)));
    add(h, extrude(gs, 0.011, 0.0015), mK);
    const trg = extrude(shapeOf([[0.049, 0.04], [0.055, 0.04], [0.0535, 0.026], [0.048, 0.016], [0.0435, 0.0165], [0.0485, 0.027]]), 0.006, 0.0008);
    add(h, trg, mS);
    add(h, trg, mS, [-0.004, -0.034, 0]);
    // the squeeze lever, hinged at the front of the guard
    const lever = grp(h, [0.08, 0.036, 0]);
    {
      const c = [[0.0, 0.0], [0.009, -0.03], [0.011, -0.065], [0.006, -0.1], [-0.004, -0.125], [-0.001, -0.137], [0.009, -0.139]];
      const L = [];
      const Rr = [];
      for (let i = 0; i < c.length; i++) {
        const a = c[Math.max(0, i - 1)];
        const b = c[Math.min(c.length - 1, i + 1)];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const n = Math.hypot(dx, dy);
        const w = i > 4 ? 0.0035 : 0.0045;
        L.push([c[i][0] - (dy / n) * w, c[i][1] + (dx / n) * w]);
        Rr.push([c[i][0] + (dy / n) * w, c[i][1] - (dx / n) * w]);
      }
      add(lever, extrude(shapeOf([...L, ...Rr.reverse()]), 0.008, 0.0015), mS);
      add(lever, new THREE.CylinderGeometry(0.0065, 0.0065, 0.016, 16).rotateX(Math.PI / 2), mK);
    }
    sd.lever = lever;
    // the rear hammer (blade eject) and its guard
    add(h, extrude(shapeOf([[-0.058, 0.096], [-0.066, 0.104], [-0.081, 0.119], [-0.087, 0.115], [-0.073, 0.098], [-0.064, 0.09]]), 0.008, 0.001), mK);
    add(h, new THREE.TorusGeometry(0.016, 0.0018, 6, 16, Math.PI * 0.9), mS, [-0.07, 0.1, 0], [0, 0, 0.3]);
    // the fold-down forearm cuff: an open brace (two padded hoops on side bars) hinged under the block's tail; it
    // swings down over the forearm when the arms come up to attack-ready and stands folded behind the hammer at rest
    const cuff = grp(h, [-0.064, 0.047, 0]);
    {
      const A = Math.PI * 0.8;
      const hoop = (R, r) => {
        const g = new THREE.TorusGeometry(R, r, 6, 20, A);
        g.rotateZ(Math.PI / 2 - A / 2);
        g.rotateY(Math.PI / 2);
        return g;
      };
      for (const x of [-0.04, -0.075]) {
        add(cuff, hoop(0.047, 0.0035), mK, [x, -0.047, 0]);
        add(cuff, hoop(0.043, 0.0042), M('leather', 'handles', `handle${R}`), [x, -0.047, 0]);
      }
      const zs = 0.047 * Math.sin(A / 2);
      const ys = -0.047 + 0.047 * Math.cos(A / 2);
      for (const z of [-zs, zs]) {
        const st = add(cuff, rb(0.08, 0.006, 0.004, 0.0015), mK, [-0.04, ys / 2, z]);
        st.rotation.z = Math.atan2(-ys, 0.08) * -1;
      }
      add(cuff, new THREE.CylinderGeometry(0.0035, 0.0035, 2 * zs + 0.01, 10).rotateX(Math.PI / 2), mS);
    }
    sd.cuff = cuff;
    label(`handle${R}`, 'Operation handle', `lever up to ${P.handle.leverMax} N = reel speed`, 'handles', h, [-0.01, 0.104, 0]);
  }

  buildSide(-1);
  buildSide(1);

  // ---------------------------------------------------------------- the rail: one arc hip to centre to hip
  {
    const pts = [];
    const e = new V3();
    const n = new V3();
    for (let i = 0; i <= 40; i++) {
      const t = -1 + (2 * i) / 40;
      eyeAt(Math.abs(t), e);
      normAt(Math.abs(t), n);
      pts.push([Math.sign(t) * e.x - Math.sign(t) * n.x * 0.012, e.y, e.z - n.z * 0.012]);
    }
    const rail = add(harness, tube(pts, 0.0048, 120, 10), M('steel', 'reels', 'rail'));
    groups.reels.push(rail);
  }

  // ---------------------------------------------------------------- per-frame state: reused vectors only
  const fairlead = {L: new V3(), R: new V3()};
  const muzzle = {L: new V3(), R: new V3()};
  const S0 = {wires: [null, null], drive: {angle: 0}, G: {net: 1}, blade: {out: 1}};
  const D0 = {};
  const rest = [new THREE.Matrix4(), new THREE.Matrix4()];
  {
    // the canon rest when no hands are given: fists by the hips, blades back and down
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const x = new V3(0.2 * s, -0.6, -0.77).normalize();
      const y = new V3(0, 0, 1).addScaledVector(x, -x.z).normalize();
      const z = new V3().crossVectors(x, y);
      rest[i].makeBasis(x, y, z).setPosition(0.33 * s, -0.03, 0.06);
    }
  }
  const hl = new THREE.Matrix4();
  const nm3 = new THREE.Matrix3();
  const tv = new V3();
  const tw = new V3();
  const ea = new V3();
  const eb = new V3();
  const nA = new V3();
  const nB = new V3();
  const HUB_AX = new V3(0, 0, 1);
  const HUB_BI = new V3(0, 1, 0);
  const DRUM_AX = new V3(0, 1, 0);
  const DRUM_BI = new V3(-0.35, 0, -1).normalize();
  let cutOn = false;
  // D.working may name a subsystem, a part ('drumR', 'motor') or a family ('drum', 'launcher', 'shuttle', 'clutch'):
  // a part key matches when the working key is it or its prefix up to '.', 'L' or 'R'
  const SEP = {46: 1, 76: 1, 82: 1};
  // the cut: two planes through the part's axis that remove the wedge around `bi`, opened to `open` radians by k
  const wedge = (planes, obj, ax, bi, k, open, stop = 0) => {
    const half = (open / 2) * k;
    ea.copy(bi).applyAxisAngle(ax, -half);
    eb.copy(bi).applyAxisAngle(ax, half);
    nA.crossVectors(ea, ax);
    nB.crossVectors(ax, eb);
    nm3.getNormalMatrix(obj.matrixWorld);
    planes[0].set(nA, 0).applyMatrix4(obj.matrixWorld, nm3);
    planes[1].set(nB, 0).applyMatrix4(obj.matrixWorld, nm3);
    // a third plane across the axis stops the cut at depth `stop`: a stepped section seen from behind shows the
    // impeller, the motor's section along the notch and the planetary face-on at its floor
    if (planes[2]) planes[2].set(nA.copy(ax), -stop).applyMatrix4(obj.matrixWorld, nm3);
  };
  for (const r of recs) if (r.cut) r.m.clipIntersection = true;
  // fewer draw calls: static sibling meshes that share a material become one mesh (the shadow and AO passes draw
  // every mesh again, so this roughly halves the rig's cost); meshes the update moves on their own are kept
  const keep = new Set(stages.map((st) => st.m));
  for (const sd of SIDES) keep.add(sd.pack);
  const groupsAll = [];
  root.traverse((o) => !o.isMesh && groupsAll.push(o));
  for (const g of groupsAll) {
    const by = new Map();
    for (const c of g.children) {
      if (!c.isMesh || keep.has(c) || !c.frustumCulled || !c.geometry.attributes.uv) continue;
      if (!by.has(c.material)) by.set(c.material, []);
      by.get(c.material).push(c);
    }
    for (const [m, list] of by) {
      if (list.length < 2) continue;
      const bag = new Bag();
      for (const c of list) {
        c.updateMatrix();
        const geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        bag.list.push(geo.applyMatrix4(c.matrix));
        g.remove(c);
      }
      add(g, bag.geo(), m);
    }
  }
  root.traverse((o) => {
    if (o.isMesh) recOf.get(o.material)?.meshes.push(o);
  });
  const update = (S, D, hands) => {
    S = S || S0;
    D = D || D0;
    root.updateWorldMatrix(true, false);
    rootInv.copy(root.matrixWorld).invert();
    // explode
    const ex = smooth(+D.explode || 0);
    for (let i = 0; i < EX.length; i++) {
      const e = EX[i];
      const k = smooth((ex - e.t0) / (1 - e.t0));
      e.o.position.copy(e.p0).addScaledVector(e.v, k);
    }
    // the drive: motor and impeller on the drive angle, sun on the shaft, carrier at 1/ratio, planets on their pins
    const ang = S.drive ? S.drive.angle || 0 : 0;
    for (let i = 0; i < motorRot.length; i++) motorRot[i].rotation.z = ang;
    sun.rotation.z = ang;
    const car = ang / (1 + ZR / ZS);
    carrier.rotation.z = car;
    for (let i = 0; i < 3; i++) planets[i].rotation.z = -car * (ZR / ZP) + i * 0.7;
    // the cowl: deploys above G.cowlG
    const net = S.G ? S.G.net || 0 : 0;
    const kc = smooth((net - G.cowlG) / 0.6);
    cowlPad.position.set(CW.fold[0], CW.fold[1], CW.fold[2]).addScaledVector(cdir, cTravel * kc);
    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      st.m.position.copy(st.bot).addScaledVector(cdir, 0.05 + (st.k * cTravel * kc) / 3);
    }
    // the sides
    const out = S.blade ? S.blade.out ?? 1 : 1;
    for (let i = 0; i < 2; i++) {
      const sd = SIDES[i];
      const w = S.wires ? S.wires[i] : null;
      const len = w ? w.length || 0 : 0;
      sd.spool.rotation.y = w ? w.spool || 0 : 0;
      sd.clutch.rotation.y = sd.spool.rotation.y;
      // wound radius from the line still on the drum (area of the annulus is proportional to the length wound)
      const on = clamp01(1 - len / P.tether.len);
      const r = Math.sqrt(RL.coreR * RL.coreR + (RL.fillR * RL.fillR - RL.coreR * RL.coreR) * on);
      sd.pack.scale.set(r, 1, r);
      sd.pack.visible = r > RL.coreR + 0.0006;
      // the shuttle on the rail; both rollers stand off the centreline when parked
      const u = Math.max(clamp01(w ? w.shuttle || 0 : 0), 0.075);
      eyeAt(u, sd.eye);
      normAt(u, sd.n);
      sd.shuttle.position.copy(sd.eye);
      sd.shuttle.rotation.set(0, Math.atan2(sd.n.x, sd.n.z), 0);
      const fl = i ? fairlead.R : fairlead.L;
      fl.set(sd.s * sd.eye.x, sd.eye.y, sd.eye.z);
      const rl = sd.railLine;
      for (let k = 0; k <= rl.n; k++) {
        const t = lerp(1, u, k / rl.n);
        eyeAt(t, rl.P[k]);
        normAt(t, tv);
        if (k < rl.n) rl.P[k].addScaledVector(tv, -0.0075);
      }
      rl.build();
      // launcher elevation and the seated anchor
      sd.elev.rotation.x = -Math.min(0.9, Math.max(-0.3, w ? w.aim || 0 : 0));
      const st = w ? w.state : 'stowed';
      sd.anchor.visible = st === 'stowed' || st === undefined || (st === 'retract' && len < 0.4);
      // the hand: world grip frame into the body frame (or the canon rest)
      const hw = hands ? (i ? hands.R : hands.L) : null;
      if (hw) hl.multiplyMatrices(rootInv, hw);
      else hl.copy(rest[i]);
      sd.hand.matrix.copy(hl);
      sd.hand.matrixWorldNeedsUpdate = true;
      sd.lever.rotation.z = -0.24 * clamp01((w ? w.lineSpeed || 0 : 0) / RL.vMax);
      sd.cuff.rotation.z = -(1 - smooth(((S.pose ? S.pose.arms || 0 : 0) - 0.3) / 0.4) * out) * 1.35;
      sd.blade.position.x = 0.03 + (out - 1) * (P.blade.len + 0.04) + ex * 0.12;
      sd.blade.visible = out > 0.002;
      // the cable: out of the end cap along the grip, down out of the side fitting's boot
      const c = sd.cable;
      c.P[0].copy(cableStart).applyMatrix4(hl);
      sd.g.copy(gDir).transformDirection(hl);
      sd.cP1.copy(c.P[0]).addScaledVector(sd.g, 0.1);
      tw.set(sd.s * sd.cableOut.x, sd.cableOut.y, sd.cableOut.z);
      sd.cP2.set(tw.x + sd.s * 0.03, tw.y - 0.11, tw.z + 0.02);
      tv.copy(c.P[0]);
      for (let k = 0; k <= c.n; k++) bez(c.P[k], tv, sd.cP1, sd.cP2, tw, k / c.n);
      // the side group is mirrored: author the cable in its own frame
      for (let k = 0; k <= c.n; k++) c.P[k].x *= sd.s;
      c.build();
    }
    root.updateMatrixWorld(true);
    // reported points: fairleads, nozzle, muzzles (body frame)
    nozzleOut.pos.set(0, 0, -0.004).applyMatrix4(nozzle.matrixWorld).applyMatrix4(rootInv);
    nozzleOut.dir.set(0, 0, -1).transformDirection(nozzle.matrixWorld).transformDirection(rootInv);
    for (let i = 0; i < 2; i++) {
      const sd = SIDES[i];
      (i ? muzzle.R : muzzle.L).copy(sd.muzzleLocal).applyMatrix4(sd.elev.matrixWorld).applyMatrix4(rootInv);
      // the blade comes out of its socket: everything behind the block's front face is clipped
      nm3.getNormalMatrix(sd.hand.matrixWorld);
      sd.bladePlane.set(tv.set(1, 0, 0), -0.0445).applyMatrix4(sd.hand.matrixWorld, nm3);
    }
    // cutaway: the hub's top-right quarter and the right drum's back-top quarter, swept open by D.cutaway
    const ck = clamp01(+D.cutaway || 0);
    const on = ck > 0.001;
    if (on) {
      wedge(CUT.hub, hub, HUB_AX, HUB_BI, smooth(ck), 120 * D2R, 0.031);
      wedge(CUT.drum, SIDES[1].drum, DRUM_AX, DRUM_BI, smooth(ck), 100 * D2R);
    }
    if (on !== cutOn) {
      cutOn = on;
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        if (!r.cut) continue;
        r.m.clippingPlanes = on ? CUT[r.cut] : null;
        r.m.side = on ? THREE.DoubleSide : THREE.FrontSide;
        r.m.needsUpdate = true;
      }
    }
    // the look: isolate keeps one subsystem solid and tinted, fades the rest; the working part takes the accent;
    // guide tubes and gas lines fade out while the parts they join fly apart
    const iso = D.isolate || null;
    const ik = iso ? clamp01(D.isolateK ?? 1) : 0;
    const work = D.working || null;
    const lineA = 1 - smooth(ex * 4);
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      let k = 0;
      let a = 1;
      if (iso) {
        if (r.g === iso) k = 0.3 * ik * r.w;
        else a = 1 - 0.88 * ik;
      }
      if (work) {
        if (r.p === work || (r.p.length > work.length && SEP[r.p.charCodeAt(work.length)] && r.p.startsWith(work))) k = 1;
        else if (r.g === work) k = r.w;
      }
      if (r.line) a *= lineA;
      if (k !== r.k) {
        r.k = k;
        const m = r.m;
        m.color.copy(m.userData.base).lerp(ACC, k * 0.85);
        m.emissive.copy(ACC).multiplyScalar(k * k * 0.18);
      }
      if (a !== r.a) {
        const m = r.m;
        const f = a < 0.999;
        if (m.transparent !== f) {
          m.transparent = f;
          m.needsUpdate = true;
        }
        m.opacity = a;
        m.depthWrite = !f || a > 0.6;
        for (let j = 0; j < r.meshes.length; j++) {
          r.meshes[j].castShadow = a > 0.5;
          r.meshes[j].visible = a > 0.004;
        }
        r.a = a;
      }
    }
  };
  update(null, null, null);

  return {
    root,
    groups,
    fairlead,
    nozzle: nozzleOut,
    labels,
    update,
    // extras for fx and the integrator: where a seated anchor's tip sits, the cut planes (world space)
    muzzle,
    clip: CUT,
  };
}
