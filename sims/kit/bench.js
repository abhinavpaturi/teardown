// A bench for building one part at a time: the real studio, an optional floor, and a pure render(t) so capture.mjs can
// take stills of it. A dev entry is a folder with a main.js:
//
//   import {runBench} from 'teardown-kit/bench.js';
//   runBench(({st, THREE}) => {
//     const part = buildThing(); st.scene.add(part.root);
//     return (t) => { part.update(t); return {target: [0, 1, 0], az: 0.6 + 0.2 * t, el: 0.25, d: 3}; };
//   }, {duration: 8});
//
// then: node "$SKILL_DIR/sims/build.mjs" ./dev/thing && node "$SKILL_DIR/sims/capture.mjs" thing --size 1600x900 --still 2
import * as THREE from 'three';
import {runSim} from './runtime.js';
import {COL, createStudio} from './studio.js';

export function runBench(build, {duration = 8, floor = true, title = 'bench', palette} = {}) {
  const DEFAULTS = {duration, fps: 60, theme: 'light', hud: {enabled: false, title, subtitle: ''}, director: {enabled: false}, watermark: ''};
  return runSim(DEFAULTS, async ({canvas, capture}) => {
    const st = createStudio({canvas, palette});
    const resize = () => st.resize(innerWidth, innerHeight, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
    resize();
    if (floor) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({color: COL.ground, roughness: 0.95}));
      g.rotation.x = -Math.PI / 2;
      g.receiveShadow = true;
      st.scene.add(g);
    }
    const pose = await build({st, THREE});
    window.ST = st;
    return {
      resize,
      render(t) {
        st.frame(pose(t));
        return {};
      },
    };
  });
}
