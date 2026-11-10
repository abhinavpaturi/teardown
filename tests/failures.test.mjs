// Every way a page or a recording can go wrong that once went unnoticed. A broken page must fail, a healthy one must pass, and a
// failed recording must say so and leave the earlier video alone. (Needs Chromium; in Claude Code, run with the Bash sandbox disabled.)
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {FFMPEG} from '../paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teardown-failures-'));
const env = {...process.env, TEARDOWN_OUT: path.join(tmp, 'out')};
const dist = path.join(tmp, 'out/dist');
fs.mkdirSync(dist, {recursive: true});
const run = (script, args, extra = {}, timeout = 60000) => spawnSync(process.execPath, [path.join(ROOT, script), ...args], {cwd: tmp, encoding: 'utf8', env: {...env, ...extra}, timeout, killSignal: 'SIGKILL'});
const smoke = (page, ...args) => run('scripts/smoke.mjs', [page, ...args], {}, 120000);
const capture = (args, extra, timeout) => run('sims/capture.mjs', args, extra, timeout);
const small = ['--size', '640x360', '--dpr', '1'];
const failed = (r, pattern) => {
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, pattern);
};

const GOOD = "ctx.fillStyle='#eef';ctx.fillRect(0,0,320,180);ctx.fillStyle='#d54';ctx.fillRect(40+100*t,60,60,60);";
const film = (name, {draw = GOOD, extra = '', dur = 2} = {}) => {
  const p = path.join(dist, `${name}.html`);
  fs.writeFileSync(p, `<!doctype html><html><body style="margin:0;background:#888"><canvas id=c style="position:fixed;inset:0;width:100vw;height:100vh" width=320 height=180></canvas><script>
const ctx=document.getElementById('c').getContext('2d');
window.SIM={ready:true,duration:${dur},fps:60,state:t=>({t}),render(t){${draw}}};${extra}</script></body></html>`);
  return p;
};
// a healthy live page: a real button, motion that respects the visitor's setting. Each test breaks one thing.
const live = (name, {buttons = '<button id=a>Speed up</button>', js = 'a.onclick=()=>{st.rpm=1200;st.clicks++}', moving = true, body = ''} = {}) => {
  const p = path.join(dist, `${name}.html`);
  fs.writeFileSync(p, `<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1,minimum-scale=1"></head><body style="margin:0;background:#eef">
<canvas id=c style="position:fixed;inset:0;width:100vw;height:100vh" width=320 height=180></canvas>
<div style="position:fixed;left:10px;top:10px;z-index:5">${buttons}</div>${body}
<script>
const ctx=document.getElementById('c').getContext('2d');
const st={rpm:400,clicks:0,ticks:0,running:${moving}&&!matchMedia('(prefers-reduced-motion: reduce)').matches};
window.SIM={qa:{state:()=>({...st})}};
function f(){if(st.running)st.ticks++;ctx.fillStyle='#eef';ctx.fillRect(0,0,320,180);ctx.fillStyle='#d54';ctx.fillRect(10+(st.ticks*2.37)%251,20+(st.ticks*0.91)%97,60,60);if(!st.dead)requestAnimationFrame(f);}
requestAnimationFrame(f);${js};window.SIM_SHOWN=true;</script></body></html>`);
  return p;
};
const plan = (steps) => {
  const p = path.join(tmp, `plan-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify({schemaVersion: 1, viewports: [{width: 1200, height: 800}], steps}));
  return p;
};
const CLICK = {name: 'speed', action: 'click', selector: '#a', withinMs: 200, expect: {rpm: {equals: 1200}}};

// ---- pages that must pass
test('a healthy film passes', {timeout: 120000}, () => assert.equal(smoke(film('ok-film')).status, 0));
test('a healthy live page passes, with its plan', {timeout: 120000}, () => {
  const r = smoke(live('ok-live'), '--qa', plan([CLICK]));
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /every control does something +state changed/);
});
test('a page that starts still on purpose passes, because a control sets it going', {timeout: 120000}, () => {
  const r = smoke(live('hand-cranked', {moving: false, js: 'a.onclick=()=>{st.rpm=1200;st.running=true}'}));
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /still until you act/);
});

// ---- films that must fail
test('a film whose frames depend on history', {timeout: 120000}, () => failed(smoke(film('history', {draw: "ctx.fillStyle=`hsl(${(window.n=(window.n||0)+1)*47},70%,50%)`;ctx.fillRect(0,0,320,180);"})), /FAIL render\(t\) is pure/));
test('a film with a stale arrow left from the last frame', {timeout: 120000}, () => failed(smoke(film('stale', {draw: `${GOOD}const p=window.prev??t;window.prev=t;ctx.fillStyle='#000';ctx.fillRect(10+100*p,20,30,8);`})), /FAIL render\(t\) is pure/));
test('a blank film', {timeout: 120000}, () => failed(smoke(film('blank', {draw: "ctx.fillStyle='#888';ctx.fillRect(0,0,320,180);"})), /FAIL frames have a picture/));
test('a film that\'s one flat tint', {timeout: 120000}, () => {
  const p = film('tint', {draw: "ctx.fillStyle='#eef';ctx.fillRect(0,0,320,180);"});
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('background:#888', 'background:#eef'));
  failed(smoke(p), /FAIL frames have a picture/);
});
test('a model that goes NaN, which JSON would turn into null', {timeout: 120000}, () => failed(smoke(film('nan', {extra: 'window.SIM.state=()=>({pressure:NaN});'})), /state\.pressure is not a finite number/));
test('numbers that change between visits to the same time', {timeout: 120000}, () => failed(smoke(film('drift', {extra: 'window.SIM.state=()=>({n:(window.c=(window.c||0)+1)});'})), /FAIL state\(t\) is pure/));
test('a film that asks the network for something', {timeout: 120000}, () => failed(smoke(film('net', {extra: 'fetch("https://teardown-test.invalid/x.json").catch(()=>{});'})), /FAIL works offline/));
test('a film that logs an error', {timeout: 120000}, () => failed(smoke(film('err', {extra: 'console.error("boom");'})), /FAIL no page errors/));
test('a film that throws late on', {timeout: 120000}, () => failed(smoke(film('late', {draw: `${GOOD}if(t>1.8)throw new Error('late boom');`})), /late boom/));
test('a claim from SIM_CHECK that stops being true', {timeout: 120000}, () => failed(smoke(film('claim', {extra: "window.SIM_CHECK=()=>[{name:'the rod reaches the piston',ok:false,detail:'9 mm off',value:9}];"})), /FAIL the rod reaches the piston/));

// ---- live pages that must fail
test('a button wired to nothing, with no plan', {timeout: 120000}, () => failed(smoke(live('dead', {js: ''})), /FAIL every control is wired +no listener on: Speed up/));
test('a button that runs but changes nothing, with no plan', {timeout: 120000}, () => failed(smoke(live('silent', {js: 'a.onclick=()=>{}'})), /FAIL every control does something +state unchanged by: Speed up/));
test('a plan catches the wrong outcome', {timeout: 120000}, () => failed(smoke(live('wrong', {js: 'a.onclick=()=>{st.rpm=800}'}), '--qa', plan([CLICK])), /rpm: expected 1200, got 800/));
test('a button that throws', {timeout: 120000}, () => failed(smoke(live('throws', {buttons: '<button id=a>Speed</button><button id=b>Explode</button>', js: "a.onclick=()=>{st.rpm=1200};b.onclick=()=>{throw new Error('click boom')}"})), /click boom/));
test('a button hidden behind a panel', {timeout: 120000}, () => failed(smoke(live('covered', {buttons: '<button id=a>Speed</button><button id=b onclick="st.clicks++" style="position:fixed;left:300px;top:300px">Explode</button>', body: '<div style="position:fixed;left:280px;top:280px;width:200px;height:100px;background:#fff;z-index:9"></div>'})), /could not click: Explode/));
test('a page with nothing to press', {timeout: 120000}, () => failed(smoke(live('nobuttons', {buttons: '', js: ''})), /FAIL controls found/));
test('a slider wired to nothing, with no plan', {timeout: 120000}, () => failed(smoke(live('deadslider', {buttons: '<button id=a>Speed</button><input id=b type=range aria-label=Throttle>'})), /FAIL every control is wired +no listener on: Throttle/));
test('a slider that runs but changes nothing', {timeout: 120000}, () => failed(smoke(live('silentslider', {buttons: '<button id=a>Speed</button><input id=b type=range aria-label=Throttle>', js: 'a.onclick=()=>{st.rpm=1200;st.clicks++};b.oninput=()=>{}'})), /state unchanged by: Throttle/));
test('the hand-over from a tour doesn\'t pass for a button\'s effect', {timeout: 120000}, () => {
  // a working page with a tour, and one dead button: the press takes over, and nothing else happens
  const js = "st.tour=true;addEventListener('pointerdown',()=>{st.tour=false});a.onclick=()=>{};b.onclick=()=>{st.rpm+=100}";
  failed(smoke(live('tourmask', {buttons: '<button id=a>Glass</button><button id=b>Speed</button>', js})), /state unchanged by: Glass/);
});
test('a working button isn\'t called dead because it was already current', {timeout: 120000}, () => {
  const js = "a.onclick=()=>{st.view='hero'};b.onclick=()=>{st.view='front'}";
  const r = smoke(live('current', {buttons: '<button id=a>Hero</button><button id=b>Front</button>', js: `st.view='hero';${js}`}));
  assert.equal(r.status, 0, r.stdout);
});
test('a click delegated from the document is wired', {timeout: 120000}, () => {
  const r = smoke(live('delegated', {js: "document.addEventListener('click',(e)=>{if(e.target.id==='a'){st.rpm=1200;st.clicks++}})"}));
  assert.equal(r.status, 0, r.stdout);
});
test('an effect that lands a moment later still counts', {timeout: 120000}, () => {
  const r = smoke(live('slowfx', {js: 'a.onclick=()=>{setTimeout(()=>{st.clicks++},300)}'}));
  assert.equal(r.status, 0, r.stdout);
});
test('an undrawn scene under working panels', {timeout: 120000}, () => {
  const p = live('undrawn', {body: '<div style="position:fixed;right:10px;top:10px;width:200px;height:200px;background:#222;color:#fff;z-index:4">readouts</div>'});
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/ctx\.fillStyle='#d54';ctx\.fillRect\([^;]*;/, ''));
  failed(smoke(p), /FAIL the scene draws/);
});
test('Tab has to reach every control, not just one', {timeout: 120000}, () => failed(smoke(live('tabskip', {buttons: '<button id=a>Speed</button><button id=b tabindex=-1 onclick="st.clicks++">Explode</button>'})), /FAIL the keyboard reaches every control +Tab never lands on: Explode/));
test('a control that\'s gone on a phone', {timeout: 120000}, () => failed(smoke(live('phonehidden', {buttons: '<button id=a>Speed</button><button id=b onclick="st.clicks++">Explode</button><style>@media (max-width:900px){#b{display:none}}</style>'})), /FAIL phone upright: reaches every control/));
test('a control off the edge of a phone', {timeout: 120000}, () => failed(smoke(live('phoneoff', {buttons: '<button id=a>Speed</button><button id=b onclick="st.clicks++" style="position:fixed;left:1000px;top:40px">Explode</button>'})), /FAIL phone (upright|sideways): (reaches every control|fits)/));
test('a plan on a phone uses a real finger, so a canvas that gives up the gesture fails', {timeout: 120000}, () => {
  // a mouse drag fires pointermove regardless. A finger on touch-action:auto gets a pan instead, and the page never hears about it.
  const js = "c.style.touchAction='auto';c.addEventListener('pointermove',(e)=>{if(e.buttons)st.az=(st.az||0)+1});st.az=0;a.onclick=()=>{st.rpm=1200}";
  const p = path.join(tmp, 'finger.json');
  fs.writeFileSync(p, JSON.stringify({schemaVersion: 1, viewports: [{width: 390, height: 844}], steps: [{name: 'orbit', action: 'drag', selector: '#c', delta: [70, 0], withinMs: 300, expect: {az: {min: 6}}}]}));
  failed(smoke(live('finger', {js}), '--qa', p), /FAIL +390x844: orbit/);
});
test('a timeline that has moved on from the built page is refused', {timeout: 120000}, () => {
  const f = path.join(tmp, 'longer.json');
  fs.writeFileSync(f, JSON.stringify({duration: 30, late: 25}));
  failed(smoke(film('moved'), '--timeline', f), /FAIL the timeline matches the page/);
  const r = capture([film('moved'), ...small, '--stills', 'beats', '--timeline', f, '--out', path.join(tmp, 'moved.png')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /rebuild the page/);
});
test('an error while loading fails in seconds, by name', {timeout: 60000}, () => {
  const p = path.join(dist, 'loaderr.html');
  fs.writeFileSync(p, "<!doctype html><script>throw new Error('timeline.json: explode = undefined')</script>");
  const t0 = Date.now();
  const r = smoke(p);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /explode = undefined/);
  assert.ok(Date.now() - t0 < 30000, `took ${Date.now() - t0} ms`);
  const c = capture([p, ...small, '--still', '0', '--out', path.join(tmp, 'le.png')]);
  assert.equal(c.status, 1);
  assert.match(c.stderr, /explode = undefined/);
});
test('a page that never changes, whatever you do', {timeout: 120000}, () => failed(smoke(live('frozen', {moving: false})), /FAIL the page moves or reacts/));
test('a click that stops the frame loop', {timeout: 120000}, () => failed(smoke(live('freeze', {js: 'a.onclick=()=>{st.rpm=1200;st.dead=true;st.running=false}'})), /FAIL a click stops nothing +the frame loop stopped after: Speed up/));
test('a page that ignores reduced motion', {timeout: 120000}, () => {
  const p = live('restless');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace("&&!matchMedia('(prefers-reduced-motion: reduce)').matches", ''));
  failed(smoke(p), /FAIL reduced motion holds it still/);
});
test('controls the keyboard can\'t reach', {timeout: 120000}, () => failed(smoke(live('nokeys', {buttons: '<div id=a style="cursor:pointer;padding:8px;background:#fff">Speed up</div>'})), /FAIL the keyboard reaches every control/));
test('a page that scrolls sideways on a phone', {timeout: 120000}, () => failed(smoke(live('wide', {body: '<div style="width:900px;height:10px"></div>'})), /FAIL phone upright: fits the screen/));
test('a page that grows off the screen on a phone', {timeout: 120000}, () => {
  const p = live('grows', {body: '<div style="position:absolute;left:0;top:1200px;width:1600px;height:900px;background:#d54"></div>'});
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(',minimum-scale=1', ''));
  failed(smoke(p), /FAIL phone upright/);
});

// ---- plans that must be refused
test('an empty plan can\'t pass', {timeout: 120000}, () => failed(smoke(live('p1'), '--qa', (() => {
  const p = path.join(tmp, 'empty.json');
  fs.writeFileSync(p, JSON.stringify({schemaVersion: 1, steps: []}));
  return p;
})()), /at least one step/));
test('a step with no expected outcome can\'t pass', {timeout: 120000}, () => failed(smoke(live('p2'), '--qa', plan([{action: 'click', selector: '#a'}])), /nonempty expect/));
test('a misspelled rule can\'t pass', {timeout: 120000}, () => failed(smoke(live('p3'), '--qa', plan([{action: 'click', selector: '#a', expect: {rpm: {equal: 1200}}}])), /Invalid rule for rpm/));

// ---- recordings
const noFF = spawnSync(FFMPEG, ['-version'], {stdio: 'ignore'}).error ? 'needs ffmpeg' : false;
const brokenEncoder = path.join(tmp, 'broken-ffmpeg.sh');
fs.writeFileSync(brokenEncoder, '#!/bin/sh\nfor a; do last=$a; done\necho partial > "$last"\nexit 1\n');
fs.chmodSync(brokenEncoder, 0o755);
test('a page path works, whichever contract it uses', {timeout: 120000}, () => {
  const out = path.join(tmp, 'still.png');
  const r = capture([film('bypath'), ...small, '--still', '0', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.statSync(out).size > 100);
  assert.equal(JSON.parse(fs.readFileSync(`${out}.capture.json`, 'utf8')).contract, 'SIM');
  const seek = path.join(dist, 'seek.html');
  fs.writeFileSync(seek, '<canvas width=200 height=120></canvas><script>window.DURATION=1;window.seek=t=>{let c=document.querySelector("canvas").getContext("2d");c.fillStyle="orange";c.fillRect(0,0,200,120);};</script>');
  assert.equal(capture([seek, ...small, '--still', '0', '--out', path.join(tmp, 'seek.png')]).status, 0);
});
test('a dying encoder fails the run and the earlier video survives', {timeout: 120000, skip: noFF}, () => {
  const out = path.join(tmp, 'keep.mp4');
  fs.writeFileSync(out, 'the earlier video');
  const r = capture([film('enc'), ...small, '--fps', '10', '--out', out], {FFMPEG: brokenEncoder});
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), 'the earlier video');
  assert.equal(JSON.parse(fs.readFileSync(`${out}.capture.json`, 'utf8')).status, 'fail');
});
test('an encoder that isn\'t there, or exits at once, can\'t hang the run', {timeout: 120000}, () => {
  const r = capture([film('enc2'), ...small, '--fps', '10', '--out', path.join(tmp, 'x.mp4')], {FFMPEG: '/usr/bin/false'}, 30000);
  assert.notEqual(r.signal, 'SIGKILL', 'still running after 30 s');
  assert.equal(r.status, 1, r.stdout + r.stderr);
});
test('a page error fails the recording, and no video appears', {timeout: 120000, skip: noFF}, () => {
  const out = path.join(tmp, 'witherror.mp4');
  const r = capture([film('recerr', {extra: 'console.error("boom");'}), ...small, '--fps', '10', '--out', out]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /boom/);
  assert.ok(!fs.existsSync(out));
});
test('a size H.264 can\'t encode is refused before it starts', {timeout: 120000}, () => {
  for (const args of [['--size', '641x361', '--dpr', '1'], ['--size', '1600x900', '--dpr', '1.3333']]) {
    const out = path.join(tmp, 'odd.mp4');
    const r = capture([film('odd'), ...args, '--out', out]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /whole, even/);
    assert.ok(!fs.existsSync(out));
  }
});
test('a small, flat film still encodes', {timeout: 120000, skip: noFF}, () => {
  const out = path.join(tmp, 'tiny.mp4');
  const r = capture([film('tiny'), '--size', '320x180', '--dpr', '1', '--fps', '10', '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.statSync(out).size > 500);
});
test('a zero interval is refused at once', {timeout: 30000}, () => {
  const r = capture([film('zero'), ...small, '--stills', 'every:0', '--out', path.join(tmp, 'z.png')], {}, 15000);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /interval must be a positive number/);
});
test('a typo in a timeline is refused, not filed at the last frame', {timeout: 120000}, () => {
  const f = path.join(tmp, 'typo.json');
  fs.writeFileSync(f, JSON.stringify({duration: 2, hero: 0.5, typo: 99}));
  const r = capture([film('typo'), ...small, '--stills', 'beats', '--timeline', f, '--out', path.join(tmp, 't.png')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /typo = 99 is outside/);
});
test('a shorter sheet doesn\'t inherit tiles from a longer one', {timeout: 120000, skip: noFF}, () => {
  const out = path.join(tmp, 'sheet.png');
  capture([film('tiles', {dur: 8}), ...small, '--stills', '1,2,3,4,5,6', '--out', out]);
  capture([film('tiles', {dur: 8}), ...small, '--stills', '1,2', '--out', out]);
  assert.equal(fs.readdirSync(path.join(tmp, 'sheet-frames')).filter((f) => f.endsWith('.png')).length, 2);
});
test('a timeline with only a duration still gets a useful sheet', {timeout: 120000, skip: noFF}, () => {
  const f = path.join(tmp, 'dur.json');
  fs.writeFileSync(f, JSON.stringify({duration: 8}));
  const out = path.join(tmp, 'dur.png');
  const r = capture([film('dur', {dur: 8}), ...small, '--stills', 'beats', '--timeline', f, '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /one tile every 2 s/);
  assert.equal(fs.readdirSync(path.join(tmp, 'dur-frames')).filter((x) => x.endsWith('.png')).length, 4);
});
test('audio too short for the film is refused', {timeout: 120000, skip: noFF}, () => {
  const wav = path.join(tmp, 'short.wav');
  spawnSync(FFMPEG, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.5', wav]);
  const r = capture([film('shortaudio'), ...small, '--fps', '10', '--score', wav, '--out', path.join(tmp, 's.mp4')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /audio is too short/);
});
test('a score on the film\'s timeline is muxed untouched', {timeout: 120000, skip: noFF}, () => {
  const wav = path.join(tmp, 'full.wav');
  spawnSync(FFMPEG, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:r=48000', '-t', '3', wav]);
  const out = path.join(tmp, 'scored.mp4');
  const r = capture([film('scored'), ...small, '--fps', '10', '--score', wav, '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(`${out}.capture.json`, 'utf8')).audio.mode, 'score');
});

test.after(() => fs.rmSync(tmp, {recursive: true, force: true}));
