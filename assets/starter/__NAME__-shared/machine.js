// The geometry, built from code in real units, so changing a dimension in model.js changes the part. update(m, D) poses it from the
// model; nothing is animated by hand. D: {glass 0..1 (the liner turns see-through), explode 0..1 (parts move apart along their own vectors)}.
// checks() states what must stay true, in world space, so a wrong sign in update() fails scripts/smoke.mjs instead of waiting to be noticed.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

const metal = (color, over = {}) => new THREE.MeshStandardMaterial({color, metalness: 0.35, roughness: 0.5, envMapIntensity: 2, ...over});

/** Where the machine ends, top and bottom: the camera frames this, whatever the dimensions. U scales the small parts with the crank. */
export function envelope(P) {
  const U = P.r / 0.045;
  const linerY = P.l + 0.012 * U;
  const linerH = 2 * P.r + 0.085 * U;
  return {U, linerY, linerH, top: linerY + linerH / 2, floor: -P.r * 1.35 - 0.065 * U};
}

export function buildMachine(P) {
  const {U, linerY, linerH} = envelope(P);
  const root = new THREE.Group();
  const add = (geo, mat, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const crank = new THREE.Group();
  root.add(crank);
  const web = add(new THREE.CylinderGeometry(P.r * 1.35, P.r * 1.35, 0.018 * U, 48), metal('#8b929b'), crank);
  web.rotation.x = Math.PI / 2;
  const pin = add(new THREE.CylinderGeometry(0.009 * U, 0.009 * U, 0.05 * U, 24), metal('#d6a24e'), crank);
  pin.rotation.x = Math.PI / 2;
  pin.position.set(0, P.r, 0.012 * U);
  const rodG = new THREE.Group();
  root.add(rodG);
  const rod = add(new RoundedBoxGeometry(0.018 * U, P.l, 0.012 * U, 3, 0.004 * U), metal('#c3c8ce'), rodG);
  rod.position.y = P.l / 2;
  const piston = new THREE.Group();
  root.add(piston);
  const crownH = 0.05 * U;
  const crownY = 0.012 * U;
  const crown = add(new THREE.CylinderGeometry(P.bore / 2 - 0.001 * U, P.bore / 2 - 0.001 * U, crownH, 48), metal('#e8eaec'), piston);
  crown.position.y = crownY;
  const glassMat = metal('#9aa2ab', {transparent: true, side: THREE.DoubleSide});
  const liner = add(new THREE.CylinderGeometry(P.bore / 2 + 0.003 * U, P.bore / 2 + 0.003 * U, linerH, 64, 1, true), glassMat);
  const Z = 0.03 * U;
  liner.position.set(0, linerY, Z);
  const base = add(new RoundedBoxGeometry(0.2 * U, 0.05 * U, 0.11 * U, 3, 0.008 * U), metal('#6d747d'));
  base.position.set(0, -P.r * 1.35 - 0.04 * U, 0.015 * U);

  // the ends of the joints checks() measures
  const pinPoint = new THREE.Object3D();
  pinPoint.position.y = P.r;
  crank.add(pinPoint);
  const rodTip = new THREE.Object3D();
  rodTip.position.y = P.l;
  rodG.add(rodTip);
  const seat = new THREE.Object3D();
  piston.add(seat);
  let explode = 0;

  return {
    root,
    crankAngle: () => -crank.rotation.z,
    labels: [
      // top to bottom in the order they sit on the machine, so the leaders do not cross
      {name: 'PISTON', sub: `${(P.bore * 1000).toFixed(0)} MM BORE`, at: () => piston.getWorldPosition(new THREE.Vector3())},
      {name: 'CRANK', sub: `${(P.r * 2000).toFixed(0)} MM STROKE`, at: () => crank.getWorldPosition(new THREE.Vector3())},
    ],
    update(m, D = {}) {
      const e = (explode = D.explode ?? 0);
      // each part moves out along the line it can leave the machine by
      crank.rotation.z = -m.th;
      crank.position.z = -0.06 * U * e;
      rodG.position.set(m.pinX, m.pinY, Z + 0.05 * U * e);
      rodG.rotation.z = m.rod;
      piston.position.set(0, m.y + 0.045 * U * e, Z);
      liner.position.y = linerY + 0.085 * U * e;
      glassMat.opacity = 1 - 0.8 * (D.glass ?? 0);
      glassMat.depthWrite = (D.glass ?? 0) < 0.5;
    },
    checks() {
      if (explode > 0) return []; // pulled apart on purpose
      const at = (o) => o.getWorldPosition(new THREE.Vector3());
      const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * 1000;
      const big = gap(at(pinPoint), rodG.position);
      const small = gap(at(rodTip), at(seat));
      const crownTop = piston.position.y + crownY + crownH / 2;
      const crownBottom = piston.position.y + crownY - crownH / 2;
      const out = Math.max(crownTop - (linerY + linerH / 2), linerY - linerH / 2 - crownBottom, 0) * 1000;
      return [
        {name: 'the rod sits on the crank pin', ok: big < 0.5, detail: `${big.toFixed(2)} mm off at worst`, value: big},
        {name: 'the rod reaches the piston', ok: small < 0.5, detail: `${small.toFixed(2)} mm off at worst`, value: small},
        {name: 'the piston stays in its liner', ok: out < 0.5, detail: `${out.toFixed(2)} mm outside at worst`, value: out},
      ];
    },
  };
}
