// The spin kick: when to slide the fairlead out (seconds before the bottom) and how far, so one blade sweeps the nape.
//   node sims/odm-dev/tune-cut.mjs
import {P} from '../odm-shared/params.js';
import {buildSortie} from '../odm-shared/physics.js';

const out = [];
for (let kickLead = 0.04; kickLead <= 0.5; kickLead += 0.01)
  for (const kick of [0.6, 0.68, 0.75, 0.82]) {
    let spinAtRel = 0;
    let passX = 0;
    let passY = 0;
    const ph = buildSortie(P, {
      tune: {kickLead, kick},
      until: (s) => {
        if (s.spinMode === 'free' && !spinAtRel) spinAtRel = s.omega / (2 * Math.PI);
        if (!passX && s.x[2] >= P.world.dummy.z) [passX, passY] = [s.x[0], s.x[1]];
        return s.t > 17.5;
      },
    });
    const c = ph.check;
    out.push({kickLead: +kickLead.toFixed(2), kick, cut: c.cut, cutT: +c.cutTau.toFixed(3), spin: +spinAtRel.toFixed(2), Gy: +c.maxGy.toFixed(2), GyT: +(c.peakT.Gy ?? 0).toFixed(2), passX: +passX.toFixed(2), passY: +passY.toFixed(2)});
  }
const hits = out.filter((r) => r.cut);
console.log(`${out.length} runs, ${hits.length} cut`);
for (const r of hits.sort((a, b) => Math.abs(a.spin - 1.25) - Math.abs(b.spin - 1.25)).slice(0, 15)) console.log(JSON.stringify(r));
if (!hits.length) for (const r of out.slice(0, 12)) console.log(JSON.stringify(r));
