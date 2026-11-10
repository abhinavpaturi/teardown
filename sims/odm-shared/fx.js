// Everything that moves through the air rather than with the body: the two tethers (screen-space lines as wide as the
// 4.5 mm rope would project, sagging when slack, warming toward the accent with tension), the anchors in flight and
// set, bark chips where they bite, the white puffs of expanding cold air (anchor shots and trim jets; the air freezes
// its own moisture out at about -160 C), the flight trail coloured by g, force arrows, and the blade's arc through the
// nape. Built once from the sortie; update(S, D, camera) is a pure function of the sample.
import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {rng} from 'teardown-kit/util.js';
import {HEX, mat} from './materials.js';
import {branchAxis, napeFrame} from './physics.js';

const V3 = THREE.Vector3;
const SEG = 24;
const NOZZLE = new V3(0, -0.02, -0.23); // body frame: the trim-jet slot under the hub (SPEC 4)
const ACC = new THREE.Color(HEX.accent);
const ROPE = new THREE.Color('#5d6168');
const PALE = new THREE.Color('#c9ced3');
const Z = new V3(0, 0, 1);

export function buildFx(P, ph) {
  const root = new THREE.Group();
  root.name = 'fx';
  const r = rng(P.world.seed + 7);

  // ------------------------------------------------------------ tethers: a Line2 each, buffers written in place
  const tethers = [0, 1].map(() => {
    const geo = new LineGeometry();
    geo.setPositions(new Float32Array((SEG + 1) * 3));
    const m = new LineMaterial({color: 0xffffff, linewidth: 2, worldUnits: false, transparent: true, depthWrite: true});
    m.color.copy(ROPE);
    const line = new Line2(geo, m);
    line.frustumCulled = false;
    line.renderOrder = 2;
    root.add(line);
    const buf = geo.attributes.instanceStart.data;
    return {line, geo, m, buf};
  });
  const setLine = (t, pts) => {
    const a = t.buf.array;
    for (let i = 0; i < SEG; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      a[i * 6] = p0.x;
      a[i * 6 + 1] = p0.y;
      a[i * 6 + 2] = p0.z;
      a[i * 6 + 3] = p1.x;
      a[i * 6 + 4] = p1.y;
      a[i * 6 + 5] = p1.z;
    }
    t.buf.needsUpdate = true;
  };
  const pts = Array.from({length: SEG + 1}, () => new V3());

  // ------------------------------------------------------------ anchors: a helical Ti spike with flukes
  const anchorMesh = () => {
    const g = new THREE.Group();
    const body = mat('steel');
    const tip = mat('darkSteel');
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 12), body);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.02;
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.0075, 0.045, 12), tip);
    point.rotation.x = Math.PI / 2;
    point.position.z = 0.062;
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0022, 8, 16), body);
    eye.position.z = -0.085;
    g.add(shaft, point, eye);
    // helical flutes read as a few slanted rings
    for (let k = 0; k < 4; k++) {
      const f = new THREE.Mesh(new THREE.TorusGeometry(0.0072, 0.0012, 6, 16), tip);
      f.position.z = -0.05 + k * 0.022;
      f.rotation.x = 0.35;
      g.add(f);
    }
    const flukes = [];
    for (let k = 0; k < 3; k++) {
      const piv = new THREE.Group();
      piv.rotation.z = (k / 3) * Math.PI * 2;
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.04), tip);
      fl.position.set(0, 0.006, -0.02);
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.006, 0.0);
      hinge.add(fl);
      fl.position.set(0, 0, -0.02);
      piv.add(hinge);
      g.add(piv);
      flukes.push(hinge);
    }
    g.traverse((o) => o.isMesh && (o.castShadow = true));
    g.userData.flukes = flukes;
    root.add(g);
    return g;
  };
  const anchors = [anchorMesh(), anchorMesh()];

  // ------------------------------------------------------------ hits: bark chips and a ring that flashes outward
  const hits = ph.events.filter((e) => e.key === 'hit' && e.point).map((e) => {
    const [tid, part] = e.on.split('.');
    const ti = P.world.trees.findIndex((t) => t.id === tid);
    const t = P.world.trees[ti];
    let n;
    if (part === 'trunk') n = new V3(e.point[0] - t.x, 0, e.point[2] - t.z).normalize();
    else {
      const br = branchAxis(P, ti, +part.slice(1));
      const a = new V3(...br.a);
      const d = new V3(...br.d);
      const p = new V3(...e.point);
      const c = a.clone().addScaledVector(d, p.clone().sub(a).dot(d));
      n = p.clone().sub(c).normalize();
    }
    return {tau: e.tau, p: new V3(...e.point), n};
  });
  const cutEv = ph.events.find((e) => e.key === 'cut');
  const NF = napeFrame(P);
  // the nape cut throws leather and pad fibre too
  const bursts = hits.map((h) => ({...h, kind: 'bark'}));
  if (cutEv) bursts.push({tau: cutEv.tau, p: new V3(...NF.c), n: new V3(...NF.n), kind: 'pad'});
  const CHIPS = 26;
  const chipV = bursts.map((b) => {
    const t1 = new V3().crossVectors(b.n, Math.abs(b.n.y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0)).normalize();
    const t2 = new V3().crossVectors(b.n, t1);
    return Array.from({length: CHIPS}, () => {
      const a = r() * Math.PI * 2;
      const s = 0.4 + r() * 0.9;
      const sp = 3 + r() * 7;
      return {v: b.n.clone().multiplyScalar(sp).addScaledVector(t1, Math.cos(a) * s * sp * 0.7).addScaledVector(t2, Math.sin(a) * s * sp * 0.7), spin: r() * 20, size: 0.012 + r() * 0.03};
    });
  });
  const chipGeo = new THREE.BoxGeometry(1, 0.35, 0.6);
  const chips = new THREE.InstancedMesh(chipGeo, new THREE.MeshStandardMaterial({color: HEX.barkDark, roughness: 0.9}), bursts.length * CHIPS);
  chips.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bursts.length * CHIPS * 3), 3);
  bursts.forEach((b, i) => {
    const c = new THREE.Color(b.kind === 'pad' ? '#84442c' : HEX.barkDark);
    for (let k = 0; k < CHIPS; k++) chips.setColorAt(i * CHIPS + k, c);
  });
  chips.frustumCulled = false;
  chips.castShadow = true;
  root.add(chips);
  const rings = bursts.map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({color: HEX.accent, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false}));
    m.renderOrder = 3;
    root.add(m);
    return m;
  });

  // ------------------------------------------------------------ cold-gas puffs: emitted at shots and while a jet fires
  const puffs = [];
  const sampleAt = (tau) => {
    const S = ph.sample(tau);
    return {pos: new V3(...S.pos), q: new THREE.Quaternion(...S.q), v: new V3(...S.vel), jet: new V3(...S.thrust.dir), on: S.thrust.on};
  };
  for (const e of ph.events.filter((x) => x.key === 'fire')) {
    const s = sampleAt(e.tau);
    // the launcher's exhaust vents back and out from the hip
    for (let k = 0; k < 16; k++) {
      // the L line is on +x (the rider's left); the launcher's breech vents at its pivot (rig.js: x 0.242, barrel from z -0.03)
      const side = e.label.includes(' L ') ? 1 : -1;
      const p = new V3(0.242 * side, 0.012, -0.05).applyQuaternion(s.q).add(s.pos);
      const dir = new V3(0.5 * side, -0.2, -1).normalize().applyQuaternion(s.q);
      // a burst that overlaps itself: many small puffs over 40 ms, scattered in speed and direction
      const jit = new V3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.5);
      puffs.push({t0: e.tau + r() * 0.04, p, v: s.v.clone().addScaledVector(dir.clone().add(jit).normalize(), 3 + r() * 9), r0: 0.03, r1: 0.18 + r() * 0.22, life: 0.6 + r() * 0.5});
    }
  }
  for (let i = 0; i < ph.series.t.length; i += 4) {
    if (ph.series.thOn[i] < 0.5) continue;
    const tau = ph.series.t[i];
    const s = sampleAt(tau);
    const p = NOZZLE.clone().applyQuaternion(s.q).add(s.pos);
    puffs.push({t0: tau, p, v: s.v.clone().addScaledVector(s.jet, 26 + r() * 10), r0: 0.05, r1: 0.6 + r() * 0.5, life: 0.9 + r() * 0.4});
  }
  // soft sprites: a point each, sized in metres, a round falloff, fading with age
  const NP = Math.max(1, puffs.length);
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(NP * 3);
  const pSize = new Float32Array(NP);
  const pAlpha = new Float32Array(NP);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  pGeo.setAttribute('alpha', new THREE.BufferAttribute(pAlpha, 1));
  const pMat = new THREE.ShaderMaterial({
    vertexShader: `attribute float size; attribute float alpha; uniform float uScale; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = alpha; gl_PointSize = size * uScale / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uC; varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = clamp(dot(d, d) * 4.0, 0.0, 1.0); float a = pow(1.0 - r, 1.6) * vA; if (a < 0.003) discard; gl_FragColor = vec4(uC, a); }`,
    uniforms: {uScale: {value: 600}, uC: {value: new THREE.Color('#f5f7f9')}},
    transparent: true,
    depthWrite: false,
  });
  const puffMesh = new THREE.Points(pGeo, pMat);
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 4;
  root.add(puffMesh);

  // ------------------------------------------------------------ the trail, coloured by net g, drawn up to tau
  const STEP = 4;
  const n = Math.floor(ph.series.t.length / STEP);
  const tp = new Float32Array(n * 3);
  const tc = new Float32Array(n * 3);
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const j = i * STEP;
    tp[i * 3] = ph.track[j * 3];
    tp[i * 3 + 1] = ph.track[j * 3 + 1];
    tp[i * 3 + 2] = ph.track[j * 3 + 2];
    col.copy(PALE).lerp(ACC, Math.min(1, Math.max(0, (ph.series.net[j] - 0.6) / 3.6)));
    tc[i * 3] = col.r;
    tc[i * 3 + 1] = col.g;
    tc[i * 3 + 2] = col.b;
  }
  const trailGeo = new LineGeometry();
  trailGeo.setPositions(tp);
  trailGeo.setColors(tc);
  const trailMat = new LineMaterial({vertexColors: true, linewidth: 4.5, worldUnits: false, transparent: true, opacity: 0, depthTest: false});
  const trail = new Line2(trailGeo, trailMat);
  trail.frustumCulled = false;
  trail.renderOrder = 20;
  root.add(trail);

  // ------------------------------------------------------------ force arrows: tension at each fairlead, felt load, velocity
  const arrow = (color) => {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0, depthTest: false});
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), m);
    shaft.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 14), m);
    g.add(shaft, head);
    g.renderOrder = 10;
    root.add(g);
    return {g, shaft, head, m};
  };
  const arrows = {L: arrow(HEX.accent), R: arrow(HEX.accent), f: arrow('#3c79a8'), v: arrow('#2fa36b')};
  const UP = new V3(0, 1, 0);
  const tv = new V3();
  const setArrow = (a, from, vec, o, thick) => {
    const l = vec.length();
    a.m.opacity = o;
    a.g.visible = o > 0.01 && l > 1e-3;
    if (!a.g.visible) return;
    a.g.position.copy(from);
    a.g.quaternion.setFromUnitVectors(UP, tv.copy(vec).divideScalar(l));
    const head = Math.min(l * 0.35, thick * 5);
    a.shaft.scale.set(thick, l - head, thick);
    a.shaft.position.y = (l - head) / 2;
    a.head.scale.set(thick * 2.6, head, thick * 2.6);
    a.head.position.y = l - head / 2;
  };

  // ------------------------------------------------------------ the blade arc: tip positions through the cut, from the physics' own blade model
  const arc = (() => {
    if (!cutEv) return null;
    const t0 = cutEv.tau - 0.35;
    const t1 = cutEv.tau + 0.12;
    const tips = [];
    for (let t = t0; t <= t1; t += 1 / 480) {
      const S = ph.sample(t);
      const q = new THREE.Quaternion(...S.q);
      const sh = new V3(0, 0.52, 0).applyQuaternion(q).add(new V3(...S.pos));
      const dirL = new V3(-1, 0, 0).applyQuaternion(q);
      tips.push({t, a: sh.clone().addScaledVector(dirL, P.blade.cutR - 0.42), b: sh.clone().addScaledVector(dirL, P.blade.cutR)});
    }
    const K = 22;
    const pos = new Float32Array(K * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const alpha = new Float32Array(K * 2);
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const idx = [];
    for (let i = 0; i < K - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uC; uniform float uO; varying float vA; void main(){ gl_FragColor = vec4(uC, uO * vA); }`,
      // a pale warm streak reads as the blade's motion blur; additive so it brightens what it crosses
      uniforms: {uC: {value: new THREE.Color('#ffd9c4')}, uO: {value: 0}},
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    root.add(mesh);
    return {tips, pos, alpha, geo, m, K, t0, t1};
  })();

  // ------------------------------------------------------------ the frame
  const m4 = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  const sc = new V3();
  const a = new V3();
  const b = new V3();
  const d = new V3();
  const qBody = new THREE.Quaternion();
  const pix = new V3();
  const ropePx = (camera, p, size) => {
    const dist = Math.max(0.05, camera.position.distanceTo(p));
    const pxPerM = size.h / (2 * Math.tan((camera.fov * Math.PI) / 360) * dist);
    return P.tether.d * pxPerM;
  };

  const update = (S, D = {}, camera = null, size = {w: 1600, h: 900}) => {
    const tau = S.tau;
    qBody.set(S.q[0], S.q[1], S.q[2], S.q[3]);
    // tethers and anchors
    for (let i = 0; i < 2; i++) {
      const w = S.wires[i];
      const t = tethers[i];
      const an = anchors[i];
      const shown = w.state !== 'stowed' && w.length > 0.2;
      t.line.visible = shown;
      an.visible = w.state === 'flight' || w.state === 'anchored' || w.state === 'retract';
      if (!shown) continue;
      a.set(w.exit[0], w.exit[1], w.exit[2]);
      b.set(w.tip[0], w.tip[1], w.tip[2]);
      const span = a.distanceTo(b);
      // a parabolic droop for the slack: sag ~ sqrt(3/8 * span * slack), plus a little in flight while it pays out
      const sag = Math.sqrt(Math.max(0, 0.375 * span * (w.slack + (w.state === 'flight' ? 0.05 : 0) + (w.state === 'retract' ? 0.15 : 0))));
      for (let k = 0; k <= SEG; k++) {
        const u = k / SEG;
        pts[k].lerpVectors(a, b, u);
        pts[k].y -= 4 * sag * u * (1 - u);
      }
      setLine(t, pts);
      const load = Math.min(1, w.tension / 4000);
      t.m.color.copy(ROPE).lerp(ACC, load * 0.9);
      const px = camera ? ropePx(camera, pix.lerpVectors(a, b, 0.15), size) : 2;
      t.m.linewidth = Math.min(7, Math.max(1.7, px));
      t.m.resolution.set(size.w, size.h);
      t.m.opacity = D.isolate ? 0.35 : 1;
      // the anchor points along its line: away from the rider in flight and set, home while retracting
      d.subVectors(b, a).normalize();
      an.position.copy(b);
      if (w.state === 'retract') d.negate();
      an.quaternion.setFromUnitVectors(Z, d);
      if (w.state === 'retract') d.negate();
      const set = w.state === 'anchored' ? 1 : 0;
      for (const f of an.userData.flukes) f.rotation.x = -0.9 * set;
      // seated a little into the wood once set
      if (set) an.position.addScaledVector(d, 0.08);
    }

    // chips and rings
    let ci = 0;
    bursts.forEach((bu, bi) => {
      const age = tau - bu.tau;
      const live = age >= 0 && age < 1.6;
      for (let k = 0; k < CHIPS; k++) {
        const c = chipV[bi][k];
        if (!live) {
          m4.makeScale(0, 0, 0);
        } else {
          pix.copy(bu.p).addScaledVector(c.v, age);
          pix.y -= 4.9 * age * age;
          qq.setFromAxisAngle(sc.set(0.3, 1, 0.2).normalize(), c.spin * age);
          const s = c.size * (1 - Math.max(0, age - 1.1) / 0.5);
          m4.compose(pix, qq, sc.set(s, s, s));
        }
        chips.setMatrixAt(ci++, m4);
      }
      const ring = rings[bi];
      const rage = age / 0.45;
      ring.visible = rage >= 0 && rage < 1;
      if (ring.visible) {
        ring.position.copy(bu.p).addScaledVector(bu.n, 0.02);
        ring.quaternion.setFromUnitVectors(Z, bu.n);
        const rr = 0.1 + rage * (bu.kind === 'pad' ? 1.4 : 0.9);
        ring.scale.set(rr, rr, rr);
        ring.material.opacity = 0.75 * (1 - rage);
      }
    });
    chips.instanceMatrix.needsUpdate = true;

    // puffs: carried by the jet, slowed by the air, swelling and fading
    if (camera) pMat.uniforms.uScale.value = (size.h * (window.devicePixelRatio || 1)) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      const age = tau - p.t0;
      if (age < 0 || age > p.life) {
        pAlpha[i] = 0;
        pSize[i] = 0;
        continue;
      }
      const k = 3.2;
      const travel = (1 - Math.exp(-k * age)) / k;
      pix.copy(p.p).addScaledVector(p.v, travel);
      pix.y += 0.25 * age * age;
      const u = age / p.life;
      pPos[i * 3] = pix.x;
      pPos[i * 3 + 1] = pix.y;
      pPos[i * 3 + 2] = pix.z;
      pSize[i] = 2 * (p.r0 + (p.r1 - p.r0) * Math.sqrt(u));
      pAlpha[i] = 0.5 * Math.min(1, age / 0.06) * (1 - u) * (1 - u);
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.size.needsUpdate = true;
    pGeo.attributes.alpha.needsUpdate = true;

    // trail up to now
    const tOn = D.trail ?? 0;
    trail.visible = tOn > 0.01;
    if (trail.visible) {
      trailGeo.instanceCount = Math.max(0, Math.min(n - 1, Math.floor((tau * ph.REC) / STEP)));
      trailMat.opacity = tOn;
      trailMat.resolution.set(size.w, size.h);
    }

    // force arrows: 0.35 m per kN of tension, 0.5 m per g of felt load, 0.08 m per m/s
    const fo = D.forces ?? 0;
    const thick = camera ? Math.max(0.006, 0.0025 * camera.position.distanceTo(pix.set(S.pos[0], S.pos[1], S.pos[2]))) : 0.01;
    for (const [k, i] of [['L', 0], ['R', 1]]) {
      const w = S.wires[i];
      a.set(w.exit[0], w.exit[1], w.exit[2]);
      d.set(w.tip[0], w.tip[1], w.tip[2]).sub(a);
      const T = w.state === 'anchored' ? w.tension : 0;
      d.normalize().multiplyScalar((0.35 * T) / 1000);
      setArrow(arrows[k], a, d, fo * (T > 50 ? 1 : 0), thick);
    }
    a.set(S.pos[0], S.pos[1], S.pos[2]);
    const fW = d.set(S.acc[0], S.acc[1] + P.g0, S.acc[2]).multiplyScalar(0.5 / P.g0);
    setArrow(arrows.f, a, fW, fo, thick);
    setArrow(arrows.v, a, b.set(S.vel[0], S.vel[1], S.vel[2]).multiplyScalar(0.08), fo * 0.8, thick * 0.8);

    // the blade's arc: the last 0.07 s of the left blade's sweep, brightest at the edge
    if (arc) {
      const live = tau >= arc.t0 && tau <= arc.t1 + 0.15;
      arc.m.uniforms.uO.value = live ? Math.min(1, (arc.t1 + 0.15 - tau) / 0.15) * 0.45 : 0;
      if (live) {
        const i1 = Math.min(arc.tips.length - 1, Math.max(0, Math.round((tau - arc.t0) * 480)));
        for (let k = 0; k < arc.K; k++) {
          const j = Math.max(0, i1 - (arc.K - 1 - k));
          const tp0 = arc.tips[j];
          arc.pos[k * 6] = tp0.a.x;
          arc.pos[k * 6 + 1] = tp0.a.y;
          arc.pos[k * 6 + 2] = tp0.a.z;
          arc.pos[k * 6 + 3] = tp0.b.x;
          arc.pos[k * 6 + 4] = tp0.b.y;
          arc.pos[k * 6 + 5] = tp0.b.z;
          const al = k / (arc.K - 1);
          arc.alpha[k * 2] = al * al * 0.1;
          arc.alpha[k * 2 + 1] = al * al;
        }
        arc.geo.attributes.position.needsUpdate = true;
        arc.geo.attributes.alpha.needsUpdate = true;
      }
    }
  };

  return {root, update, puffs, bursts};
}
