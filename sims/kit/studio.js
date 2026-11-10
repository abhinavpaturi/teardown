// A general stage for a machine of any size: a pale, hazy studio big enough for a forest of 80 m trees and close enough
// for a 4 mm tether. Pass {palette} to change its colours.
// One sun with a soft shadow that follows the camera target (texel-snapped so it never shimmers), a sky light, a
// soft-box environment for the metal to catch, GTAO for contact shading on close shots only, and a near plane that
// scales with the camera distance so a 1.75 m rider and a 300 m vista both keep their depth precision.
// frame(cam) places the camera and draws one frame; everything in the scene is posed by the caller first.
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {Pass} from 'three/addons/postprocessing/Pass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';

const V3 = THREE.Vector3;
// the studio palette: a warm haze over a cool forest floor, one accent for whatever is working right now
export const COL = {
  skyTop: '#eef1f2',
  skyLow: '#e6e1d6',
  haze: '#e9e5dc',
  ground: '#d9d3c4',
  shadow: '#4b4a52',
  accent: '#e3562a',
  ink: '#22252b',
};

export function createStudio({canvas, palette = {}}) {
  const PAL = {...COL, ...palette};
  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  {
    // a screen-space sky: pale at the top, warmer toward the horizon, so the haze meets it without a seam
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 512;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, PAL.skyTop);
    gr.addColorStop(0.62, PAL.haze);
    gr.addColorStop(1, PAL.skyLow);
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
  }
  // depth haze: the far trees fade into the sky colour; the near distance moves with the camera (frame)
  scene.fog = new THREE.Fog(PAL.haze, 60, 420);

  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.02, 1500);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType, samples: 8}));
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 4, 4);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.7;
  gtao.updateGtaoMaterial({radius: 0.05, distanceExponent: 1.4, thickness: 0.5, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false});
  gtao.updatePdMaterial({lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16});
  // GTAO draws its own normal and depth pass of the whole scene, transparent effects included, so a slash of light or a
  // puff would leave a dark contact shadow behind it: whatever is in aoHide is hidden for that pass only
  const aoHide = [];
  class Toggle extends Pass {
    constructor(v) {
      super();
      this.needsSwap = false;
      this.v = v;
    }
    render() {
      for (const o of aoHide) o.visible = this.v;
    }
  }
  composer.addPass(new Toggle(false));
  composer.addPass(gtao);
  composer.addPass(new Toggle(true));
  composer.addPass(new OutputPass());

  {
    // soft boxes for the gunmetal, brass and carbon to catch: a big top light, two strips, a warm floor bounce
    const env = new THREE.Scene();
    env.background = new THREE.Color('#e4e2dc');
    const box = (w, h, pos, k, tint = [1, 0.985, 0.96]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: new THREE.Color(...tint).multiplyScalar(k), side: THREE.DoubleSide}));
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    box(12, 12, new V3(0, 14, 2), 2.6);
    box(3, 14, new V3(-12, 4, 6), 3.2);
    box(3, 14, new V3(12, 4, -4), 2.2);
    box(18, 2, new V3(0, 2, 14), 1.4);
    box(30, 30, new V3(0, -10, 0), 0.9, [0.92, 0.88, 0.8]);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.02).texture;
    // kept low so the sun's shadow still reads on the pale ground; metals raise envMapIntensity (1.5-2.5) to catch the boxes
    scene.environmentIntensity = 0.35;
    pm.dispose();
  }

  const SUN_DIR = new V3(-0.42, 0.8, 0.43).normalize();
  const sun = new THREE.DirectionalLight('#fff4e6', 2.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 3;
  sun.shadow.blurSamples = 16;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const sky = new THREE.HemisphereLight('#f6f7fb', '#c9bfa9', 0.35);
  scene.add(sky);

  const size = {w: 1600, h: 900};
  const resize = (w, h, pr) => {
    size.w = w;
    size.h = h;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  // the sun's shadow box follows the camera target, snapped to whole texels so it never shimmers
  const right = new V3().crossVectors(new V3(0, 1, 0), SUN_DIR).normalize();
  const upL = new V3().crossVectors(SUN_DIR, right);
  let shadowRes = 4096;
  let shadowExt = -1;
  const setShadowBox = (focus, ext) => {
    if (Math.abs(ext - shadowExt) > 1e-6) {
      shadowExt = ext;
      // the depth range covers casters up to ~100 m above the focus (the canopy) without wasting precision
      Object.assign(sun.shadow.camera, {left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: ext * 4 + 240});
      sun.shadow.camera.updateProjectionMatrix();
    }
    const texel = (2 * ext) / shadowRes;
    const rr = Math.round(focus.dot(right) / texel) * texel;
    const uu = Math.round(focus.dot(upL) / texel) * texel;
    sun.target.position.copy(right).multiplyScalar(rr).addScaledVector(upL, uu).addScaledVector(SUN_DIR, focus.dot(SUN_DIR));
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, ext * 2 + 120);
    sun.target.updateMatrixWorld();
  };

  const focus = new V3();
  const up = new V3(0, 1, 0);
  // cam: either {target:[x,y,z], az, el, d (radians, metres)} orbiting the target, or {pos:[x,y,z], target:[x,y,z]}.
  // Optional: fov (deg), roll (rad), sx/sy (px shift of the projection centre), shadow (half-size of the shadow box
  // in metres, default from the distance), ao (0..1, default on below 9 m), haze ([near, far] fog distances).
  // place(cam) aims the camera and sets haze, shadow box and AO for it; draw() renders; frame(cam) does both. Callers
  // that size things by the camera (the tether width, the callouts) place first, update, then draw.
  const frame = (cam) => {
    place(cam);
    composer.render();
  };
  const draw = () => composer.render();
  const place = (cam) => {
    const t = cam.target;
    focus.set(t[0], t[1], t[2]);
    if (cam.pos) camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    else camera.position.set(t[0] + cam.d * Math.cos(cam.el) * Math.sin(cam.az), t[1] + cam.d * Math.sin(cam.el), t[2] + cam.d * Math.cos(cam.el) * Math.cos(cam.az));
    const d = camera.position.distanceTo(focus);
    if (cam.fov && Math.abs(camera.fov - cam.fov) > 1e-4) camera.fov = cam.fov;
    camera.near = Math.min(0.5, Math.max(0.01, d * 0.012));
    camera.far = Math.max(600, d * 40);
    camera.up.copy(up);
    camera.lookAt(focus);
    if (cam.roll) camera.rotateZ(cam.roll);
    camera.setViewOffset(size.w, size.h, -(cam.sx ?? 0), -(cam.sy ?? 0), size.w, size.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const haze = cam.haze ?? [Math.max(40, d * 6), Math.max(420, d * 30)];
    scene.fog.near = haze[0];
    scene.fog.far = haze[1];
    setShadowBox(focus, cam.shadow ?? Math.min(60, Math.max(2.5, d * 0.9)));
    const ao = cam.ao ?? (d < 9 ? 1 : 0);
    gtao.enabled = aoAllowed && ao > 0.01;
    gtao.blendIntensity = 0.7 * ao;
  };

  const pv = new V3();
  /** World point → CSS px on the 1600 x 900 layout, or null behind the camera. */
  const project = (x, y, z) => {
    pv.set(x, y, z).project(camera);
    if (pv.z > 1) return null;
    return [(pv.x * 0.5 + 0.5) * size.w, (-pv.y * 0.5 + 0.5) * size.h];
  };

  let aoAllowed = true;
  const setQuality = ({samples, ao, shadow}) => {
    if (samples !== undefined)
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        t.samples = samples;
        t.dispose();
      }
    if (ao !== undefined) aoAllowed = ao;
    if (shadow !== undefined) {
      shadowRes = shadow;
      sun.shadow.mapSize.set(shadow, shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  };
  return {THREE, renderer, scene, camera, composer, gtao, sun, sky, size, resize, frame, place, draw, project, setQuality, SUN_DIR, aoHide};
}
