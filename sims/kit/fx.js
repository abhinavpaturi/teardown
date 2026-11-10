// Two things that move through the air, from ODM-E1: a screen-space line (a rope, a cable, a beam) whose buffers are written
// in place, no per-frame allocation, and soft puffs of gas or dust as sprites sized in metres. Spheres read as rocks; a
// round falloff reads as gas. Both are transparent, so add their root to st.aoHide or GTAO draws a contact shadow behind them.
import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';

/** A polyline of `seg` segments. set(points) takes seg + 1 Vector3s. width in px; size is {w, h} of the layout. */
export function createFatLine(seg, {color = '#5d6168', width = 2} = {}) {
  const geo = new LineGeometry();
  geo.setPositions(new Float32Array((seg + 1) * 3));
  const material = new LineMaterial({color: new THREE.Color(color).getHex(), linewidth: width, worldUnits: false, transparent: true});
  const line = new Line2(geo, material);
  line.frustumCulled = false;
  const buf = geo.attributes.instanceStart.data;
  return {
    line, material,
    set(pts) {
      const a = buf.array;
      for (let i = 0; i < seg; i++) {
        const p = pts[i];
        const q = pts[i + 1];
        a[i * 6] = p.x; a[i * 6 + 1] = p.y; a[i * 6 + 2] = p.z;
        a[i * 6 + 3] = q.x; a[i * 6 + 4] = q.y; a[i * 6 + 5] = q.z;
      }
      buf.needsUpdate = true;
    },
    size(w, h) {
      material.resolution.set(w, h);
    },
  };
}

/** Pixels a real thickness projects to at point p: keep a thin line true up close and legible far away with a clamp. */
export const projectedPx = (camera, p, h, metres) => (metres * h) / (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(0.05, camera.position.distanceTo(p)));

/** n soft sprites. set(i, x, y, z, radius, alpha), hide(i), then commit(camera, layoutHeight) once a frame. */
export function createPuffs(n, {color = '#f5f7f9'} = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const alpha = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: `attribute float size; attribute float alpha; uniform float uScale; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = alpha; gl_PointSize = size * uScale / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uC; varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = clamp(dot(d, d) * 4.0, 0.0, 1.0); float a = pow(1.0 - r, 1.6) * vA; if (a < 0.003) discard; gl_FragColor = vec4(uC, a); }`,
    uniforms: {uScale: {value: 600}, uC: {value: new THREE.Color(color)}},
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 4;
  return {
    points,
    set(i, x, y, z, radius, a) {
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      size[i] = radius * 2;
      alpha[i] = a;
    },
    hide(i) {
      size[i] = 0;
      alpha[i] = 0;
    },
    commit(camera, h) {
      material.uniforms.uScale.value = (h * (globalThis.devicePixelRatio || 1)) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      geo.attributes.position.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
      geo.attributes.alpha.needsUpdate = true;
    },
  };
}
