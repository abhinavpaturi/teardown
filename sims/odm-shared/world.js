// The arena, built from P.world: the named giant trees (lathed sequoia trunks with buttress roots, bark furrows and
// long straight standing branches), instanced fill trees kept out of the flight corridor, a pale forest floor with a
// worn path, and a 15 m timber training dummy on a skid sled whose nape pad the rider slices.
// Trunks, branches and the nape are built on the same functions the physics uses for anchor hits and footing
// (trunkRadiusAt, branchAxis, branchTopAt, napeFrame in physics.js), so a bite or a boot lands on the bark that is
// drawn: bark furrows only cut inward from that envelope; buttresses and roots bulge out below ~8 m and the bark
// swells into a collar round each branch root.
// update(S, D) is pure: it poses the cut slab from S.blade.cut and the cut time, sways the canopy with S.tau and
// fades the world toward the haze while a subsystem is isolated. No per-frame allocation.
import * as THREE from 'three';
import {rng} from 'teardown-kit/util.js';
import {branchAxis, branchTopAt, napeFrame, trunkRadiusAt} from './physics.js';
import {COL} from './stage.js';

export {branchAxis, branchTopAt, napeFrame, trunkRadiusAt};

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

// ------------------------------------------------------------ pure geometry (no three.js), shared with the physics
/** Height of the trunk's closing cone above the tree's listed height, × scale (inside the canopy; the physics stops at h). */
export const TRUNK_TIP = 4;

/** Branch j of tree i: radius `along` metres from the trunk axis, the physics capsule (r0·s at the axis, 0.35·r0·s at L). */
export function branchRadiusAt(P, i, j, along) {
  const br = branchAxis(P, i, j);
  return lerp(br.r0, br.r1, clamp(along / br.len, 0, 1));
}

const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax;
  const dz = bz - az;
  const k = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - ax - dx * k, pz - az - dz * k);
};
/** Horizontal distance from (x, z) to the corridor polyline. */
export function corridorDist(P, x, z) {
  const c = P.world.corridor;
  let d = Infinity;
  for (let i = 0; i < c.length - 1; i++) d = Math.min(d, segDist(x, z, c[i][0], c[i][1], c[i + 1][0], c[i + 1][1]));
  return d;
}
const corridorBox = (W) => {
  const xs = W.corridor.map((p) => p[0]);
  const zs = W.corridor.map((p) => p[1]);
  return {cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2};
};

// best-candidate (Mitchell) sampling: well spread like Poisson discs, always reaches the count
function scatter(P, r, count, inside, minD, pts) {
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    let best = null;
    let bestD = -1;
    for (let k = 0; k < 16; k++) {
      const c = inside(r);
      if (!c) continue;
      let d = Infinity;
      for (const p of pts) d = Math.min(d, Math.hypot(c[0] - p.x, c[1] - p.z) - (p.pad || 0));
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best && bestD > minD) {
      pts.push({x: best[0], z: best[1]});
      out.push({x: best[0], z: best[1]});
    }
  }
  return out;
}

/**
 * The fill trees: P.world.fill.count trunks spread ~fill.spacing apart over a fill.extent square centred on the
 * corridor, never within corridorW/2 + a base radius + 4 m of the corridor line, nor in the clearing, nor near a named
 * tree's branches. Deterministic from P.world.seed. Each: {x, z, s, h, rot, v (variant 0..2), tint}.
 */
export function fillTrees(P) {
  const W = P.world;
  const F = W.fill;
  const {cx, cz} = corridorBox(W);
  const half = F.extent / 2;
  const keep = W.corridorW / 2 + 4.6 * 1.05 + 4;
  const pts = W.trees.map((t) => ({x: t.x, z: t.z, pad: 9}));
  const inside = (r) => {
    const x = cx + (r() * 2 - 1) * half;
    const z = cz + (r() * 2 - 1) * half;
    if (corridorDist(P, x, z) < keep) return null;
    if (Math.hypot(x - W.clearing.x, z - W.clearing.z) < W.clearing.r + 6) return null;
    return [x, z];
  };
  const out = scatter(P, rng(W.seed * 7 + 3), F.count, inside, F.spacing * 0.55, pts);
  const q = rng(W.seed * 13 + 5);
  for (const t of out) Object.assign(t, {s: 0.78 + 0.27 * q(), h: 70 + 18 * q(), rot: q() * TAU, v: Math.floor(q() * 3), tint: 0.92 + 0.12 * q()});
  return out;
}
// a cheaper ring of trees beyond the fill square so the forest never ends at the haze line
function farTrees(P) {
  const W = P.world;
  const F = W.fill;
  const {cx, cz} = corridorBox(W);
  const h0 = F.extent / 2 + 12;
  const h1 = F.extent / 2 + 260;
  const inside = (r) => {
    const x = cx + (r() * 2 - 1) * h1;
    const z = cz + (r() * 2 - 1) * h1;
    return Math.max(Math.abs(x - cx), Math.abs(z - cz)) < h0 ? null : [x, z];
  };
  const out = scatter(P, rng(W.seed * 17 + 11), Math.round(F.count * 1.6), inside, F.spacing * 0.6, fillTrees(P).map((t) => ({x: t.x, z: t.z})));
  const q = rng(W.seed * 19 + 1);
  for (const t of out) Object.assign(t, {s: 0.8 + 0.3 * q(), h: 72 + 18 * q(), rot: q() * TAU, tint: 0.95 + 0.08 * q()});
  return out;
}

// ------------------------------------------------------------ palette (research/visual.md: forest, dummy)
const PAL = {
  barkLow: '#b8a58e',
  barkHigh: '#ddd1c1',
  barkTop: '#e4dbcf',
  furrow: '#8c7766',
  damp: '#9a8771',
  red: '#9a5e43',
  branch: '#d0c1ab',
  leaf: ['#a7b9a0', '#b4c4ab', '#9eb197', '#bccab4'],
  leafLight: '#d3dccb',
  fern: '#a8b59a',
  fernDark: '#7d8f6e',
  floor: '#bcbeb8', // COL.ground darkened and cooled: the warm 2.9 sun renders it close to the stage's #d9d3c4
  raw: '#e6d6ba',
  path: '#cfccc2',
  clearing: '#c2c7b5',
  dampG: '#a89f8f',
  moss: '#a9b39a',
  pine: ['#c8a97e', '#bc9c70', '#c3a476'],
  seam: '#8a6e4b',
  iron: '#3d4045',
  strap: '#4a2f22',
  rope: '#cdbb94',
  pad: '#84442c',
  strip: '#ede3cf',
  cut: '#cfae74',
  brass: '#d2b26e',
  paint: '#3a2e28',
};
const C = (hex) => new THREE.Color(hex);

// ------------------------------------------------------------ value noise, periodic in x when asked
function makeNoise(seed) {
  const r = rng(seed);
  const T = new Float32Array(256);
  const Pm = new Uint8Array(512);
  const p = Array.from({length: 256}, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) Pm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) T[i] = r();
  const L = (i, j) => T[Pm[Pm[i & 255] + (j & 255)]];
  return (x, y, per = 0) => {
    let i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    let i1 = i + 1;
    if (per) {
      i = ((i % per) + per) % per;
      i1 = ((i1 % per) + per) % per;
    }
    return lerp(lerp(L(i, j), L(i1, j), u), lerp(L(i, j + 1), L(i1, j + 1), u), v);
  };
}
const hash3 = (x, y, z, s) => {
  const v = Math.sin(Math.round(x * 997) * 0.1271 + Math.round(y * 991) * 0.3117 + Math.round(z * 983) * 0.0747 + s * 13.31) * 43758.5453;
  return v - Math.floor(v);
};

// ------------------------------------------------------------ a merged-geometry builder with vertex colours
class Geo {
  constructor() {
    this.p = [];
    this.c = [];
    this.i = [];
  }
  get count() {
    return this.p.length / 3;
  }
  v(x, y, z, col) {
    this.p.push(x, y, z);
    this.c.push(col.r, col.g, col.b);
    return this.p.length / 3 - 1;
  }
  /** A flat quad with its own vertices, wound to face away from the point `inside`. */
  fquad(a, b, c, d, col, inside) {
    const ex = c[0] - a[0], ey = c[1] - a[1], ez = c[2] - a[2];
    const fx = d[0] - b[0], fy = d[1] - b[1], fz = d[2] - b[2];
    const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - inside[0];
    const my = (a[1] + b[1] + c[1] + d[1]) / 4 - inside[1];
    const mz = (a[2] + b[2] + c[2] + d[2]) / 4 - inside[2];
    if (nx * mx + ny * my + nz * mz < 0) [b, d] = [d, b];
    const i0 = this.v(a[0], a[1], a[2], col);
    const i1 = this.v(b[0], b[1], b[2], col);
    const i2 = this.v(c[0], c[1], c[2], col);
    const i3 = this.v(d[0], d[1], d[2], col);
    this.i.push(i0, i1, i2, i0, i2, i3);
  }
  ftri(a, b, c, col) {
    const i0 = this.v(a[0], a[1], a[2], col);
    this.i.push(i0, this.v(b[0], b[1], b[2], col), this.v(c[0], c[1], c[2], col));
  }
  /** Append a three.js geometry under matrix m with one colour. */
  geom(g, m, col) {
    const pos = g.attributes.position;
    const base = this.count;
    const v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k);
      if (m) v.applyMatrix4(m);
      this.v(v.x, v.y, v.z, col);
    }
    if (g.index) for (const ix of g.index.array) this.i.push(base + ix);
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    g.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
const M4 = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// a tube through rings [{x, y, z, r, ey}]: ring point = c + r·m·(U·ey·cos φ + S·sin φ), U the up-most normal (φ = 0 on
// top), S = T × U, so on a vertical trunk φ is the azimuth (0 = +z, toward +x). o.shape(k, j, φ, out{m, g}) shapes,
// o.color(k, j, g, col) colours; capEnd = tip length beyond the last ring.
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();
function tube(G, rings, segs, o) {
  const n = rings.length;
  const rows = [];
  const sh = {m: 1, g: 0};
  const T = [];
  for (let k = 0; k < n; k++) {
    const A = rings[Math.max(0, k - 1)];
    const B = rings[Math.min(n - 1, k + 1)];
    const R = rings[k];
    _t.set(B.x - A.x, B.y - A.y, B.z - A.z).normalize();
    _u.set(0, 1, 0).addScaledVector(_t, -_t.y);
    if (_u.lengthSq() < 1e-6) _u.set(0, 0, 1).addScaledVector(_t, -_t.z);
    _u.normalize();
    _s.crossVectors(_t, _u);
    T.push([_t.x, _t.y, _t.z]);
    const ey = R.ey ?? 1;
    const row = [];
    for (let j = 0; j < segs; j++) {
      const ph = (j / segs) * TAU;
      const cp = Math.cos(ph) * ey;
      const sp = Math.sin(ph);
      sh.m = 1;
      sh.g = 0;
      if (o.shape) o.shape(k, j, ph, sh);
      const rr = R.r * sh.m;
      row.push(G.v(R.x + rr * (_u.x * cp + _s.x * sp), R.y + rr * (_u.y * cp + _s.y * sp), R.z + rr * (_u.z * cp + _s.z * sp), o.color(k, j, sh.g, _col)));
    }
    rows.push(row);
  }
  for (let k = 0; k < n - 1; k++)
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      G.i.push(rows[k][j], rows[k][j1], rows[k + 1][j1], rows[k][j], rows[k + 1][j1], rows[k + 1][j]);
    }
  if (o.capEnd) {
    const R = rings[n - 1];
    const t = T[n - 1];
    const tip = G.v(R.x + t[0] * o.capEnd, R.y + t[1] * o.capEnd, R.z + t[2] * o.capEnd, o.color(n - 1, 0, 0, _col));
    for (let j = 0; j < segs; j++) G.i.push(rows[n - 1][j], rows[n - 1][(j + 1) % segs], tip);
  }
}

// a flat-shaded, slightly lumpy squashed icosahedron: one canopy puff
const ICO = [new THREE.IcosahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 1)];
const _lightC = new THREE.Color();
function puff(G, cx, cy, cz, rx, ry, rz, col, light, detail, seed, rot) {
  const pos = ICO[detail].attributes.position;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const P3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let f = 0; f < pos.count; f += 3) {
    for (let q = 0; q < 3; q++) {
      const x = pos.getX(f + q);
      const y = pos.getY(f + q);
      const z = pos.getZ(f + q);
      const j = 1 + 0.2 * (hash3(x, y, z, seed) - 0.5);
      const X = x * j * rx;
      const Z = z * j * rz;
      P3[q][0] = cx + X * cr + Z * sr;
      P3[q][1] = cy + y * j * ry * (y < 0 ? 0.8 : 1);
      P3[q][2] = cz - X * sr + Z * cr;
    }
    const ny = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    _col.copy(col).multiplyScalar(0.94 + 0.1 * hash3(f, seed, 1, 7));
    _col.lerp(_lightC.copy(light), 0.35 * Math.max(0, ny));
    G.ftri(P3[0], P3[1], P3[2], _col);
  }
}

// ------------------------------------------------------------ trees
// A trunk: rings from below the ground to the top, the envelope radius rAt(y) (the physics' trunk), widened by
// buttress lobes near the ground, cut inward by vertical bark furrows, closed by a cone tip inside the canopy.
function trunk(G, o) {
  const {x, z, s, h, rAt, segs, nz} = o;
  const ys = [-1.2, -0.4];
  for (let y = 0; y < 3; y += o.baseStep ?? 0.3) ys.push(y);
  for (let y = 3; y < 10; y += o.step * 0.5) ys.push(y);
  for (let y = 10; y < h - 0.5; y += o.step) ys.push(y);
  for (const b of o.bumps || []) for (let y = b.y - 2.6 * b.rb; y <= b.y + 2.6 * b.rb; y += 0.35) ys.push(y);
  ys.sort((a, b) => a - b);
  for (let k = ys.length - 1; k > 0; k--) if (ys[k] - ys[k - 1] < 0.12) ys.splice(k, 1);
  ys.push(h);
  const tip = TRUNK_TIP * s;
  ys.push(h + tip * 0.4, h + tip * 0.75);
  const rTop = rAt(h - 1e-6);
  const rings = ys.map((y) => ({x, y, z, r: y <= h ? rAt(clamp(y, 0, h - 1e-6)) : rTop * (1 - (y - h) / tip)}));
  const lobe = new Float32Array(segs);
  for (let j = 0; j < segs; j++) {
    const th = (j / segs) * TAU;
    for (const L of o.lobes) {
      const c = Math.cos(th - L.a);
      if (c > 0) lobe[j] += L.amp * Math.pow(c, L.p);
    }
  }
  const lo = C(PAL.barkLow);
  const hi = C(PAL.barkHigh);
  const top = C(PAL.barkTop);
  const fur = C(PAL.furrow);
  const red = C(PAL.red);
  const damp = C(PAL.damp);
  tube(G, rings, segs, {
    capEnd: tip * 0.25,
    shape(k, j, ph, out) {
      const y = rings[k].y;
      const r = rings[k].r;
      const fb = y <= 0 ? 1 : Math.exp(-y / (2.5 * s));
      let g = 0;
      if (o.ridges) {
        const u = (j * o.ridges) / segs + 0.9 * nz((j / segs) * 6, y / 9, 6) + y * o.twist;
        const fr = u - Math.floor(u);
        const w = 0.12 + 0.08 * nz((j / segs) * 11 + 3, y / 4, 11);
        g = Math.exp(-((fr - 0.5) * (fr - 0.5)) / (w * w));
        const dn = nz((j / segs) * 9 + 7, y / 2.5 + 11, 9);
        const dep = o.depth * (0.4 + 0.8 * dn) * Math.min(1, r / 1.2);
        out.m = 1 + lobe[j] * fb - (dep * g) / Math.max(r, 0.05);
        // the colour furrow is narrower and darker than the shape groove, so it reads as a crack in the bark
        g = Math.pow(g, 2.5) * (0.45 + 0.75 * dn);
      } else out.m = 1 + lobe[j] * fb;
      for (const b of o.bumps || []) {
        let da = (j / segs) * TAU - b.a;
        da -= TAU * Math.round(da / TAU);
        const dx = da * r;
        const dy = y - b.y;
        out.m += (0.38 * b.rb * Math.exp(-(dx * dx + dy * dy * 0.7) / (1.6 * b.rb * b.rb))) / Math.max(r, 0.05);
      }
      out.g = g;
    },
    color(k, j, g, col) {
      const y = rings[k].y;
      const kh = sstep(0, 10, y);
      col.copy(lo).lerp(hi, kh);
      if (y > 50) col.lerp(top, sstep(50, 86, y) * 0.6);
      col.multiplyScalar(0.93 + 0.13 * nz((j / segs) * 4 + 1.3, y / 13 + 5, 4));
      // fine fibrous streaks between the furrows
      const st = (j * 2.7) % 3;
      col.multiplyScalar(st < 1 ? 0.93 + 0.05 * nz(j * 0.37, y / 3, 0) : 1);
      col.lerp(fur, Math.min(1, g));
      col.lerp(red, 0.14 * g * (1 - 0.4 * kh));
      if (y < 1.6) col.lerp(damp, (1 - Math.max(0, y) / 1.6) * 0.5);
      return col;
    },
  });
  return rings;
}

// surface roots running out of the buttress lobes and diving under the floor
function roots(G, o, avoid) {
  const {x, z, s, lobes, r, segs} = o;
  const base = 4.6 * s;
  const lo = C(PAL.barkLow);
  const damp = C(PAL.damp);
  for (const L of lobes) {
    let reach = base * (0.95 + 0.75 * r()) * (0.7 + L.amp);
    const bend = (r() - 0.5) * 0.4;
    // shorten a root that would run under the dummy's sled
    const ex = x + Math.sin(L.a) * (base * 0.45 + reach);
    const ez = z + Math.cos(L.a) * (base * 0.45 + reach);
    if (avoid && Math.hypot(ex - avoid.x, ez - avoid.z) < avoid.r) reach = Math.max(base * 0.4, reach - (avoid.r - Math.hypot(ex - avoid.x, ez - avoid.z)));
    const rings = [];
    const n = o.n ?? 11;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const d = base * 0.45 + t * reach;
      const a = L.a + bend * Math.sin(Math.PI * t);
      rings.push({x: x + Math.sin(a) * d, y: 2.4 * s * Math.pow(1 - t, 1.8) - 0.35 * s * t, z: z + Math.cos(a) * d, r: s * (0.95 - 0.82 * t) * (0.7 + 0.6 * L.amp), ey: 0.6});
    }
    tube(G, rings, segs, {capEnd: 0.3 * s, color: (k, j, g, col) => col.copy(lo).lerp(damp, 0.35 + 0.4 * (k / n))});
  }
}

const lobeSet = (r, n) =>
  Array.from({length: n}, (_, k) => ({a: (k / n) * TAU + (r() - 0.5) * 0.6, amp: 0.2 + 0.26 * r(), p: 4 + 6 * r()}));

// a sequoia crown: rounded clumps on a spiral round the upper trunk, wide low down, closing over the tip
function crown(GC, x, z, s, h, r, n, detail, seed) {
  const leaf = PAL.leaf.map(C);
  const light = C(PAL.leafLight);
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const y = k === n - 1 ? h + 1 : lerp(0.76 * h, h + 2.5, Math.pow(u, 0.85)) + (r() - 0.5) * 2;
    const a = k * 2.4 + r() * 0.8;
    const off = k === n - 1 ? 0 : lerp(5.5, 0.8, u) * s * (0.8 + 0.4 * r());
    const rad = lerp(6.8, 3.6, u) * s * (0.85 + 0.3 * r());
    puff(GC, x + Math.sin(a) * off, y, z + Math.cos(a) * off, rad, rad * (0.6 + 0.16 * r()), rad * (0.9 + 0.2 * r()), leaf[Math.floor(r() * 4)], light, detail, seed + k, r() * TAU);
  }
}

// one named tree: trunk, roots, the physics' straight branches (with sub-limbs), the crown
function namedTree(G, GC, P, i, avoid) {
  const W = P.world;
  const t = W.trees[i];
  const r = rng(W.seed + 101 * (i + 1));
  const nz = makeNoise(W.seed + 31 * (i + 1));
  const lobes = lobeSet(r, 6 + Math.floor(r() * 3));
  const bumps = t.branches.map((b) => ({y: b[0], a: b[1], rb: b[3] * t.s}));
  trunk(G, {x: t.x, z: t.z, s: t.s, h: t.h, bumps, rAt: (y) => trunkRadiusAt(P, i, y), segs: 120, step: 2.0, ridges: 22 + Math.floor(r() * 6), depth: 0.1 * t.s, twist: (r() - 0.5) * 0.012, lobes, nz});
  roots(G, {x: t.x, z: t.z, s: t.s, lobes, r, segs: 12, n: 11}, avoid);

  const bc = C(PAL.branch);
  const fur = C(PAL.furrow);
  const trunkC = C(PAL.barkHigh);
  const rawC = C(PAL.raw);
  const leaf = PAL.leaf.map(C);
  const light = C(PAL.leafLight);
  const land = W.landing ? [W.trees.findIndex((q) => q.id === W.landing.tree), W.landing.branch] : [-1, -1];
  const info = [];
  t.branches.forEach((b, j) => {
    const br = branchAxis(P, i, j);
    const rT = trunkRadiusAt(P, i, br.a[1]);
    // the people stand on these two: no sub-limbs; a short one ends in a broken stub, a long one sweeps up past L
    const stand = (i === 0 && j === 0) || (i === land[0] && j === land[1]);
    const stub = stand && br.len < 9;
    // exactly the physics capsule from the bark to L, but for a slight fillet at the bark (+15 %, < 1 % past 1 m;
    // the trunk swells round the root to meet it);
    // beyond L a decorative branch sweeps up into a clump of foliage, a standing branch closes with the capsule's tip
    const rings = [];
    const a0 = rT * 0.3;
    const n = Math.ceil((br.len - a0) / 0.5) + 1;
    const ringAt = (al, rr, dy = 0) => ({x: br.a[0] + br.d[0] * al, y: br.a[1] + dy, z: br.a[2] + br.d[2] * al, r: rr, al});
    for (let k = 0; k < n; k++) {
      const al = lerp(a0, br.len, k / (n - 1));
      const collar = 1 + 0.15 * Math.exp(-Math.max(0, al - rT) / 0.35);
      rings.push(ringAt(al, lerp(br.r0, br.r1, al / br.len) * collar));
    }
    let tip = null;
    const nMain = rings.length;
    if (stub) for (const [dl, k] of [[0.04, 1], [0.12, 0.9], [0.2, 0.62], [0.26, 0.3]]) rings.push(ringAt(br.len + dl * br.r1 * 2, br.r1 * k));
    else {
      const E = 0.28 * br.len;
      const rise = 0.24 * br.len;
      for (let k = 1; k <= 8; k++) {
        const u = k / 8;
        rings.push(ringAt(br.len + E * u, br.r1 * lerp(1, 0.32, u), rise * u * u));
      }
      tip = rings[rings.length - 1];
    }
    const N = 9;
    tube(G, rings, 26, {
      capEnd: stub ? br.r1 * 0.05 : br.r1 * 0.3,
      // shallow lengthwise furrows with a ridge on top and a slow inward undulation, all inside the capsule;
      // a stub's end rings splinter
      shape(k, jj, ph, out) {
        const u = (ph / TAU) * N + 0.25 * nz(rings[k].al / 3, j * 7 + i, 0);
        const fr = u - Math.floor(u);
        const g = Math.exp(-((fr - 0.5) * (fr - 0.5)) / 0.02);
        out.m = 1 - 0.06 * g - 0.045 * nz(rings[k].al / 1.7 + 9, j * 3 + i, 0);
        if (k >= nMain) out.m *= 0.75 + 0.5 * hash3(jj, k, j, i);
        out.g = g;
      },
      color(k, jj, g, col) {
        if (k >= nMain && stub) return col.copy(rawC).multiplyScalar(0.9 + 0.12 * hash3(jj, k, 3, i));
        col.copy(trunkC).lerp(bc, sstep(rT, rT + 2.5, rings[k].al));
        col.multiplyScalar(0.96 + 0.06 * nz(rings[k].al / 4, (jj / 26) * 5, 5) - 0.05 * Math.max(0, Math.cos((jj / 26) * TAU + Math.PI)));
        return col.lerp(fur, g * 0.6);
      },
    });
    const clump = (x, y, z, rad, seed) => {
      for (let f = 0; f < 3; f++) {
        const a = f * 2.1 + r();
        const rr = rad * (0.7 + 0.3 * r());
        puff(GC, x + Math.sin(a) * rad * 0.6, y + f * rad * 0.25, z + Math.cos(a) * rad * 0.6, rr, rr * 0.62, rr * 0.9, leaf[Math.floor(r() * 4)], light, 1, seed + f, r() * TAU);
      }
    };
    if (tip) clump(tip.x, tip.y + 0.8, tip.z, 2.2 + 0.8 * r(), i * 100 + j * 10);
    // sub-limbs rising steeply off the outer half of a decorative or hero branch
    const m = stand ? 0 : br.len > 9 ? 2 : 1;
    for (let q = 0; q < m; q++) {
      const al = br.len * (0.42 + 0.4 * ((q + 0.3 + 0.4 * r()) / m));
      const side = q % 2 ? 1 : -1;
      const yaw = Math.atan2(br.d[0], br.d[2]) + side * (0.6 + 0.4 * r());
      const pitch = 0.6 + 0.3 * r();
      const len = br.len * (0.22 + 0.08 * r());
      const r0 = 0.5 * lerp(br.r0, br.r1, al / br.len);
      const p0 = [br.a[0] + br.d[0] * al, br.a[1], br.a[2] + br.d[2] * al];
      const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
      const sr = [];
      for (let k = 0; k < 9; k++) {
        const tt = k / 8;
        sr.push({x: p0[0] + dir[0] * len * tt, y: p0[1] + dir[1] * len * tt - 0.1 * len * Math.sin(Math.PI * tt), z: p0[2] + dir[2] * len * tt, r: r0 * lerp(1, 0.3, tt)});
      }
      tube(G, sr, 12, {capEnd: r0 * 0.3, color: (k, jj, g, col) => col.copy(bc).multiplyScalar(0.97)});
      clump(sr[8].x, sr[8].y + 0.6, sr[8].z, 1.8 + 0.7 * r(), i * 100 + j * 10 + 3 + q * 3);
    }
    info.push({h: br.a[1], az: b[1], len: br.len, r0: br.r0, r1: br.r1, stand, a: new THREE.Vector3(...br.a), b: new THREE.Vector3(...br.b), dir: new THREE.Vector3(...br.d)});
  });
  crown(GC, t.x, t.z, t.s, t.h, r, 12, 1, i * 1000);
  return {id: t.id, index: i, x: t.x, z: t.z, s: t.s, h: t.h, base: new THREE.Vector3(t.x, 0, t.z), branches: info};
}

// one instanced fill-tree variant at unit scale (instances scale x/z by s and y by h / H0)
const H0 = 82;
function fillVariant(P, v, far) {
  const W = P.world;
  const r = rng(W.seed * 3 + 41 * (v + 1) + (far ? 900 : 0));
  const nz = makeNoise(W.seed + 777 + v);
  const prof = W.trunk;
  const top = prof[prof.length - 1][0];
  const rAt = (y) => {
    const yy = (y * top) / H0;
    for (let j = 0; j < prof.length - 1; j++) if (yy <= prof[j + 1][0]) return lerp(prof[j][1], prof[j + 1][1], (yy - prof[j][0]) / (prof[j + 1][0] - prof[j][0]));
    return prof[prof.length - 1][1];
  };
  const G = new Geo();
  const GC = new Geo();
  const lobes = lobeSet(r, far ? 4 : 5 + Math.floor(r() * 2));
  if (far) trunk(G, {x: 0, z: 0, s: 1, h: H0, rAt, segs: 10, step: 8, baseStep: 1, ridges: 0, depth: 0, twist: 0, lobes: lobes.map((L) => ({...L, amp: L.amp * 0.6})), nz});
  else {
    trunk(G, {x: 0, z: 0, s: 1, h: H0, rAt, segs: 24, step: 4.5, baseStep: 0.6, ridges: 8, depth: 0.12, twist: (r() - 0.5) * 0.01, lobes, nz});
    roots(G, {x: 0, z: 0, s: 1, lobes, r, segs: 5, n: 8});
    // a few short, high limbs sweeping up into the crown: the fill trees never reach into the corridor
    const bc = C(PAL.branch);
    for (let q = 0; q < 3; q++) {
      const y = 50 + q * 6 + r() * 4;
      const a = q * 2.3 + r();
      const len = 4 + r() * 2.5;
      const rr = 0.45 + 0.15 * r();
      const rings = [];
      for (let k = 0; k < 6; k++) {
        const al = lerp(rAt(y) * 0.3, rAt(y) + len, k / 5);
        rings.push({x: Math.sin(a) * al, y: y + 0.08 * al + 0.08 * Math.max(0, al - rAt(y)) ** 2, z: Math.cos(a) * al, r: rr * lerp(1, 0.35, k / 5)});
      }
      tube(G, rings, 8, {capEnd: rr * 0.3, color: (k, j, g, col) => col.copy(bc)});
    }
  }
  crown(GC, 0, 0, 1, H0, r, far ? 3 : 7, 1, v * 50 + (far ? 500 : 0));
  return {trunk: G.build(), canopy: GC.build()};
}

// ------------------------------------------------------------ materials: every world material fades to the haze on isolate
function worldMat(m, U, key, extra) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDim = U.dim;
    sh.uniforms.uHaze = U.haze;
    sh.uniforms.uTime = U.time;
    let vs = sh.vertexShader;
    let fs = sh.fragmentShader;
    fs = fs.replace('void main() {', 'uniform float uDim;\nuniform vec3 uHaze;\nvoid main() {');
    fs = fs.replace('#include <fog_fragment>', '#include <fog_fragment>\n\tgl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, uDim);');
    if (extra) [vs, fs] = extra(sh, vs, fs);
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'odm-world-' + key;
  return m;
}
// the crowns breathe: a slow sway that grows with height (pure function of S.tau)
const swayGLSL = (sh, vs, fs) => {
  vs = vs.replace('void main() {', 'uniform float uTime;\nvoid main() {');
  vs = vs.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
  #ifdef USE_INSTANCING
    vec2 swO = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  #else
    vec2 swO = vec2(0.0);
  #endif
    vec2 swP = swO + position.xz;
    float swK = 0.35 * clamp((position.y - 40.0) / 40.0, 0.0, 1.0);
    transformed.x += swK * sin(uTime * 0.53 + swP.x * 0.045 + swP.y * 0.031);
    transformed.z += swK * 0.7 * sin(uTime * 0.41 + swP.y * 0.05 + 1.7);`,
  );
  return [vs, fs];
};
// the floor: a baked mask (R path, G clearing, B damp ring at tree bases) plus soft procedural litter
const groundGLSL = (U) => (sh, vs, fs) => {
  Object.assign(sh.uniforms, U.ground);
  vs = vs.replace('void main() {', 'varying vec2 vGXZ;\nvoid main() {');
  vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
  fs = fs.replace(
    'void main() {',
    `varying vec2 vGXZ;
uniform sampler2D uMask; uniform vec3 uMaskT; uniform vec3 uPathC; uniform vec3 uClearC; uniform vec3 uDampC; uniform vec3 uMossC;
float gh(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), f.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {`,
  );
  fs = fs.replace(
    '#include <color_fragment>',
    `#include <color_fragment>
  vec4 mk = texture2D(uMask, (vGXZ - uMaskT.xy) / uMaskT.z + 0.5);
  float n1 = gn(vGXZ * 0.03), n2 = gn(vGXZ * 0.17 + 7.1), n3 = gn(vGXZ * 1.3 + 3.3);
  vec3 gc = diffuseColor.rgb * (0.93 + 0.08 * n1 + 0.05 * n2 + 0.05 * n3);
  gc = mix(gc, uMossC, 0.28 * smoothstep(0.5, 0.82, n1 * 0.65 + n2 * 0.35));
  gc = mix(gc, uClearC, 0.55 * mk.g);
  gc = mix(gc, uDampC, 0.55 * mk.b);
  gc = mix(gc, uPathC, 0.7 * mk.r * (0.8 + 0.2 * n3));
  diffuseColor.rgb = gc;`,
  );
  return [vs, fs];
};

// ------------------------------------------------------------ the floor
function forestPath(P, nz) {
  const W = P.world;
  const D = W.dummy;
  const c = W.corridor;
  const pts = [];
  for (let i = 0; i < c.length - 1; i++) {
    const L = Math.hypot(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]);
    const n = Math.ceil(L / 3);
    for (let k = 0; k < n; k++) pts.push([lerp(c[i][0], c[i + 1][0], k / n), lerp(c[i][1], c[i + 1][1], k / n)]);
  }
  pts.push(c[c.length - 1].slice());
  // a walked path wanders a little and steps around the roots and the dummy's sled
  const obst = W.trees.map((t) => [t.x, t.z, 4.6 * t.s + 4.5]).concat([[D.x, D.z, 9.5]]);
  return pts.map(([x, z]) => {
    x += (nz(z / 38, 3.5) - 0.5) * 6;
    for (let it = 0; it < 2; it++)
      for (const [ox, oz, rr] of obst) {
        const d = Math.hypot(x - ox, z - oz);
        if (d < rr) {
          x = ox + ((x - ox) / (d || 1)) * rr;
          z = oz + ((z - oz) / (d || 1)) * rr;
        }
      }
    return [x, z];
  });
}
function groundMask(P, path, bases, cx, cz, M) {
  const N = 2048;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, N, N);
  g.globalCompositeOperation = 'lighter';
  const k = N / M;
  const px = (x) => (x - cx) * k + N / 2;
  const pz = (z) => (z - cz) * k + N / 2;
  g.filter = `blur(${(1.1 * k).toFixed(1)}px)`;
  g.strokeStyle = 'rgb(255,0,0)';
  g.lineWidth = 2.6 * k;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  path.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
  g.stroke();
  g.filter = 'none';
  const cl = P.world.clearing;
  const gr = g.createRadialGradient(px(cl.x), pz(cl.z), cl.r * 0.5 * k, px(cl.x), pz(cl.z), cl.r * 1.15 * k);
  gr.addColorStop(0, 'rgb(0,255,0)');
  gr.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, N, N);
  for (const [x, z, rb] of bases) {
    const b = g.createRadialGradient(px(x), pz(z), rb * 0.8 * k, px(x), pz(z), rb * 2.4 * k);
    b.addColorStop(0, 'rgb(0,0,255)');
    b.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = b;
    g.fillRect(px(x) - rb * 2.5 * k, pz(z) - rb * 2.5 * k, rb * 5 * k, rb * 5 * k);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.anisotropy = 8;
  return tex;
}
function fernGeo() {
  const G = new Geo();
  const dark = C(PAL.fernDark);
  const lite = C(PAL.fern);
  const r = rng(4242);
  const n = 9;
  for (let f = 0; f < n; f++) {
    const a = (f / n) * TAU + r() * 0.4;
    const L = 0.8 + 0.4 * r();
    const arch = 0.55 + 0.25 * r();
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let prev = null;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const d = t * L;
      const y = arch * t * (1.15 - t) * 1.6;
      const w = 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)) * (1 - 0.3 * t);
      const cx = sa * d;
      const cz = ca * d;
      _col.copy(dark).lerp(lite, t);
      const L0 = G.v(cx + ca * w, y, cz - sa * w, _col);
      const R0 = G.v(cx - ca * w, y + 0.03, cz + sa * w, _col);
      if (prev) G.i.push(prev[0], prev[1], R0, prev[0], R0, L0);
      prev = [L0, R0];
    }
  }
  return G.build();
}

// ------------------------------------------------------------ the training dummy
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
// a six-sided block from 8 corners: 0-3 one end loop, 4-7 the other (i ↔ i+4)
function hexa(G, Q, col) {
  const cen = [0, 0, 0];
  for (const q of Q) for (let k = 0; k < 3; k++) cen[k] += q[k] / 8;
  for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) G.fquad(Q[f[0]], Q[f[1]], Q[f[2]], Q[f[3]], col, cen);
}
// a plank laid on the quad a b c d (b along from a, d above a), t thick, outward
function plankHexa(G, a, b, c, d, t, col) {
  const n = norm3(cross3(sub3(c, a), sub3(d, b)));
  hexa(G, [a, b, c, d, add3(a, n, t), add3(b, n, t), add3(c, n, t), add3(d, n, t)], col);
}
// a beam of w × h section from a to b (h along the up-most normal)
function beam(G, a, b, w, h, col) {
  const T = norm3(sub3(b, a));
  let S = cross3(T, [0, 1, 0]);
  if (Math.hypot(...S) < 1e-3) S = [1, 0, 0];
  S = norm3(S);
  const U = cross3(S, T);
  const q = (p, i, j) => add3(add3(p, S, (i * w) / 2), U, (j * h) / 2);
  hexa(G, [q(a, -1, -1), q(a, 1, -1), q(a, 1, 1), q(a, -1, 1), q(b, -1, -1), q(b, 1, -1), q(b, 1, 1), q(b, -1, 1)], col);
}
// a squared-ellipse cross-section: azimuth 0 = +z toward +x, K points offset half a step; e < 1 squares it off
function ringPts(p, y, K, e) {
  const out = [];
  for (let k = 0; k < K; k++) {
    const a = ((k + 0.5) / K) * TAU;
    const s = Math.sin(a);
    const c = Math.cos(a);
    out.push([(p.cx || 0) + p.hw * Math.sign(s) * Math.pow(Math.abs(s), e), y, (p.cz || 0) + p.hd * Math.sign(c) * Math.pow(Math.abs(c), e)]);
  }
  return out;
}
function secAt(secs, y) {
  let i = 0;
  while (i < secs.length - 2 && y > secs[i + 1].y) i++;
  const a = secs[i];
  const b = secs[i + 1];
  const k = clamp((y - a.y) / (b.y - a.y), 0, 1);
  return {cx: lerp(a.cx || 0, b.cx || 0, k), cz: lerp(a.cz || 0, b.cz || 0, k), hw: lerp(a.hw, b.hw, k), hd: lerp(a.hd, b.hd, k)};
}
// a body part as a loft of plank courses ('h') or staves ('v') over a seam-coloured core, so every gap reads as a seam
function plankLoft(G, secs, o) {
  const K = o.K;
  const e = o.e ?? 0.6;
  const t = o.t ?? 0.06;
  const gap = o.gap ?? 0.035;
  const pw = o.pw ?? 0.3;
  const y0 = secs[0].y;
  const y1 = secs[secs.length - 1].y;
  if (o.dir === 'h') {
    const n = Math.max(1, Math.round((y1 - y0) / pw));
    const ph = (y1 - y0) / n;
    for (let c = 0; c < n; c++) {
      const yb = y0 + c * ph + gap / 2;
      const yt = y0 + (c + 1) * ph - gap / 2;
      const A = ringPts(secAt(secs, yb), yb, K, e);
      const B = ringPts(secAt(secs, yt), yt, K, e);
      for (let j = 0; j < K; j++) plankHexa(G, A[j], A[(j + 1) % K], B[(j + 1) % K], B[j], t, o.col());
    }
  } else
    for (let s = 0; s < secs.length - 1; s++) {
      const yb = secs[s].y + gap / 2;
      const yt = secs[s + 1].y - gap / 2;
      const A = ringPts(secAt(secs, yb), yb, K, e);
      const B = ringPts(secAt(secs, yt), yt, K, e);
      for (let j = 0; j < K; j++) {
        const j1 = (j + 1) % K;
        const fw = Math.hypot(...sub3(A[j1], A[j]));
        const m = Math.max(1, Math.round(fw / pw));
        const gf = Math.min(0.3, gap / fw);
        for (let q = 0; q < m; q++) {
          const f0 = q / m + gf / 2;
          const f1 = (q + 1) / m - gf / 2;
          plankHexa(G, lerp3(A[j], A[j1], f0), lerp3(A[j], A[j1], f1), lerp3(B[j], B[j1], f1), lerp3(B[j], B[j1], f0), t, o.col());
        }
      }
    }
  // the core: rings at every section, inset a little, capped where it could show
  const rows = secs.map((p) => ringPts({...p, hw: p.hw - 0.012, hd: p.hd - 0.012}, p.y, K, e).map((q) => G.v(q[0], q[1], q[2], o.core)));
  for (let s = 0; s < rows.length - 1; s++)
    for (let j = 0; j < K; j++) {
      const j1 = (j + 1) % K;
      G.i.push(rows[s][j], rows[s][j1], rows[s + 1][j1], rows[s][j], rows[s + 1][j1], rows[s + 1][j]);
    }
  const cap = (row, p, up) => {
    const c = G.v(p.cx || 0, p.y, p.cz || 0, o.core);
    for (let j = 0; j < K; j++) G.i.push(...(up ? [c, row[j], row[(j + 1) % K]] : [c, row[(j + 1) % K], row[j]]));
  };
  if (o.caps?.[0]) cap(rows[0], secs[0], false);
  if (o.caps?.[1]) cap(rows[rows.length - 1], secs[secs.length - 1], true);
}
// an iron band (or strap) wrapped over a loft's planks at height y
function band(G, secs, y, hgt, out, K, e, col, t = 0.03) {
  const g = (p) => ({...p, hw: p.hw + out, hd: p.hd + out});
  const A = ringPts(g(secAt(secs, y - hgt / 2)), y - hgt / 2, K, e);
  const B = ringPts(g(secAt(secs, y + hgt / 2)), y + hgt / 2, K, e);
  for (let j = 0; j < K; j++) plankHexa(G, A[j], A[(j + 1) % K], B[(j + 1) % K], B[j], t, col);
}
// a catenary-ish rope between two points
function rope(G, a, b, sag, rad, col) {
  const rings = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    const p = lerp3(a, b, t);
    rings.push({x: p[0], y: p[1] - sag * 4 * t * (1 - t), z: p[2], r: rad});
  }
  tube(G, rings, 6, {color: (k, j, g, c) => c.copy(col)});
}

// the painted grin: transparent canvas laid over the front staves of the head
function faceTexture() {
  const W = 512;
  const H = 640;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const ink = PAL.paint;
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = g.fillStyle = ink;
  const X = (u) => u * W;
  const Y = (v) => v * H;
  for (const s of [-1, 1]) {
    // eyes: a ring with a heavy pupil; brows; a cheek crease at each end of the grin
    g.lineWidth = 9;
    g.beginPath();
    g.ellipse(X(0.5 + s * 0.2), Y(0.3), 34, 30, 0, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(X(0.5 + s * 0.2) - s * 4, Y(0.303), 15, 0, TAU);
    g.fill();
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(X(0.5 + s * 0.1), Y(0.235));
    g.quadraticCurveTo(X(0.5 + s * 0.2), Y(0.2), X(0.5 + s * 0.3), Y(0.225));
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(X(0.5 + s * 0.375), Y(0.6));
    g.quadraticCurveTo(X(0.5 + s * 0.4), Y(0.635), X(0.5 + s * 0.385), Y(0.67));
    g.stroke();
  }
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(X(0.5), Y(0.36));
  g.lineTo(X(0.485), Y(0.47));
  g.quadraticCurveTo(X(0.5), Y(0.49), X(0.53), Y(0.475));
  g.stroke();
  // the grin: a wide lens of teeth from cheek to cheek
  const y0 = Y(0.6);
  const L = X(0.5 - 0.35);
  const R = X(0.5 + 0.35);
  g.beginPath();
  g.moveTo(L, y0);
  g.quadraticCurveTo(X(0.5), y0 + 46, R, y0);
  g.quadraticCurveTo(X(0.5), y0 + 150, L, y0);
  g.closePath();
  g.fillStyle = '#efe6d3';
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = ink;
  g.lineWidth = 5;
  for (let k = -7; k <= 7; k++) {
    g.beginPath();
    g.moveTo(X(0.5 + k * 0.045), y0 - 10);
    g.lineTo(X(0.5 + k * 0.045), y0 + 140);
    g.stroke();
  }
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(L, y0 + 4);
  g.quadraticCurveTo(X(0.5), y0 + 96, R, y0 + 4);
  g.stroke();
  g.restore();
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(L, y0);
  g.quadraticCurveTo(X(0.5), y0 + 46, R, y0);
  g.quadraticCurveTo(X(0.5), y0 + 150, L, y0);
  g.closePath();
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildDummy(P, U, ph) {
  const D = P.world.dummy;
  const r = rng(P.world.seed + 4049);
  const root = new THREE.Group();
  root.name = 'dummy';
  root.position.set(D.x, 0, D.z);
  root.rotation.y = D.face;
  const GP = new Geo();
  const GI = new Geo();
  const GR = new Geo();
  const pine = PAL.pine.map(C);
  const seam = C(PAL.seam);
  const iron = C(PAL.iron);
  const strapC = C(PAL.strap);
  const ropeC = C(PAL.rope);
  const plank = () => pine[Math.floor(r() * 3)].clone().multiplyScalar(0.94 + 0.1 * r());
  // proportions: P gives the crown, hips, shoulders, head and nape; the rest are human ratios (research/visual.md 7)
  const deck = 0.45;
  const lat = D.shoulderW / 3.9;
  const shY = D.shoulderY;
  const hipY = D.hipY;
  const chin = D.h - D.head;
  const back = D.nape.back;
  const legX = 0.74 * lat;
  const shX = D.shoulderW / 2 + 0.1;
  const footTop = deck + 0.55;
  const kneeY = deck + 0.54 * (hipY - deck);
  const elbowY = shY - 2.7;
  const wristY = elbowY - 2.1;
  const H = {dir: 'h', K: 8, e: 0.5, pw: 0.32, t: 0.07, col: plank, core: seam};
  const Vt = {dir: 'v', K: 8, e: 0.55, pw: 0.3, t: 0.06, col: plank, core: seam};

  // legs, staves of vertical planks; iron bands at the ankle, knee and thigh
  for (const sd of [-1, 1]) {
    const cx = sd * legX;
    const shin = [{y: footTop - 0.1, cx, cz: -0.05, hw: 0.4, hd: 0.42}, {y: kneeY, cx, cz: 0, hw: 0.47, hd: 0.5}];
    const thigh = [{y: kneeY, cx, cz: 0.02, hw: 0.5, hd: 0.53}, {y: hipY - 0.15, cx: cx + sd * 0.03, cz: 0.04, hw: 0.64, hd: 0.68}];
    plankLoft(GP, shin, Vt);
    plankLoft(GP, thigh, Vt);
    band(GI, shin, footTop + 0.2, 0.18, 0.06, 8, 0.55, iron);
    band(GI, thigh, kneeY + 0.05, 0.3, 0.06, 8, 0.55, iron);
    band(GI, thigh, hipY - 0.7, 0.18, 0.06, 8, 0.55, iron);
    // the foot: a sloped plank box, heel to toe along +z
    const z0 = -0.62;
    const z1 = 1.75;
    const x0 = cx - 0.48;
    const x1 = cx + 0.48;
    const yT = (z) => lerp(footTop, deck + 0.3, (z - z0) / (z1 - z0));
    hexa(GP, [[x0 + 0.05, deck, z0 + 0.05], [x1 - 0.05, deck, z0 + 0.05], [x1 - 0.05, deck, z1 - 0.05], [x0 + 0.05, deck, z1 - 0.05], [x0 + 0.05, yT(z0) - 0.02, z0 + 0.05], [x1 - 0.05, yT(z0) - 0.02, z0 + 0.05], [x1 - 0.05, yT(z1) - 0.02, z1 - 0.05], [x0 + 0.05, yT(z1) - 0.02, z1 - 0.05]], seam);
    for (let q = 0; q < 3; q++) {
      const a = lerp(x0, x1, q / 3) + 0.018;
      const b = lerp(x0, x1, (q + 1) / 3) - 0.018;
      hexa(GP, [[a, yT(z0), z0], [b, yT(z0), z0], [b, yT(z1), z1], [a, yT(z1), z1], [a, yT(z0) + 0.06, z0], [b, yT(z0) + 0.06, z0], [b, yT(z1) + 0.06, z1], [a, yT(z1) + 0.06, z1]], plank());
    }
    for (const x of [x0, x1]) {
      const o = x === x0 ? -0.05 : 0.05;
      hexa(GP, [[x, deck, z0], [x, deck, z1], [x, yT(z1), z1], [x, yT(z0), z0], [x + o, deck, z0], [x + o, deck, z1], [x + o, yT(z1), z1], [x + o, yT(z0), z0]], plank());
    }
  }

  // pelvis and torso in horizontal courses; the top slopes in to the neck and stays clear of the cut arc
  const torso = [
    {y: hipY - 0.45, cz: 0, hw: 1.42 * lat, hd: 0.78},
    {y: hipY + 0.6, cz: 0, hw: 1.44 * lat, hd: 0.8},
    {y: hipY + 1.45, cz: 0.02, hw: 1.22 * lat, hd: 0.72},
    {y: hipY + 2.7, cz: 0.06, hw: 1.5 * lat, hd: 0.84},
    {y: shY - 0.6, cz: 0.05, hw: 1.68 * lat, hd: 0.84},
    {y: shY + 0.05, cz: 0.02, hw: 1.76 * lat, hd: 0.72},
    {y: shY + 0.45, cz: 0.06, hw: 0.9, hd: 0.48},
  ];
  plankLoft(GP, torso, {...H, caps: [true, true]});
  band(GI, torso, hipY + 0.05, 0.22, 0.07, 8, 0.5, iron);

  // arms hang a little out from the body; laminated shoulder caps and elbow hinges, iron at the wrist
  for (const sd of [-1, 1]) {
    const upper = [{y: elbowY, cx: sd * (shX + 0.22), cz: 0.06, hw: 0.37, hd: 0.4}, {y: shY + 0.05, cx: sd * shX, cz: 0, hw: 0.44, hd: 0.46}];
    const fore = [{y: wristY, cx: sd * (shX + 0.32), cz: 0.24, hw: 0.29, hd: 0.32}, {y: elbowY - 0.04, cx: sd * (shX + 0.23), cz: 0.07, hw: 0.36, hd: 0.39}];
    const hand = [
      {y: wristY - 1.55, cx: sd * (shX + 0.35), cz: 0.36, hw: 0.13, hd: 0.33},
      {y: wristY - 0.95, cx: sd * (shX + 0.36), cz: 0.32, hw: 0.19, hd: 0.47},
      {y: wristY - 0.06, cx: sd * (shX + 0.34), cz: 0.26, hw: 0.17, hd: 0.38},
    ];
    plankLoft(GP, upper, {...Vt, caps: [false, true]});
    plankLoft(GP, fore, Vt);
    plankLoft(GP, hand, {...Vt, pw: 0.28, caps: [true, false]});
    band(GI, fore, wristY + 0.12, 0.16, 0.06, 8, 0.55, iron);
    const radii = [0.6, 0.5, 0.34];
    radii.forEach((rr, k) => GP.geom(new THREE.CylinderGeometry(rr, rr, 0.13, 14), M4(sd * shX, shY - 0.12 + k * 0.14, 0, 1, 1, 1.05), k % 2 ? plank() : pine[0]));
    GP.geom(new THREE.CylinderGeometry(0.44, 0.44, 0.92, 14), M4(sd * (shX + 0.225), elbowY - 0.02, 0.065, 1, 1, 1, 0, 0, Math.PI / 2), plank());
    GI.geom(new THREE.CylinderGeometry(0.2, 0.2, 0.98, 10), M4(sd * (shX + 0.225), elbowY - 0.02, 0.065, 1, 1, 1, 0, 0, Math.PI / 2), iron);
  }

  // neck staves; the nape board and pad sit on its back with the pad surface exactly nape.back from the axis
  const neck = [{y: shY + 0.1, cz: 0.04, hw: 0.42, hd: 0.42}, {y: chin + 0.7, cz: 0.08, hw: 0.4, hd: 0.4}];
  plankLoft(GP, neck, {dir: 'v', K: 12, e: 1, pw: 0.24, t: 0.05, col: plank, core: seam});
  const padT = 0.14;
  const boardT = 0.04;
  const bz = -(back - padT) + boardT + 0.06; // board centre: its planks' back face lands on the pad's back face
  plankLoft(GP, [{y: D.nape.y - 0.74, cz: bz, hw: 0.5, hd: 0.06}, {y: D.nape.y + 0.72, cz: bz, hw: 0.5, hd: 0.06}], {dir: 'h', K: 4, e: 0, pw: 0.3, t: boardT, col: plank, core: seam, caps: [true, true]});
  band(GI, neck, D.nape.y - 0.62, 0.15, 0.05, 12, 1, strapC, 0.025);

  // head: an ellipsoid of 16 staves over a dark core, an iron hoop at the brow, ears, the painted grin.
  // Centred forward so the back of the skull stays inside the blade's 1.3 m cut circle around the nape.
  const hc = [0, D.h - D.head / 2, 0.24];
  const hr = [0.74 * lat, D.head / 2, 0.8];
  for (let k = 0; k < 16; k++) GP.geom(new THREE.SphereGeometry(1, 3, 22, (k / 16) * TAU + 0.012, TAU / 16 - 0.024, 0.05, Math.PI - 0.1), M4(...hc, ...hr), plank());
  GP.geom(new THREE.SphereGeometry(0.975, 32, 18), M4(...hc, ...hr), seam);
  const hoopY = hc[1] + 0.5;
  const hoopK = Math.sqrt(1 - ((hoopY - hc[1]) / hr[1]) ** 2) * 1.012;
  GI.geom(new THREE.TorusGeometry(1, 0.04, 6, 64), M4(hc[0], hoopY, hc[2], hr[0] * hoopK, hr[2] * hoopK, 1, 0, Math.PI / 2), iron);
  for (const sd of [-1, 1]) GP.geom(new THREE.CylinderGeometry(0.26, 0.22, 0.14, 12), M4(sd * (hr[0] + 0.02), hc[1] - 0.05, hc[2] - 0.05, 1.3, 1, 1, 0, 0, Math.PI / 2), plank());
  const faceMat = worldMat(new THREE.MeshStandardMaterial({map: faceTexture(), transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}), U, 'face');
  const face = new THREE.Mesh(new THREE.SphereGeometry(1.004, 40, 30, Math.PI / 2 - 0.95, 1.9, 0.68, 2.05), faceMat);
  face.position.set(...hc);
  face.scale.set(...hr);
  face.userData.noShadow = true;

  // the skid sled and the A-frame behind (−z), all below 9 m so the cut swing behind the neck is clear
  const sx = 2.3 * lat;
  const sz0 = -4.6;
  const sz1 = 1.9;
  for (const sd of [-1, 1]) {
    beam(GP, [sd * sx, 0.2, sz0], [sd * sx, 0.2, sz1], 0.32, 0.32, plank());
    beam(GP, [sd * sx, 0.2, sz1 - 0.05], [sd * sx, 0.62, sz1 + 0.75], 0.32, 0.3, plank());
    beam(GI, [sd * sx, 0.02, sz0 - 0.05], [sd * sx, 0.02, sz1 + 0.05], 0.34, 0.04, iron);
    beam(GI, [sd * sx, 0.24, sz1 + 0.05], [sd * sx, 0.66, sz1 + 0.8], 0.34, 0.33, iron);
  }
  for (let z = sz0 + 0.2; z < sz1 - 0.1; z += 0.34) beam(GP, [-sx - 0.25, 0.405, z], [sx + 0.25, 0.405, z], 0.3, 0.09, plank());
  const by = Math.min(8.4, hipY + 0.4);
  const bzB = -0.92;
  beam(GP, [-1.55 * lat, by, bzB], [1.55 * lat, by, bzB], 0.3, 0.3, plank());
  const strut = (sd, t) => lerp3([sd * 1.15 * lat, by - 0.1, bzB - 0.05], [sd * 2.0 * lat, deck, -4.2], t);
  for (const sd of [-1, 1]) {
    beam(GP, strut(sd, 0), strut(sd, 1), 0.27, 0.27, plank());
    const pt = (2.5 - 0.97) / (4.2 - 0.97);
    const sp = strut(sd, pt);
    beam(GP, [sp[0], deck, sp[2]], sp, 0.24, 0.24, plank());
    beam(GP, [sd * legX, 3.2, -0.5], [sd * legX, deck, -1.9], 0.22, 0.22, plank());
    for (const t of [0.02, pt, 0.98]) GI.geom(new THREE.BoxGeometry(0.34, 0.34, 0.34), M4(...strut(sd, t)), iron);
    // lashings at the post head
    for (let k = 0; k < 3; k++) GR.geom(new THREE.TorusGeometry(0.19, 0.035, 5, 16), M4(sp[0], sp[1] - 0.25 - k * 0.08, sp[2], 1, 1, 1, 0, Math.PI / 2), ropeC);
  }
  const tieT = (by - 0.1 - 3.2) / (by - 0.1 - deck);
  beam(GP, strut(-1, tieT), strut(1, tieT), 0.22, 0.22, plank());
  // X bracing between the struts, the two diagonals on opposite faces
  const off = norm3(cross3([1, 0, 0], sub3(strut(1, 1), strut(1, 0))));
  for (const sd of [-1, 1]) beam(GP, add3(strut(-sd, 0.14), off, 0.2 * sd), add3(strut(sd, 0.86), off, 0.2 * sd), 0.18, 0.18, plank());
  // guy ropes from the hip eyes to stakes, the pull bridle on the ground in front
  for (const sd of [-1, 1]) {
    const eye = [sd * 1.5 * lat, hipY - 0.25, 0.1];
    const stake = [sd * 7.2, 0.35, 2.4];
    GI.geom(new THREE.TorusGeometry(0.12, 0.03, 5, 12), M4(...eye, 1, 1, 1, 0, 0, Math.PI / 2), iron);
    rope(GR, eye, stake, 0.3, 0.035, ropeC);
    beam(GP, [stake[0] + sd * 0.15, -0.3, stake[2] + 0.05], [stake[0] - sd * 0.02, 0.55, stake[2]], 0.12, 0.12, plank());
    rope(GR, [sd * sx, 0.62, sz1 + 0.78], [0, 0.12, 5.4], 0.05, 0.035, ropeC);
  }
  GI.geom(new THREE.TorusGeometry(0.16, 0.035, 6, 16), M4(0, 0.06, 5.45, 1, 1, 1, 0, Math.PI / 2), iron);
  rope(GR, [0, 0.07, 5.55], [1.4, 0.05, 10.6], 0.0, 0.035, ropeC);
  for (let k = 0; k < 4; k++) GR.geom(new THREE.TorusGeometry(0.42 - k * 0.03, 0.035, 5, 24), M4(1.75, 0.04 + k * 0.06, 11.0, 1, 1, 1, 0, Math.PI / 2), ropeC);

  const plankMat = worldMat(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.8, metalness: 0}), U, 'plank');
  const ironMat = worldMat(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.55, metalness: 0.45, envMapIntensity: 1.6}), U, 'iron');
  const ropeMat = worldMat(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.9}), U, 'rope');
  const body = new THREE.Mesh(GP.build(), plankMat);
  const metal = new THREE.Mesh(GI.build(), ironMat);
  const ropes = new THREE.Mesh(GR.build(), ropeMat);
  body.name = 'dummy-planks';
  for (const m of [body, metal, ropes]) {
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
  root.add(face);

  // ---------------------------------------------------------- the nape: pad, kill strip, and the slab the cut takes
  // napeG: origin on the strip centre at the pad surface, +z out of the back of the neck, +y up, +x across
  const napeG = new THREE.Group();
  napeG.name = 'nape';
  napeG.position.set(0, D.nape.y, -back);
  napeG.rotation.y = Math.PI;
  root.add(napeG);
  const w = D.nape.w;
  const h = D.nape.h;
  const dep = D.nape.depth;
  const R = (h * h) / 4 / (2 * dep) + dep / 2; // circle through the strip ends with sagitta = depth (P.blade.cutR = 1.3)
  const arc = (y) => R - dep - Math.sqrt(Math.max(0, R * R - y * y));
  const padW = 0.78;
  const padH = h + 0.36;
  const bev = 0.02;
  const bt = 0.025;
  const shape = new THREE.Shape();
  const rr = 0.12;
  shape.moveTo(-padW / 2 + rr, -padH / 2);
  shape.lineTo(padW / 2 - rr, -padH / 2);
  shape.quadraticCurveTo(padW / 2, -padH / 2, padW / 2, -padH / 2 + rr);
  shape.lineTo(padW / 2, padH / 2 - rr);
  shape.quadraticCurveTo(padW / 2, padH / 2, padW / 2 - rr, padH / 2);
  shape.lineTo(-padW / 2 + rr, padH / 2);
  shape.quadraticCurveTo(-padW / 2, padH / 2, -padW / 2, padH / 2 - rr);
  shape.lineTo(-padW / 2, -padH / 2 + rr);
  shape.quadraticCurveTo(-padW / 2, -padH / 2, -padW / 2 + rr, -padH / 2);
  // the slot: the strip plus a 4 mm reveal at mid-thickness (holes shrink by the bevel there), a bevelled lip at the face
  const hw = w / 2 + 0.004 + bev;
  const hh = h / 2 + 0.004 + bev;
  const hole = new THREE.Path();
  hole.moveTo(-hw, -hh);
  hole.lineTo(-hw, hh);
  hole.lineTo(hw, hh);
  hole.lineTo(hw, -hh);
  hole.lineTo(-hw, -hh);
  shape.holes.push(hole);
  const padGeo = new THREE.ExtrudeGeometry(shape, {depth: padT - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bev, bevelSegments: 3, curveSegments: 6});
  const padMat = worldMat(new THREE.MeshStandardMaterial({color: PAL.pad, roughness: 0.6, metalness: 0}), U, 'pad');
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.z = -(padT - bt);
  pad.castShadow = pad.receiveShadow = true;
  napeG.add(pad);
  // brass rivets every 0.12 m round the border
  const rivPts = [];
  {
    const iw = padW / 2 - 0.065;
    const ih = padH / 2 - 0.065;
    const per = 4 * (iw + ih);
    const n = Math.round(per / 0.12);
    for (let k = 0; k < n; k++) {
      let s = (k / n) * per;
      let x;
      let y;
      if (s < 2 * iw) [x, y] = [-iw + s, -ih];
      else if ((s -= 2 * iw) < 2 * ih) [x, y] = [iw, -ih + s];
      else if ((s -= 2 * ih) < 2 * iw) [x, y] = [iw - s, ih];
      else [x, y] = [-iw, ih - (s - 2 * iw)];
      rivPts.push([x, y]);
    }
  }
  const rivMat = worldMat(new THREE.MeshStandardMaterial({color: PAL.brass, metalness: 0.85, roughness: 0.45, envMapIntensity: 2.2}), U, 'brass');
  const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.019, 10, 5, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2), rivMat, rivPts.length);
  rivPts.forEach(([x, y], k) => rivets.setMatrixAt(k, M4(x, y, -0.004)));
  rivets.castShadow = true;
  napeG.add(rivets);
  // the kill strip: the slab the blade takes (a circular segment, chord h, sagitta depth) and the base left behind
  const GS = new Geo();
  const GB = new Geo();
  const cream = C(PAL.strip);
  const cutC = C(PAL.cut);
  const darkC = C('#3b2a22');
  const N = 24;
  for (let k = 0; k < N; k++) {
    const y0 = -h / 2 + (h * k) / N;
    const y1 = -h / 2 + (h * (k + 1)) / N;
    const ym = (y0 + y1) / 2;
    const a0 = arc(y0);
    const a1 = arc(y1);
    const inS = [0, ym, arc(ym) / 2];
    GS.fquad([-w / 2, y0, 0], [w / 2, y0, 0], [w / 2, y1, 0], [-w / 2, y1, 0], cream, inS);
    GS.fquad([-w / 2, y0, a0], [w / 2, y0, a0], [w / 2, y1, a1], [-w / 2, y1, a1], cutC, inS);
    for (const x of [-w / 2, w / 2]) GS.fquad([x, y0, 0], [x, y1, 0], [x, y1, a1], [x, y0, a0], cream, inS);
    const b0 = a0 - 0.003;
    const b1 = a1 - 0.003;
    const inB = [0, ym, (arc(ym) - 0.003 - padT) / 2];
    GB.fquad([-w / 2, y0, b0], [w / 2, y0, b0], [w / 2, y1, b1], [-w / 2, y1, b1], cutC, inB);
    for (const x of [-w / 2, w / 2]) GB.fquad([x, y0, b0], [x, y1, b1], [x, y1, -padT], [x, y0, -padT], darkC, inB);
  }
  for (const s of [-1, 1]) GB.fquad([-w / 2, (s * h) / 2, -0.003], [w / 2, (s * h) / 2, -0.003], [w / 2, (s * h) / 2, -padT], [-w / 2, (s * h) / 2, -padT], darkC, [0, 0, -padT / 2]);
  const cutMat = worldMat(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.7}), U, 'cut');
  const base = new THREE.Mesh(GB.build(), cutMat);
  const slab = new THREE.Mesh(GS.build(), cutMat);
  slab.name = 'nape-slab';
  for (const m of [base, slab]) {
    m.castShadow = m.receiveShadow = true;
    napeG.add(m);
  }

  // ---------------------------------------------------------- the slab's flight, solved once here (it only depends on P)
  // Cut runs top to bottom: the slab peels out about its lower end, then flies off with the blade's kick (outward,
  // along the rider's travel) and tumbles end over end to the floor, where it slides and settles flat.
  const g0 = P.g0;
  const PEEL = 0.2;
  const yGround = -D.nape.y;
  // which way across the neck the rider travels at the cut: from the physics if it can tell us, else down the corridor
  let side = 1;
  let tCut = null;
  let tDone = null;
  const nf = napeFrame(P);
  const evt = ph?.events?.find((e) => e.key === 'cut');
  if (evt) {
    tCut = evt.tau;
    tDone = evt.tau;
    if (typeof ph.sample === 'function') {
      // the slab is free when the slice completes: scan the physics around the cut event (build time only)
      for (let t = evt.tau - 0.05; t < evt.tau + 1.0; t += 1 / 960) {
        const S = ph.sample(t);
        if (S?.blade && S.blade.cut >= 0.999) {
          tDone = t;
          if (S.vel) side = Math.sign(S.vel[0] * nf.lat[0] + S.vel[2] * nf.lat[2]) || 1;
          break;
        }
      }
    }
  } else {
    const c = P.world.corridor;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < c.length - 1; i++) {
      const d = segDist(D.x, D.z, c[i][0], c[i][1], c[i + 1][0], c[i + 1][1]);
      if (d < bd) [bd, best] = [d, i];
    }
    side = Math.sign((c[best + 1][0] - c[best][0]) * nf.lat[0] + (c[best + 1][1] - c[best][1]) * nf.lat[2]) || 1;
  }
  const X = new THREE.Vector3(1, 0, 0);
  const qPeel = new THREE.Quaternion().setFromAxisAngle(X, PEEL);
  const pPeel = new THREE.Vector3(0, -h / 2 + (h / 2) * Math.cos(PEEL), (h / 2) * Math.sin(PEEL));
  const v0 = new THREE.Vector3(4.0 * side, -0.6, 2.5);
  const wv = new THREE.Vector3(6.0, 1.2 * side, 0.8 * side);
  const wAx = wv.clone().normalize();
  const wMag = wv.length();
  const fly = (t, pos, q) => {
    pos.copy(pPeel).addScaledVector(v0, t);
    pos.y -= 0.5 * g0 * t * t;
    q.setFromAxisAngle(wAx, wMag * t).multiply(qPeel);
  };
  const corners = [];
  for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, -h / 4, 0, h / 4, h / 2]) corners.push(new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, arc(y)));
  const pL = new THREE.Vector3();
  const qL = new THREE.Quaternion();
  const tmp = new THREE.Vector3();
  let tLand = 4;
  for (let t = 0; t < 4; t += 1 / 960) {
    fly(t, pL, qL);
    let lo = Infinity;
    for (const c of corners) lo = Math.min(lo, tmp.copy(c).applyQuaternion(qL).add(pL).y);
    if (lo <= yGround + 0.002) {
      tLand = t;
      break;
    }
  }
  fly(tLand, pL, qL);
  const nUp = new THREE.Vector3(0, 0, 1).applyQuaternion(qL);
  const faceDown = nUp.y < 0;
  const yAx = new THREE.Vector3(0, 1, 0).applyQuaternion(qL).setY(0);
  if (yAx.lengthSq() < 1e-6) yAx.set(1, 0, 0);
  yAx.normalize();
  const zAx = new THREE.Vector3(0, faceDown ? -1 : 1, 0);
  const qRest = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(yAx, zAx), yAx, zAx));
  const yRest = yGround + (faceDown ? 0.004 : dep + 0.004);
  const SETTLE = 0.4;
  const SLIDE = 0.1;
  const poseSlab = (p, tf) => {
    if (p <= 0) {
      slab.position.set(0, 0, 0);
      slab.quaternion.identity();
    } else if (tf < 0) {
      const th = PEEL * Math.pow(p, 1.5);
      slab.quaternion.setFromAxisAngle(X, th);
      slab.position.set(0, -h / 2 + (h / 2) * Math.cos(th), (h / 2) * Math.sin(th));
    } else if (tf < tLand) fly(tf, slab.position, slab.quaternion);
    else {
      const s = tf - tLand;
      const k = Math.min(1, s / SETTLE);
      const e = 1 - Math.pow(1 - k, 3);
      const sl = SLIDE * (1 - Math.exp(-s / SLIDE));
      slab.position.set(pL.x + v0.x * sl, lerp(pL.y, yRest, e) + (s < 0.25 ? 0.1 * Math.sin((Math.PI * s) / 0.25) : 0), pL.z + v0.z * sl);
      slab.quaternion.slerpQuaternions(qL, qRest, e);
    }
  };

  const nape = {
    centre: new THREE.Vector3(...nf.c),
    size: new THREE.Vector3(w, h, dep), // across the neck, up, into the neck
    normal: new THREE.Vector3(...nf.n),
    across: new THREE.Vector3(...nf.lat),
    up: new THREE.Vector3(0, 1, 0),
    radius: R,
    group: napeG,
  };
  const cut = {tCut, tDone, tLand, side};
  return {root, nape, napeG, slab, poseSlab, cut, meshes: {body, metal, ropes, face, pad, rivets, base, slab}};
}

// ------------------------------------------------------------ the world
/**
 * buildWorld(P, ph?) -> {root, trees, fill, dummy: {root, nape}, branchTop, trunkRadius, update(S, D)}
 * ph (optional) is the physics sortie: its 'cut' event and sample() time the slab's fall.
 */
export function buildWorld(P, ph) {
  const W = P.world;
  const root = new THREE.Group();
  root.name = 'world';
  const U = {dim: {value: 0}, haze: {value: new THREE.Color(COL.haze)}, time: {value: 0}, ground: null};
  const barkMat = worldMat(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.93, metalness: 0}), U, 'bark');
  const canopyMat = worldMat(
    new THREE.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, emissive: new THREE.Color(PAL.leaf[0]).multiplyScalar(0.3)}),
    U,
    'canopy',
    swayGLSL,
  );

  // named trees, merged: one draw for the bark, one for the crowns
  const D = W.dummy;
  const avoid = {x: D.x, z: D.z, r: 8.5};
  const G = new Geo();
  const GC = new Geo();
  const trees = W.trees.map((t, i) => namedTree(G, GC, P, i, avoid));
  const bark = new THREE.Mesh(G.build(), barkMat);
  bark.name = 'trees';
  const crowns = new THREE.Mesh(GC.build(), canopyMat);
  crowns.name = 'crowns';
  for (const m of [bark, crowns]) {
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }

  // fill trees: three instanced variants, plus a cheap far ring that dissolves in the haze
  const fill = fillTrees(P);
  const far = farTrees(P);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Yax = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  const instance = (geo, mat, list, cast) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, k) => {
      im.setMatrixAt(k, m4.compose(new THREE.Vector3(t.x, 0, t.z), q.setFromAxisAngle(Yax, t.rot), new THREE.Vector3(t.s, t.h / H0, t.s)));
      im.setColorAt(k, tint.setScalar(t.tint));
    });
    im.castShadow = cast;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    root.add(im);
    return im;
  };
  const fillMeshes = [];
  for (let v = 0; v < 3; v++) {
    const list = fill.filter((t) => t.v === v);
    if (!list.length) continue;
    const gv = fillVariant(P, v, false);
    fillMeshes.push(instance(gv.trunk, barkMat, list, true), instance(gv.canopy, canopyMat, list, true));
  }
  if (far.length) {
    const gf = fillVariant(P, 0, true);
    fillMeshes.push(instance(gf.trunk, barkMat, far, false), instance(gf.canopy, canopyMat, far, false));
  }

  // the floor: one big plane, its path/clearing/damp mask baked once
  const nz = makeNoise(W.seed + 5);
  const path = forestPath(P, nz);
  const {cx, cz} = corridorBox(W);
  const M = W.fill.extent + 140;
  const bases = W.trees.map((t) => [t.x, t.z, 4.6 * t.s]).concat(fill.map((t) => [t.x, t.z, 4.6 * t.s]));
  U.ground = {
    uMask: {value: groundMask(P, path, bases, cx, cz, M)},
    uMaskT: {value: new THREE.Vector3(cx, cz, M)},
    uPathC: {value: C(PAL.path)},
    uClearC: {value: C(PAL.clearing)},
    uDampC: {value: C(PAL.dampG)},
    uMossC: {value: C(PAL.moss)},
  };
  const groundMat = worldMat(new THREE.MeshStandardMaterial({color: PAL.floor, roughness: 0.97, metalness: 0}), U, 'ground', groundGLSL(U));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  ground.name = 'ground';
  root.add(ground);

  // ferns for scale: off the path, off the roots, sparse in the clearing, none under the sled
  const fr = rng(W.seed + 99);
  const ferns = [];
  const halfE = W.fill.extent / 2;
  const obst = bases.map(([x, z, rb]) => [x, z, rb * 1.9]).concat([[D.x, D.z, 8.5]]);
  for (let k = 0; ferns.length < 420 && k < 6000; k++) {
    const x = cx + (fr() * 2 - 1) * halfE;
    const z = cz + (fr() * 2 - 1) * halfE;
    let ok = true;
    for (const [ox, oz, rr] of obst) if (Math.hypot(x - ox, z - oz) < rr) ok = false;
    for (let j = 0; ok && j < path.length; j += 1) if (Math.hypot(x - path[j][0], z - path[j][1]) < 3.4) ok = false;
    if (ok && Math.hypot(x - W.clearing.x, z - W.clearing.z) < W.clearing.r * 0.8 && fr() > 0.3) ok = false;
    if (ok) ferns.push({x, z, s: 0.7 + 0.8 * fr(), rot: fr() * TAU});
  }
  const fernMat = worldMat(new THREE.MeshStandardMaterial({vertexColors: true, side: THREE.DoubleSide, roughness: 0.9}), U, 'fern');
  const fernIM = new THREE.InstancedMesh(fernGeo(), fernMat, ferns.length);
  ferns.forEach((f, k) => fernIM.setMatrixAt(k, m4.compose(new THREE.Vector3(f.x, 0, f.z), q.setFromAxisAngle(Yax, f.rot), new THREE.Vector3(f.s, f.s, f.s))));
  fernIM.receiveShadow = true;
  fernIM.computeBoundingSphere();
  root.add(fernIM);

  const dummy = buildDummy(P, U, ph);
  root.add(dummy.root);

  // the physics capsule for every branch, cached so branchTop never allocates
  const BR = W.trees.map((t, i) => t.branches.map((b, j) => branchAxis(P, i, j)));
  const branchTop = (i, j, along, out = new THREE.Vector3()) => {
    const br = BR[i][j];
    const r = lerp(br.r0, br.r1, clamp(along / br.len, 0, 1));
    return out.set(br.a[0] + br.d[0] * along, br.a[1] + r, br.a[2] + br.d[2] * along);
  };
  const trunkRadius = (i, y) => trunkRadiusAt(P, i, y);

  return {
    root,
    trees,
    fill,
    path,
    dummy: {root: dummy.root, nape: dummy.nape, cut: dummy.cut, slab: dummy.slab},
    meshes: {bark, crowns, ground, ferns: fernIM, fill: fillMeshes, ...dummy.meshes},
    branchTop,
    trunkRadius,
    update(S, Dsp) {
      const tau = S?.tau ?? 0;
      U.time.value = tau;
      const iso = Dsp && Dsp.isolate != null && Dsp.isolate !== false ? clamp(Dsp.isolateK ?? 1, 0, 1) : 0;
      U.dim.value = 0.6 * iso;
      // the slice: S.blade.cut peels the slab; from the moment the slice completes it flies, lands and settles
      let p = clamp(S?.blade?.cut ?? 0, 0, 1);
      let tf = -1;
      const c = dummy.cut;
      if (c.tDone !== null && tau >= c.tDone && (p > 0 || tau > c.tDone + 0.05)) {
        p = 1;
        tf = tau - c.tDone;
      }
      dummy.poseSlab(p, tf);
    },
  };
}
