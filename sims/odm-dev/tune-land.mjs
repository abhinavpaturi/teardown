// The final swing: for a few final line lengths, how low the bottom gets (ground clearance) and where the climb ends.
// T6 then goes beyond that apex with its branch top 0.3 m under the rider's feet.  node sims/odm-dev/tune-land.mjs
import {P as P0} from '../odm-shared/params.js';
import {buildSortie} from '../odm-shared/physics.js';

const P = JSON.parse(JSON.stringify(P0));
P.world.trees = P.world.trees.filter((t) => t.id !== 'T6');
for (const Lfinal of [38, 39, 40, 41, 42, 43, 44]) {
  let apex = null;
  let minY = 99;
  buildSortie(P, {
    tune: {Lfinal},
    until: (s) => {
      if (s.step >= 18) minY = Math.min(minY, s.x[1]);
      if (s.climbed && s.v[1] <= 0.3 && !apex) apex = {x: s.x.map((v) => +v.toFixed(2)), v: +Math.hypot(...s.v).toFixed(2), t: +s.t.toFixed(2)};
      return !!apex || s.t > 40;
    },
  });
  const feet = apex ? apex.x[1] - P.body.hipY : NaN;
  console.log(`Lfinal ${Lfinal}: bottom pelvis y ${minY.toFixed(2)} (feet ${(minY - P.body.hipY).toFixed(2)})  apex ${JSON.stringify(apex)}  -> T6 z ${(apex.x[2] + 7.5).toFixed(2)}, branch top ${(feet - 0.3).toFixed(2)}`);
}
