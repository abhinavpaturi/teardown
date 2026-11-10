// Writes odm-film/timeline.json: every beat of the film in film seconds, for the score and the review sheets.
//   node sims/odm-dev/timeline.mjs
import fs from 'node:fs';
import {DURATION, filmAt, PH, SCRIPT, SLOW, TAIL, TEAR, timeAt} from '../odm-shared/timeline.js';

const at = (key) => PH.events.filter((e) => e.key === key).map((e) => +filmAt(e.tau).toFixed(3));
const clicks = SCRIPT.filter((e) => e.t > 0.5 && (e.view || e.display || 'isolate' in e || e.sortie || e.slow)).map((e) => +e.t.toFixed(3));
// the drive's spans: the bench demos in the teardown, the reels under power in the sortie
const motor = [];
for (const e of SCRIPT) if (e.isolate === 'drive' || e.isolate === 'reels') motor.push([e.t + 0.3, (SCRIPT.find((x) => x.t > e.t && 'isolate' in x)?.t ?? e.t + 2.5) - 0.1, 9000]);
let open = null;
for (let t = TEAR; t < DURATION - TAIL; t += 0.05) {
  const S = PH.sample(timeAt(t).tau);
  const on = S.drive.rpm > 1500;
  if (on && !open) open = [t, 0, 0];
  if (open) open[2] = Math.max(open[2], S.drive.rpm);
  if (!on && open) {
    open[1] = t;
    if (open[1] - open[0] > 0.15) motor.push(open.map((v) => +v.toFixed(3)));
    open = null;
  }
}
const speed = [];
for (let t = 0; t < DURATION; t += 0.1) speed.push(+PH.sample(timeAt(t).tau).speed.toFixed(2));
const tl = {
  duration: +DURATION.toFixed(3),
  teardown: TEAR,
  slow: {a: +filmAt(SLOW.a).toFixed(3), b: +filmAt(SLOW.b).toFixed(3)},
  map: +(DURATION - TAIL).toFixed(3),
  clicks,
  fires: at('fire'),
  hits: at('hit'),
  releases: at('release'),
  jets: at('jet'),
  kick: at('kick')[0],
  cut: at('cut')[0],
  catch: at('catch')[0],
  land: at('land')[0],
  data: {motor, speed}, // for the score; not times
};
fs.writeFileSync(new URL('../odm-film/timeline.json', import.meta.url), JSON.stringify(tl));
console.log(JSON.stringify({...tl, data: {speed: `${speed.length} samples`, motor: motor.length}}));
