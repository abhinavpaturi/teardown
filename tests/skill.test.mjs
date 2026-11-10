// The skill's own checks, no browser needed.   npm test
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {FFMPEG, PYTHON} from '../paths.mjs';
import {simulate} from '../sims/kit/recorder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `teardown-${n}-`));
// a nested `node --test` inherits this and always exits 0, so a test run from inside a test could never fail without removing it
const {NODE_TEST_CONTEXT, ...cleanEnv} = process.env;

test('recorded samples sit on the time they claim (no drift)', () => {
  let y = 0;
  let v = 0;
  const sim = simulate({channels: ['y'], maxSeconds: 20, step: (t, dt) => {
    v -= 9.81 * dt;
    y += v * dt;
    return t > 15;
  }, record: (p) => (p.y = y)});
  assert.equal(sim.n, Math.round(sim.dur * sim.rate) + 1);
  // at 13.7 s a 250-for-240 Hz mismatch would read 0.55 s early, about 70 m off; semi-implicit Euler is off by centimetres
  assert.ok(Math.abs(sim.value('y', 13.7) - -0.5 * 9.81 * 13.7 * 13.7) < 0.1);
  assert.equal(sim.read(13.7).y, sim.value('y', 13.7));
});

test('no path from one person\'s machine in the code', () => {
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      if (['node_modules', 'teardown-out', '.git', 'docs', 'samples'].includes(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(py|mjs|js|json)$/.test(e.name) && !/test\.mjs$/.test(e.name) && /[A-Z]:[\\/]Users|\/Users\/[a-z]|\/home\/[a-z]/.test(fs.readFileSync(f, 'utf8'))) bad.push(f);
    }
  };
  walk(ROOT);
  assert.deepEqual(bad, []);
});

test('every example builds', () => {
  const out = tmp('build');
  const log = execFileSync('node', [path.join(ROOT, 'sims/build.mjs')], {cwd: out, encoding: 'utf8', env: {...process.env, TEARDOWN_OUT: out}});
  for (const n of ['v8-live', 'cessna-live', 'strandbeest-live', 'odm-live', 'odm-film']) assert.ok(log.includes(`${n}.html`), n);
  assert.ok(fs.readFileSync(path.join(out, 'dist/odm-live.html'), 'utf8').includes('<title>ODM-E1 Gear Simulator</title>'));
});

test('ODM-E1\'s sortie passes every limit', () => {
  const r = spawnSync('node', [path.join(ROOT, 'sims/odm-dev/test.mjs')], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout);
});

test('a new machine is a working project, and is not overwritten', () => {
  const dir = path.join(tmp('new'), 'proj');
  const run = () => spawnSync('node', [path.join(ROOT, 'scripts/new-machine.mjs'), dir, '--name', 'demo-crank', '--title', 'Demo Crank'], {encoding: 'utf8'});
  assert.equal(run().status, 0);
  execFileSync('node', ['--test', path.join(dir, 'demo-crank-shared/model.test.mjs')], {stdio: 'pipe', env: cleanEnv});
  const out = path.join(dir, 'teardown-out');
  execFileSync('node', [path.join(ROOT, 'sims/build.mjs'), './demo-crank-live', './demo-crank-film'], {cwd: dir, stdio: 'pipe', env: {...process.env, TEARDOWN_OUT: out}});
  assert.ok(fs.readFileSync(path.join(out, 'dist/demo-crank-live.html'), 'utf8').includes('<title>Demo Crank</title>'));
  assert.equal(run().status, 1);
});

const has = (cmd, flag) => {
  const r = spawnSync(cmd, [flag], {stdio: 'ignore'});
  return !r.error && r.status === 0;
};
const noAudio = has(PYTHON, '--version') && has(FFMPEG, '-version') ? false : 'needs Python and ffmpeg';

test('sample() reads a recorded sound', {skip: noAudio}, () => {
  const code = `import sys; sys.path.insert(0, sys.argv[1]); from sfx import synth; print(len(synth.sample('fs-323432-typing.ogg', 0, 0.2)))`;
  const n = Number(execFileSync(PYTHON, ['-I', '-c', code, ROOT], {encoding: 'utf8'}));
  assert.ok(Math.abs(n - 9600) < 200, String(n));
});

test('a new machine has a score that renders on its timeline', {skip: noAudio}, () => {
  const dir = path.join(tmp('score'), 'proj');
  execFileSync('node', [path.join(ROOT, 'scripts/new-machine.mjs'), dir, '--name', 'demo-crank'], {stdio: 'pipe'});
  const log = execFileSync(PYTHON, [path.join(ROOT, 'run_sfx.py'), path.join(dir, 'demo-crank-shared/score.py')], {cwd: dir, encoding: 'utf8', env: {...process.env, TEARDOWN_OUT: path.join(dir, 'out')}});
  assert.ok(fs.statSync(path.join(dir, 'out/demo-crank-score.wav')).size > 1e6);
  assert.ok(log.includes('16'), log);
});

test('a page can be packaged for an Artifact', () => {
  const out = tmp('art');
  execFileSync('node', [path.join(ROOT, 'sims/build.mjs'), 'v8-live'], {cwd: out, stdio: 'pipe', env: {...process.env, TEARDOWN_OUT: out}});
  const dest = path.join(out, 'a.html');
  execFileSync('node', [path.join(ROOT, 'scripts/package-artifact.mjs'), path.join(out, 'dist/v8-live.html'), '--title', 'A & B', '--out', dest], {stdio: 'pipe'});
  const s = fs.readFileSync(dest, 'utf8');
  assert.ok(s.startsWith('<title>A &amp; B</title>'));
  assert.ok(!/<!doctype|<html|<body/i.test(s.slice(0, 300)));
  assert.ok(s.includes('<script type="module">') && s.trimEnd().endsWith('</script>'));
});

// ---- the reader every tool shares
const tl = await import('../timeline.mjs');
test('the timeline reader takes both shapes and rejects what it can\'t place', () => {
  assert.deepEqual(tl.timelineTimes({duration: 10, a: 2, b: {c: 3}, clicks: [1], data: {motor: [[3, 6, 9000]]}, fps: 60}), [0, 1, 2, 3]);
  assert.deepEqual(tl.timelineTimes({schemaVersion: 1, duration: 10, events: [{id: 'a', t: 2, rpm: 1200}, {id: 'b', t: 4}]}), [0, 2, 4]);
  assert.throws(() => tl.timelineTimes({duration: 2, typo: 99}), /typo = 99 is outside/);
  assert.throws(() => tl.timelineTimes({schemaVersion: 1, duration: 9, events: [{id: 'a', t: 2}, {id: 'a', t: 3}]}), /unique/);
  assert.throws(() => tl.timelineTimes({schemaVersion: 1, duration: 9, events: [{id: 'a', t: 3}, {id: 'b', t: 2}]}), /out of order/);
  assert.throws(() => tl.timelineTimes({schemaVersion: 2, duration: 9, events: []}), /schemaVersion 1/);
  assert.throws(() => tl.timelineTimes({a: 1}), /duration/);
  assert.equal(tl.reviewTimes({duration: 8}).fallback, true);
  assert.equal(tl.reviewTimes({duration: 8}).times.length, 4);
  assert.equal(tl.reviewTimes({duration: 8, a: 3}).fallback, false);
});
test('every timeline in the skill passes the reader', () => {
  for (const d of fs.readdirSync(path.join(ROOT, 'sims'))) {
    const f = path.join(ROOT, 'sims', d, 'timeline.json');
    if (fs.existsSync(f)) tl.timelineTimes(JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  tl.timelineTimes(JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/starter/__NAME__-film/timeline.json'), 'utf8')));
});

test('a title can hold an apostrophe and a quote', () => {
  const dir = path.join(tmp('title'), 'proj');
  const title = `Watt's "Linkage" <1>`;
  execFileSync('node', [path.join(ROOT, 'scripts/new-machine.mjs'), dir, '--name', 'watt', '--title', title], {stdio: 'pipe'});
  const out = path.join(dir, 'teardown-out');
  execFileSync('node', [path.join(ROOT, 'sims/build.mjs'), './watt-live', './watt-film'], {cwd: dir, stdio: 'pipe', env: {...process.env, TEARDOWN_OUT: out}});
  const page = fs.readFileSync(path.join(out, 'dist/watt-live.html'), 'utf8');
  assert.ok(page.includes('<title>Watt&#39;s &quot;Linkage&quot; &lt;1&gt;</title>'), page.slice(0, 300));
});
test('your folder wins over an example of the same name', () => {
  const dir = path.join(tmp('clash'), 'proj');
  execFileSync('node', [path.join(ROOT, 'scripts/new-machine.mjs'), dir, '--name', 'v8', '--title', 'My V8'], {stdio: 'pipe'});
  const out = path.join(dir, 'teardown-out');
  execFileSync('node', [path.join(ROOT, 'sims/build.mjs'), './v8-live'], {cwd: dir, stdio: 'pipe', env: {...process.env, TEARDOWN_OUT: out}});
  assert.ok(fs.readFileSync(path.join(out, 'dist/v8-live.html'), 'utf8').includes('<title>My V8</title>'));
});
test('a build reports its size, hash and what takes the room', () => {
  const out = tmp('report');
  execFileSync('node', [path.join(ROOT, 'sims/build.mjs'), 'cessna-film'], {cwd: out, stdio: 'pipe', env: {...process.env, TEARDOWN_OUT: out}});
  const r = JSON.parse(fs.readFileSync(path.join(out, 'dist/cessna-film.build.json'), 'utf8'));
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.singleFile, true);
  assert.ok(r.bytes > 1e5 && r.largestInputs.length > 3);
});
test('the starter\'s sources are tied to its model', () => {
  const dir = path.join(tmp('src'), 'proj');
  execFileSync('node', [path.join(ROOT, 'scripts/new-machine.mjs'), dir, '--name', 'demo'], {stdio: 'pipe'});
  const f = path.join(dir, 'demo-shared/model.js');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('r: 0.045,', 'r: 0.06,'));
  assert.notEqual(spawnSync('node', ['--test', path.join(dir, 'demo-shared/model.test.mjs')], {stdio: 'pipe', env: cleanEnv}).status, 0);
});

test('every script answers --help', () => {
  for (const f of ['sims/build.mjs', 'sims/capture.mjs', 'sheet.mjs', 'wave.mjs', 'scripts/doctor.mjs', 'scripts/new-machine.mjs', 'scripts/smoke.mjs', 'scripts/package-artifact.mjs']) {
    const r = spawnSync('node', [path.join(ROOT, f), '--help'], {encoding: 'utf8'});
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    assert.match(r.stdout, /Usage/, f);
  }
});
test('the score refuses a time outside the film, and reads data as data', {skip: noAudio}, () => {
  const dir = path.join(tmp('badscore'), 'proj');
  execFileSync('node', [path.join(ROOT, 'scripts/new-machine.mjs'), dir, '--name', 'demo'], {stdio: 'pipe'});
  const f = path.join(dir, 'demo-film/timeline.json');
  const good = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, good.replace('"explode": 8.5', '"explode": 85'));
  const env = {...process.env, TEARDOWN_OUT: path.join(dir, 'out')};
  const r = spawnSync(PYTHON, [path.join(ROOT, 'run_sfx.py'), path.join(dir, 'demo-shared/score.py')], {cwd: dir, encoding: 'utf8', env});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /explode = 85 is outside the film/);
  fs.writeFileSync(f, good.replace('"explode": 8.5', '"explode": 8.5, "data": {"motor": [[3, 6, 9000]]}'));
  assert.equal(spawnSync(PYTHON, [path.join(ROOT, 'run_sfx.py'), path.join(dir, 'demo-shared/score.py')], {cwd: dir, encoding: 'utf8', env}).status, 0);
});
test('the starter says how fast the crank is really shown', () => {
  const src = fs.readFileSync(path.join(ROOT, 'assets/starter/__NAME__-shared/console.js'), 'utf8');
  const speedText = new Function(`${src.slice(src.indexOf('const speedText'), src.indexOf('export function createConsole'))}; return speedText;`)();
  assert.equal(speedText(1), 'SHOWN AT FULL SPEED');
  assert.equal(speedText(0.1), 'SHOWN AT 1/10 SPEED');
  assert.equal(speedText(0.25), 'SHOWN AT 1/4 SPEED');
  assert.equal(speedText(0.7), 'SHOWN AT 0.7× SPEED');
  assert.equal(speedText(2), 'SHOWN AT 2× SPEED');
});
