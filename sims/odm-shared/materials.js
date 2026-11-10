// One palette for every module, so the rig, the rider and the forest read as one study model on a pale studio.
// mat(key) returns a fresh material (callers that tint or fade a part need their own copy); MAT holds shared ones.
// Metals carry envMapIntensity ~2 because the stage keeps the scene environment low for legible shadows.
// accent(mesh, k) blends a part toward the accent colour (the part that is working right now), keyed on k 0..1.
// ghost() is the x-ray shell: a fresnel rim, nearly clear face on.
import * as THREE from 'three';

export const HEX = {
  gunmetal: '#4a4f57',
  steel: '#9aa0a8',
  darkSteel: '#2e3238',
  brass: '#b08a4a',
  copper: '#b0673e',
  carbon: '#24262b',
  leather: '#5a3a26',
  webbing: '#3b3430',
  rubber: '#1d1e21',
  blade: '#c9ced4',
  bladeEdge: '#eef1f4',
  grip: '#6b4a2f',
  mannequin: '#c9c4bb',
  suit: '#8a7a62',
  trousers: '#e8e4da',
  bark: '#7d6f5e',
  barkDark: '#5f5446',
  wood: '#b8996e',
  woodDark: '#8c6f4c',
  tether: '#e9e4d6',
  accent: '#e3562a',
  ink: '#22252b',
  glass: '#cfe3ea',
};

const DEF = {
  gunmetal: {color: HEX.gunmetal, metalness: 0.8, roughness: 0.45, envMapIntensity: 2.0},
  steel: {color: HEX.steel, metalness: 0.85, roughness: 0.45, envMapIntensity: 2.2},
  darkSteel: {color: HEX.darkSteel, metalness: 0.75, roughness: 0.5, envMapIntensity: 1.8},
  brass: {color: HEX.brass, metalness: 0.9, roughness: 0.45, envMapIntensity: 2.2},
  copper: {color: HEX.copper, metalness: 0.9, roughness: 0.45, envMapIntensity: 2.0},
  carbon: {color: HEX.carbon, metalness: 0.25, roughness: 0.5, envMapIntensity: 1.6},
  leather: {color: HEX.leather, metalness: 0.0, roughness: 0.7},
  webbing: {color: HEX.webbing, metalness: 0.0, roughness: 0.85},
  rubber: {color: HEX.rubber, metalness: 0.0, roughness: 0.8},
  blade: {color: HEX.blade, metalness: 0.9, roughness: 0.45, envMapIntensity: 2.4},
  grip: {color: HEX.grip, metalness: 0.0, roughness: 0.65},
  mannequin: {color: HEX.mannequin, metalness: 0.0, roughness: 0.75},
  suit: {color: HEX.suit, metalness: 0.0, roughness: 0.85},
  trousers: {color: HEX.trousers, metalness: 0.0, roughness: 0.85},
  bark: {color: HEX.bark, metalness: 0.0, roughness: 0.95},
  wood: {color: HEX.wood, metalness: 0.0, roughness: 0.8},
  tether: {color: HEX.tether, metalness: 0.0, roughness: 0.6},
};

export function mat(key, over = {}) {
  const d = DEF[key];
  if (!d) throw new Error(`no material ${key}`);
  const m = new THREE.MeshStandardMaterial({...d, ...over});
  m.userData.base = new THREE.Color(m.color);
  m.userData.baseEmissive = new THREE.Color(0, 0, 0);
  return m;
}

export const MAT = Object.fromEntries(Object.keys(DEF).map((k) => [k, mat(k)]));

const ACC = new THREE.Color(HEX.accent);
const tmp = new THREE.Color();
/** Blend every material under obj toward the accent by k (0..1). Materials must be per-part (mat(), not MAT.*). */
export function accent(obj, k) {
  obj.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (!m.userData.base) continue;
      m.color.copy(m.userData.base).lerp(ACC, k * 0.85);
      if (m.emissive) m.emissive.copy(tmp.copy(ACC).multiplyScalar(k * 0.18));
    }
  });
}

/** Fade every material under obj to opacity a (1 = solid). Keeps depthWrite off while faded so ghosts layer cleanly. */
export function fade(obj, a) {
  obj.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      const f = a < 0.999;
      if (m.transparent !== f) {
        m.transparent = f;
        m.needsUpdate = true;
      }
      m.opacity = a;
      m.depthWrite = !f || a > 0.6;
    }
    if (o.isMesh) o.castShadow = a > 0.5 && o.userData.noShadow !== true;
  });
}

const GHOST_VERT = /* glsl */ `varying vec3 vN; varying vec3 vV;
  #include <common>
  #include <skinning_pars_vertex>
  void main(){
    #include <skinbase_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const GHOST_FRAG = /* glsl */ `uniform vec3 uCol; uniform float uA; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(uCol, uA * (0.06 + 0.7 * f)); }`;
/** The x-ray shell: set .uniforms.uA.value (0..1) to fade it in. */
export function ghost(color = '#8fb3c4') {
  return new THREE.ShaderMaterial({
    vertexShader: GHOST_VERT,
    fragmentShader: GHOST_FRAG,
    uniforms: {uCol: {value: new THREE.Color(color)}, uA: {value: 0}},
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Shadow flags on every mesh under obj. */
export function shadows(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return obj;
}
