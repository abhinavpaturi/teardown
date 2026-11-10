// Where the cut swing passes the nape (no kick): iterate the anchor's place along T4's branch and the cut line length
// until the pelvis passes 1.8 m behind the neck axis's plane... and the shoulders sit at nape height.
import {P} from '../odm-shared/params.js';
import {buildSortie, TUNE} from '../odm-shared/physics.js';

let along4 = TUNE.along4;
let dLcut = TUNE.dLcut;
for (let it = 0; it < 10; it++) {
  let pass = null;
  buildSortie(P, {
    tune: {along4, dLcut, kickLead: -1},
    until: (s) => {
      if (!pass && s.x[2] >= P.world.dummy.z) {
        const q = s.q;
        // spine y axis from the attitude quaternion
        const [x, y, z, w] = q;
        const yb = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
        pass = {x: s.x[0], sh: s.x[1] + 0.52 * yb[1], v: Math.hypot(...s.v)};
      }
      return !!pass || s.t > 25;
    },
  });
  console.log(`along4 ${along4.toFixed(3)} dLcut ${dLcut.toFixed(3)} -> pass x ${pass.x.toFixed(3)} shoulder ${pass.sh.toFixed(3)} v ${pass.v.toFixed(1)}`);
  along4 += (pass.x - 1.8) * 1.0;
  dLcut += (pass.sh - P.world.dummy.nape.y) * 0.35;
}
