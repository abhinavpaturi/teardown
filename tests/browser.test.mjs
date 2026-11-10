// The skill's checks in a real browser (needs Chromium; in Claude Code, run with the Bash sandbox disabled).   npm run test:browser
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CHROMIUM_ARGS, FFMPEG} from '../paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'teardown-browser-'));
const dir = path.join(out, 'proj');
const env = {...process.env, TEARDOWN_OUT: out};
execFileSync('node', [path.join(ROOT, 'scripts/new-machine.mjs'), dir, '--name', 'demo-crank'], {stdio: 'pipe'});
execFileSync('node', [path.join(ROOT, 'sims/build.mjs'), './demo-crank-live', './demo-crank-film', path.join(ROOT, 'sims/odm-live'), path.join(ROOT, 'sims/odm-film'), path.join(ROOT, 'sims/v8-film'), path.join(ROOT, 'sims/v8-live'), path.join(ROOT, 'sims/cessna-live'), path.join(ROOT, 'sims/strandbeest-live')], {cwd: dir, stdio: 'pipe', env});
// an Artifact host wraps the packaged page in its own document; run it the same way
const art = path.join(out, 'artifact.html');
execFileSync('node', [path.join(ROOT, 'scripts/package-artifact.mjs'), path.join(out, 'dist/demo-crank-live.html'), '--title', 'Demo', '--out', art], {stdio: 'pipe'});
fs.writeFileSync(path.join(out, 'dist/wrapped-artifact.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body>${fs.readFileSync(art, 'utf8')}</body></html>`);
const smoke = (page, ...args) => spawnSync('node', [path.join(ROOT, 'scripts/smoke.mjs'), path.join(out, 'dist', `${page}.html`), ...args], {cwd: dir, encoding: 'utf8', env});
for (const page of ['wrapped-artifact', 'demo-crank-film', 'odm-live', 'odm-film', 'v8-film', 'v8-live', 'cessna-live', 'strandbeest-live'])
  test(`${page} works`, {timeout: 300000}, () => {
    const r = smoke(page);
    console.log(r.stdout);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
test('the starter passes its own plan, on a desktop and a phone', {timeout: 300000}, () => {
  const r = smoke('demo-crank-live', '--qa', 'demo-crank-shared/qa.json');
  console.log(r.stdout);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /390x844: back to the tour/);
  assert.match(r.stdout, /phone upright: tap targets +all \d+ are 32 px or more/);
});
test('the examples expose their controls: none reports zero buttons', {timeout: 300000}, () => {
  for (const page of ['v8-live', 'strandbeest-live']) assert.match(smoke(page).stdout, /every control responds +[1-9]\d* pressed/, page);
});
// Mistakes an agent really makes, in the starter's own files. Each must fail its named check; the last few are working pages that must not.
const variant = (name, file, from, to, {page = 'film', fails, passes = false} = {}) => test(`starter: ${name}`, {timeout: 300000}, () => {
  const d = path.join(out, `var-${name.replace(/\W+/g, '-')}`);
  fs.rmSync(d, {recursive: true, force: true});
  execFileSync('node', [path.join(ROOT, 'scripts/new-machine.mjs'), d, '--name', 'm'], {stdio: 'pipe'});
  const f = path.join(d, `m-shared/${file}`);
  const src = fs.readFileSync(f, 'utf8');
  assert.ok(src.includes(from), from);
  fs.writeFileSync(f, src.replace(from, to));
  const e = {...process.env, TEARDOWN_OUT: path.join(d, 'out')};
  execFileSync('node', [path.join(ROOT, 'sims/build.mjs'), './m-film', './m-live'], {cwd: d, stdio: 'pipe', env: e});
  const args = page === 'live' ? ['--qa', 'm-shared/qa.json'] : ['--timeline', 'm-film/timeline.json'];
  const r = spawnSync('node', [path.join(ROOT, 'scripts/smoke.mjs'), path.join(d, `out/dist/m-${page}.html`), ...args], {cwd: d, encoding: 'utf8', env: e});
  if (passes) assert.equal(r.status, 0, r.stdout);
  else {
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, fails);
  }
});
variant('the crank spins backward', 'machine.js', 'crank.rotation.z = -m.th;', 'crank.rotation.z = m.th;', {fails: /FAIL the rod sits on the crank pin/});
variant('the rod leans the wrong way', 'machine.js', 'rodG.rotation.z = m.rod;', 'rodG.rotation.z = -m.rod;', {fails: /FAIL the rod reaches the piston/});
variant('the rod is on the wrong side', 'machine.js', 'rodG.position.set(m.pinX,', 'rodG.position.set(-m.pinX,', {fails: /FAIL the rod/});
variant('the piston floats', 'machine.js', 'piston.position.set(0, m.y +', 'piston.position.set(0, m.y + 0.02 +', {fails: /FAIL the rod reaches the piston/});
variant('the scene is never drawn', 'film.js', 'sc.st.frame({...s.cam,', 'sc.st.place({...s.cam,', {fails: /FAIL the scene draws/});
variant('the readout lies', 'console.js', 'rpm.textContent = Math.round(u.rpm);', 'rpm.textContent = Math.round(u.rpm * 2);', {fails: /FAIL the readout shows the model/});
variant('explode changes the mechanism', 'film.js', 'sc.machine.update(pose(s.th), s.D);', 'sc.machine.update(pose(s.th + 2 * (s.D.explode ?? 0)), s.D);', {fails: /FAIL the crank is at the model/});
variant('a misspelled cue stops the film', '../m-film/timeline.json', '"explode"', '"explod"', {fails: /explode = undefined/});
variant('an impossible cue stops the film', '../m-film/timeline.json', '"explode": 8.5', '"explode": 85', {fails: /explode = 85/});
variant('the machine is off screen on a phone', 'console.js', '{sx: 0, sy: -84, k: 1.55', '{sx: 0, sy: 4000, k: 1.55', {page: 'live', fails: /FAIL the machine is in frame/});
variant('the throttle is gone on a phone', 'console.js', '#app.compact .sub{display:none}', '#app.compact .sub{display:none}#app.compact .throttle{display:none}', {page: 'live', fails: /FAIL phone upright: reaches every control/});
variant('the buttons are off the screen on a phone', 'console.js', '#app.compact .btns{left:12px;right:12px;bottom:12px;', '#app.compact .btns{left:12px;right:12px;bottom:9000px;', {page: 'live', fails: /FAIL phone upright: reaches every control/});
variant('the keyboard only reaches the first thing', 'console.js', '<button type="button" id="bt-${k}"', '<button type="button" tabindex="-1" id="bt-${k}"', {page: 'live', fails: /FAIL the keyboard reaches every control/});
variant('the first view button does nothing', 'live.js', '      view = v;\n', "      if (v !== 'hero') view = v;\n", {page: 'live', fails: /state unchanged by: HERO|back to the first view/});
variant('a toggle does nothing, while the tour hands over', 'live.js', '      disp[k] = {on: disp[k].on ? 0 : 1, t: shell.T};\n', "      if (k !== 'glass') disp[k] = {on: disp[k].on ? 0 : 1, t: shell.T};\n", {page: 'live', fails: /state unchanged by: GLASS/});
variant('the throttle does nothing', 'live.js', 'rpm = P.rpmIdle + (Number(e.target.value) / 1000) * (P.rpmMax - P.rpmIdle);', '', {page: 'live', fails: /state unchanged by: Engine speed|throttle keeps the crank/});
variant('a finger pans the page instead of orbiting', 'console.js', '.ui{position:absolute;', '#gl{touch-action:auto!important}.ui{position:absolute;', {page: 'live', fails: /390x844: (orbit|pinch)/});
variant('tiny buttons in the phone layout', 'console.js', '#app.compact .bt{position:static;width:auto!important;height:44px}', '#app.compact .bt{position:static;width:auto!important;height:8px}', {page: 'live', fails: /FAIL phone upright: tap targets/});
variant('a state with only the crank in it gets no false alarm', 'live.js', "window.SIM = {qa: {state: () => ({view, paused, rpm, th, tour: shell.tour, glass: disp.glass.on === 1, explode: eased.explode, az: shell.orbit.az, zoom: shell.orbit.k, compact: shell.compact})}};", 'window.SIM = {qa: {state: () => ({th})}};\n  void eased;', {page: 'film', passes: true});
variant('a button delegated from the document still works', 'live.js', "sc.ui.btn.play.addEventListener('click', () => {\n    shell.takeOver();\n    paused = !paused;\n  });", "document.addEventListener('click', (e) => {\n    if (e.target.id === 'bt-play') {\n      shell.takeOver();\n      paused = !paused;\n    }\n  });", {page: 'live', passes: true});
variant('a toggle that lands 300 ms later still works', 'live.js', '      disp[k] = {on: disp[k].on ? 0 : 1, t: shell.T};\n', '      setTimeout(() => {\n        disp[k] = {on: disp[k].on ? 0 : 1, t: shell.T};\n      }, 300);\n', {page: 'live', passes: true});

// things that take a live browser driving the page by hand
const drive = async (page, fn, {context = {}} = {}) => {
  const {chromium} = createRequire(path.join(ROOT, 'node_modules/x.js'))('playwright');
  const browser = await chromium.launch({args: CHROMIUM_ARGS});
  try {
    const p = await browser.newPage({viewport: {width: 1600, height: 900}, ...context});
    await p.goto(pathToFileURL(path.join(out, 'dist', `${page}.html`)).href);
    await p.waitForFunction(() => window.SIM_SHOWN, null, {timeout: 60000});
    return await fn(p);
  } finally {
    await browser.close();
  }
};
test('a paused page stays paused after the tour\'s idle time', {timeout: 120000}, async () => {
  const r = await drive('demo-crank-live', async (p) => {
    await p.click('#bt-play');
    assert.equal((await p.evaluate(() => SIM.qa.state())).paused, true);
    await p.waitForTimeout(26500);
    return p.evaluate(() => SIM.qa.state());
  });
  assert.equal(r.tour, false);
  assert.equal(r.paused, true);
});
test('a page left alone without pausing does go back to the tour', {timeout: 120000}, async () => {
  const r = await drive('demo-crank-live', async (p) => {
    await p.click('#bt-front');
    await p.waitForTimeout(26500);
    return p.evaluate(() => SIM.qa.state());
  });
  assert.equal(r.tour, true);
});
test('two fingers zoom', {timeout: 120000}, async () => {
  const r = await drive('demo-crank-live', async (p) => {
    await p.waitForTimeout(500);
    const cdp = await p.context().newCDPSession(p);
    const at = (d) => [{x: 195 - d, y: 300, id: 1}, {x: 195 + d, y: 300, id: 2}];
    const before = (await p.evaluate(() => SIM.qa.state())).zoom;
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: at(30)});
    for (let d = 40; d <= 120; d += 10) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: at(d)});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    return {before, after: (await p.evaluate(() => SIM.qa.state())).zoom};
  }, {context: {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}});
  assert.ok(r.after < r.before * 0.6, JSON.stringify(r));
});
test('the throttle follows the tour even after a hand has been on it', {timeout: 120000}, async () => {
  const r = await drive('demo-crank-live', async (p) => {
    await p.focus('#throttle');
    await p.waitForTimeout(500);
    await p.click('.tourchip'); // takes over
    await p.focus('#throttle');
    await p.click('.tourchip'); // back to the tour
    await p.focus('#throttle');
    const k = () => p.evaluate(() => Number(document.getElementById('throttle').value));
    const samples = [];
    for (let i = 0; i < 8; i++) {
      samples.push(await k());
      await p.waitForTimeout(500);
    }
    return samples;
  });
  assert.ok(Math.max(...r) - Math.min(...r) > 200, JSON.stringify(r));
});
test('long source notes scroll instead of running off the page', {timeout: 120000}, async () => {
  const r = await drive('demo-crank-live', async (p) => {
    await p.evaluate(() => {
      const d = document.querySelector('details.src');
      d.open = true;
      for (let i = 0; i < 40; i++) d.insertAdjacentHTML('beforeend', `<p>record ${i}: a long note about where this number came from, and how far to trust it</p>`);
    });
    return p.evaluate(() => {
      const d = document.querySelector('details.src');
      const b = d.getBoundingClientRect();
      return {bottom: b.bottom, h: innerHeight, scrolls: d.scrollHeight > d.clientHeight};
    });
  });
  assert.ok(r.bottom <= r.h, JSON.stringify(r));
  assert.ok(r.scrolls, JSON.stringify(r));
});
// the review loop as SKILL.md gives it, from a project folder outside the skill
const capture = (...args) => spawnSync('node', [path.join(ROOT, 'sims/capture.mjs'), ...args], {cwd: dir, encoding: 'utf8', env});
test('a review sheet of the beats, from a machine outside the skill', {timeout: 300000}, () => {
  const f = path.join(out, 'beats.png');
  const r = capture('demo-crank-film', '--size', '1600x900', '--dpr', '0.6', '--stills', 'beats', '--cols', '3', '--out', f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.statSync(f).size > 1e4);
});
test('a timeline with no beats still gets a useful sheet', {timeout: 300000}, () => {
  const f = path.join(out, 'v8.png');
  const r = capture('v8-film', '--size', '1600x900', '--dpr', '0.5', '--stills', 'beats', '--cols', '4', '--out', f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /one tile every 2 s/);
});
const ffmpeg = spawnSync(FFMPEG, ['-version'], {stdio: 'ignore'});
test('a sheet of the encoded video', {timeout: 300000, skip: ffmpeg.error ? 'needs ffmpeg' : false}, () => {
  const f = path.join(out, 'short.mp4');
  const r = capture('demo-crank-film', '--size', '800x450', '--dpr', '1', '--to', '3', '--out', f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = spawnSync('node', [path.join(ROOT, 'sheet.mjs'), '--video', f, '--timeline', path.join(dir, 'demo-crank-film/timeline.json')], {cwd: dir, encoding: 'utf8', env});
  assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.match(s.stdout, /[1-9]\d* sheet/);
});
