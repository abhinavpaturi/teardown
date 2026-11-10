// Grid search for the cut swing: how hard to pump on T3, when to release, where to fire into T4's branch and how high
// that branch sits, so the rider passes behind the nape at the right height and speed without touching anything.
//   node sims/odm-dev/tune.mjs
import {P as P0} from '../odm-shared/params.js';
import {buildSortie} from '../odm-shared/physics.js';

const NAPE_Z = P0.world.dummy.z;
const results = [];
for (const h4 of [31, 33, 35, 37])
  for (const pump3 of [8])
    for (const rel3 of [16, 22, 28, 34, 40, 46, 52])
      for (const fire4z of [170, 174, 178, 182, 186, 190]) {
        const P = JSON.parse(JSON.stringify(P0));
        P.world.trees[4].branches[0][0] = h4;
        P.world.dummy.face = P0.world.dummy.face;
        let cross = null;
        let hitL = null;
        const ph = buildSortie(P, {
          tune: {pump3, rel3, fire4z, kickLead: -1},
          until: (s) => {
            const w = s.wires[0];
            if (w.mode === 'anchored' && hitL === null && w.anchor[2] > 200) hitL = w.L;
            if (!cross && s.x[2] >= NAPE_Z) cross = {x: s.x[0], y: s.x[1], v: Math.hypot(...s.v), net: Math.hypot(...s.f), L: w.L, t: s.t, hits: {...s.hits}};
            return !!cross || s.t > 25;
          },
        });
        if (!cross) continue;
        const shoulder = cross.y + 0.52 * Math.cos(1.08);
        const strikes = cross.hits.ground + cross.hits.trunk + cross.hits.branch;
        const score = Math.abs(shoulder - P.world.dummy.nape.y) * 4 + Math.abs(cross.x - 1.8) * 2 + Math.max(0, cross.v - 21) + Math.max(0, 15 - cross.v) + strikes * 50 + Math.max(0, (hitL ?? 99) - cross.L - 4);
        results.push({h4, pump3, rel3, fire4z, shoulder: +shoulder.toFixed(2), x: +cross.x.toFixed(2), v: +cross.v.toFixed(1), net: +cross.net.toFixed(2), hitL: hitL && +hitL.toFixed(1), L: +cross.L.toFixed(1), t: +cross.t.toFixed(2), strikes: `${cross.hits.ground.toFixed(2)}/${cross.hits.trunk.toFixed(2)}/${cross.hits.branch.toFixed(2)}`, score: +score.toFixed(2)});
      }
results.sort((a, b) => a.score - b.score);
console.log(`${results.length} runs`);
for (const r of results.slice(0, 12)) console.log(JSON.stringify(r));
