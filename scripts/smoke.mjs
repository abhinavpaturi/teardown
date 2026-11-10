#!/usr/bin/env node
// Does this page actually work? Opens a built page from disk, blocks the network, and checks it the way a visitor would. It needs no
// setup, and a plan makes it stricter: it can tell that a click did something, but only a plan can say the click did the right thing.
//
//   node scripts/smoke.mjs page.html [--qa plan.json] [--timeline timeline.json] [--mode film|live] [--out dir]
//
// A film (window.SIM.render): frames aren't blank; re-rendering them in shuffled order gives the same pixels and the same numbers,
// which is what "render(t) is pure" means; no number is NaN. Pass --timeline to sample every beat as well.
// A live page: the scene itself draws (panels over an empty canvas don't count), it moves or at least reacts, every control can be
// found and pressed and is wired to something, no click kills the frame loop, Tab reaches every control, reduced motion holds it
// still, and a phone can see the page and reach every control in both orientations. If the page exposes window.SIM.qa.state(), a
// control that changes nothing fails too. A page that starts still on purpose is fine, as long as something makes it move.
// Either kind can state what must stay true: window.SIM_CHECK = () => [{name, ok, detail, value}], read after every frame it renders.
// Every run leaves report.json and screenshots in --out. See references/quality.md.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {CHROMIUM, CHROMIUM_ARGS, OUT, playwright} from '../paths.mjs';
import {timelineTimes} from '../timeline.mjs';
import {args, hashFile, waitReady, writeJSON} from './common.mjs';

const {values: opt, positionals} = args({
  help: {type: 'boolean'}, qa: {type: 'string'}, timeline: {type: 'string'}, mode: {type: 'string'}, out: {type: 'string'},
});
const file = positionals[0];
if (opt.help || !file || !fs.existsSync(file) || (opt.mode && !['film', 'live'].includes(opt.mode))) {
  console.log('Usage: node scripts/smoke.mjs page.html [--qa plan.json] [--timeline timeline.json] [--mode film|live] [--out dir]');
  process.exit(opt.help ? 0 : 2);
}
const html = path.resolve(file);
const outDir = path.resolve(opt.out ?? path.join(OUT, 'smoke', path.basename(html, '.html')));
fs.mkdirSync(outDir, {recursive: true});
const rows = [];
/** status: true passes, false fails, 'note' reports without failing */
const add = (name, status, detail = '') => rows.push({name, status, detail});
const errors = [];
const network = [];
const browser = await playwright().chromium.launch({executablePath: CHROMIUM, args: CHROMIUM_ARGS});

const open = async (context, capture) => {
  const page = await browser.newPage(context);
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  await page.route(/^https?:\/\//, (r) => {
    network.push(r.request().url());
    return r.abort();
  });
  await page.addInitScript((cap) => {
    if (cap) window.__CAPTURE = true;
    // counts frames the page's own loop actually ran, so a dead loop can be told from a machine that's paused
    window.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => raf((t) => {
      window.__frames++;
      f(t);
    });
  }, capture);
  const base = errors.length;
  await page.goto(pathToFileURL(html).href);
  await waitReady(page, errors, () => window.SIM?.ready || window.SIM_SHOWN, base);
  await page.evaluate(() => document.fonts.ready);
  return page;
};
// compare two PNG screenshots in the page: how much changed, and whether the first has any picture in it at all
const compare = (page, a, b) => page.evaluate(async ([x, y]) => {
  const px = async (s) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))], {type: 'image/png'}));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, c.width, c.height).data;
  };
  const p = await px(x);
  const q = await px(y);
  let changed = 0;
  let sum = 0;
  // per channel: a flat tint has different red and blue, and it's still flat
  const lo = [255, 255, 255];
  const hi = [0, 0, 0];
  for (let i = 0; i < p.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const e = Math.abs(p[i + k] - q[i + k]);
      sum += e;
      d = Math.max(d, e);
      lo[k] = Math.min(lo[k], p[i + k]);
      hi[k] = Math.max(hi[k], p[i + k]);
    }
    if (d > 3) changed++;
  }
  return {changed: changed / (p.length / 4), mean: sum / ((p.length / 4) * 3), range: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])};
}, [a.toString('base64'), b.toString('base64')]);
const pct = (x) => `${(x * 100).toFixed(2)} %`;
// The scene alone, with every panel hidden: a console over an undrawn scene still looks like a page. null if there's no canvas.
const sceneRange = async (page) => {
  const box = await page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!c) return null;
    c.dataset.smokeMain = '1';
    const r = c.getBoundingClientRect();
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    return {x, y, width: Math.min(r.right, visualViewport.width) - x, height: Math.min(r.bottom, visualViewport.height) - y};
  });
  if (!box) return null;
  if (box.width < 2 || box.height < 2) return 0; // nothing of it on screen
  const tag = await page.addStyleTag({content: 'body *{visibility:hidden!important}[data-smoke-main]{visibility:visible!important}'});
  const shot = await page.screenshot({clip: box});
  await tag.evaluate((n) => n.remove());
  return (await compare(page, shot, shot)).range;
};
const nonFinite = (v, key = 'state') => {
  if (typeof v === 'number' && !Number.isFinite(v)) return key;
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    const bad = nonFinite(x, `${key}.${k}`);
    if (bad) return bad;
  }
  return null;
};
const claims = new Map();
const readClaims = async (page, t) => {
  for (const c of await page.evaluate(() => window.SIM_CHECK?.() ?? [])) {
    const seen = claims.get(c.name);
    if (!seen || (seen.ok && !c.ok) || (seen.ok === c.ok && (c.value ?? 0) > (seen.value ?? 0))) claims.set(c.name, {...c, t});
  }
};
const reportClaims = () => {
  for (const c of claims.values()) add(c.name.slice(0, 40), !!c.ok, `${c.detail ?? ''}${c.ok || c.t === undefined ? '' : ` (t=${c.t.toFixed(2)})`}`);
};

// ---- a film
async function checkFilm(page) {
  const dur = await page.evaluate(() => window.SIM.duration);
  const hasState = await page.evaluate(() => typeof window.SIM.state === 'function');
  let beats = [];
  if (opt.timeline) {
    const tl = JSON.parse(fs.readFileSync(opt.timeline, 'utf8'));
    // the page carries the timeline it was built with, so this file can have moved on without it
    if (Number.isFinite(tl.duration) && Math.abs(tl.duration - dur) > 0.01) add('the timeline matches the page', false, `${path.basename(opt.timeline)} says ${tl.duration} s and the page ${dur} s: rebuild`);
    else if (fs.statSync(opt.timeline).mtimeMs > fs.statSync(html).mtimeMs) add('the timeline matches the page', 'note', `${path.basename(opt.timeline)} is newer than the page: if the film reads it, rebuild`);
    beats = timelineTimes(tl, dur).map((t) => Math.min(t + 0.3, dur - 1 / 60));
    if (beats.length > 40) beats = beats.filter((_, i) => i % Math.ceil(beats.length / 40) === 0); // enough to catch a stale effect without an hour of screenshots
  }
  const ts = [...new Set([0, 0.13, 0.31, 0.47, 0.62, 0.78, 0.97].map((k) => k * dur).concat(beats))];
  const stateAt = async (t) => {
    if (!hasState) return null;
    const s = await page.evaluate((x) => window.SIM.state(x), t);
    const bad = nonFinite(s);
    if (bad) throw new Error(`${bad} is not a finite number at t=${t.toFixed(2)}`);
    return s;
  };
  const draw = async (t) => {
    await page.evaluate((x) => window.SIM.render(x), t);
    await readClaims(page, t);
    return page.screenshot();
  };
  const first = new Map();
  const numbers = new Map();
  for (const t of ts) {
    first.set(t, await draw(t));
    numbers.set(t, await stateAt(t));
  }
  fs.writeFileSync(path.join(outDir, 'film-mid.png'), first.get(ts[3]));
  await page.evaluate((x) => window.SIM.render(x), ts[3]);
  const scene = await sceneRange(page);
  if (scene !== null) add('the scene draws', scene >= 8, `colour range ${scene} in the canvas alone`);
  let worst = 0;
  let worstMean = 0;
  let flat = 0;
  const drift = [];
  for (const t of [...ts].reverse().sort((a, b) => ((a * 7) % 3) - ((b * 7) % 3))) {
    const c = await compare(page, first.get(t), await draw(t));
    worst = Math.max(worst, c.changed);
    worstMean = Math.max(worstMean, c.mean);
    if (c.range < 8) flat++;
    if (hasState && !isDeepStrictEqual(await stateAt(t), numbers.get(t))) drift.push(t.toFixed(2));
  }
  add('frames have a picture', flat === 0, flat ? `${flat} blank` : `${ts.length} frames`);
  add('render(t) is pure', worst <= 0.001 && worstMean <= 0.15, `shuffled re-render changed ${pct(worst)} of pixels`);
  add('state(t) is pure', hasState ? drift.length === 0 : 'note', hasState ? (drift.length ? `differs at t=${drift.join(', ')}` : `${ts.length} times, all finite`) : 'no SIM.state(t) to compare');
  reportClaims();
  add('GPU', 'note', await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const e = gl?.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }));
}

// ---- a live page
// Everything a visitor can press: real controls, and anything that shows a pointer cursor (most of the kit's panels are styled divs).
const findControls = (page) => page.evaluate(() => {
  const NATIVE = 'button,a[href],summary,input:not([type=hidden]),select,[role=button]';
  const seen = [];
  let i = 0;
  for (const el of document.querySelectorAll('body *')) {
    const pointer = getComputedStyle(el).cursor === 'pointer';
    if (!el.matches(NATIVE) && !(pointer && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer'))) continue;
    if (el.closest('[data-smoke]') || !el.getClientRects().length) continue;
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) || el.tagName.toLowerCase();
    el.dataset.smoke = String(i);
    seen.push({i, text, type: el.tagName === 'INPUT' ? 'slider' : el.tagName === 'SELECT' || el.tagName === 'SUMMARY' || el.tagName === 'A' ? 'native' : 'button'});
    i++;
  }
  return seen;
});
// Does anything listen to this control? CDP can see listeners. A click listener on the document or window is real delegation, but the
// window-wide press listener (the tour's hand-over) runs for a press anywhere, so it doesn't count, and neither do the capturing
// click listeners Playwright itself puts on the window. A handler that runs and does nothing can only be caught by state, below, or a plan.
const LISTENS = new Set(['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'input', 'change']);
const isWired = async (cdp, i) => {
  const has = async (expression, types, bubblingOnly = false) => {
    const {result} = await cdp.send('Runtime.evaluate', {expression});
    if (!result.objectId) return null;
    const {listeners} = await cdp.send('DOMDebugger.getEventListeners', {objectId: result.objectId});
    return listeners.some((l) => types.has(l.type) && !(bubblingOnly && l.useCapture));
  };
  for (let depth = 0; depth < 12; depth++) {
    const r = await has(`(() => { let e = document.querySelector('[data-smoke="${i}"]'); for (let n = 0; n < ${depth} && e; n++) e = e.parentElement; return e; })()`, LISTENS);
    if (r === null) break;
    if (r) return true;
  }
  const CLICK = new Set(['click']);
  return !!(await has('document', CLICK, true)) || !!(await has('window', CLICK, true));
};
const stateOf = (page) => page.evaluate(() => window.SIM?.qa?.state?.() ?? null);
const stableKeys = async (page) => {
  const a = await stateOf(page);
  if (!a) return null;
  await page.waitForTimeout(120);
  const b = await stateOf(page);
  return Object.keys(a).filter((k) => isDeepStrictEqual(a[k], b[k]));
};

async function checkLive(page) {
  await page.waitForTimeout(1200);
  const a = await page.screenshot({path: path.join(outDir, 'live-first.png')});
  await page.waitForTimeout(800);
  const b = await page.screenshot();
  const c0 = await compare(page, a, b);
  add('a frame draws', c0.range >= 8, `colour range ${c0.range}`);
  const scene = await sceneRange(page);
  if (scene !== null) add('the scene draws', scene >= 8, `colour range ${scene} in the canvas alone`);
  const movesAlone = c0.changed > 0.0005;
  const framesAtLoad = await page.evaluate(() => window.__frames);
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0;
    const t0 = performance.now();
    const f = () => {
      n++;
      if (performance.now() - t0 < 1500) requestAnimationFrame(f);
      else res(n / 1.5);
    };
    requestAnimationFrame(f);
  }));
  add('frame rate', 'note', `${fps.toFixed(0)} fps here, in headless Chromium (measure on an integrated GPU too)`);
  const loopRan = framesAtLoad > 0;

  const controls = await findControls(page);
  const pressable = controls.filter((c) => c.type !== 'native');
  add('controls found', pressable.length > 0, pressable.length ? `${pressable.length} to press or drag, ${controls.length - pressable.length} other` : 'nothing to press: give each control role=button or a pointer cursor');
  const cdp = await page.context().newCDPSession(page);
  const unwired = [];
  for (const c of pressable) if (!(await isWired(cdp, c.i))) unwired.push(c.text);
  add('every control is wired', unwired.length === 0, unwired.length ? `no listener on: ${unwired.join(', ')}` : '');

  const dead = [];
  const silent = [];
  let clicked = 0;
  let killedBy = null;
  const hasState = !!(await stateOf(page));
  // Take the page out of its tour first: the hand-over is a change of state any press causes, so it mustn't count as this control's effect.
  const handOver = async () => {
    if (!(await stateOf(page))?.tour) return;
    const box = await page.locator('[data-smoke-main]').boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(80);
    }
  };
  const press = async (c, el) => {
    if (c.type === 'slider') await el.evaluate((e) => {
      const lo = Number(e.min || 0);
      const hi = Number(e.max || 100);
      e.value = String(Number(e.value) > (lo + hi) / 2 ? lo : hi);
      e.dispatchEvent(new Event('input', {bubbles: true}));
      e.dispatchEvent(new Event('change', {bubbles: true}));
    });
    else await el.click({timeout: 2000});
  };
  const pressOne = async (c) => {
    const el = page.locator(`[data-smoke="${c.i}"]`);
    if (!(await el.isVisible().catch(() => false))) return; // another control hid it, on purpose
    if (hasState) await handOver();
    const keys = hasState ? await stableKeys(page) : null;
    const before = hasState ? await stateOf(page) : null;
    try {
      await press(c, el);
      clicked++;
    } catch {
      dead.push(c.text);
      return;
    }
    // count from after the click: the frames before it say nothing about whether the loop survived it
    const framesAfter = await page.evaluate(() => window.__frames);
    await page.waitForTimeout(120);
    if (loopRan && !killedBy && (await page.evaluate(() => window.__frames)) === framesAfter) {
      // give a slow GPU a fair chance before calling it dead
      await page.waitForTimeout(800);
      if ((await page.evaluate(() => window.__frames)) === framesAfter) killedBy = c.text;
    }
    // a state with next to nothing steady in it can't show what a control did, so it gets no verdict
    if (!hasState || keys.length < 2) return;
    // an effect may land a moment later
    for (let wait = 0; wait <= 600; wait += 60) {
      const after = await stateOf(page);
      if (keys.some((k) => !isDeepStrictEqual(before[k], after[k]))) return;
      await page.waitForTimeout(60);
    }
    return c;
  };
  // the control that returns to the tour goes last, because taking back over from it resets the state the others changed
  const toTour = (c) => /\btour\b/i.test(c.text);
  const others = pressable.filter((c) => !toTour(c));
  const noEffect = [];
  for (const c of [...others, ...pressable.filter(toTour)]) if (await pressOne(c)) noEffect.push(c);
  // A view button can already be the current view, and a reset can have nothing to reset. It's only dead if it still does nothing
  // after another control has moved things on.
  for (const c of noEffect) {
    let alive = false;
    for (const d of others) {
      if (d === c) continue;
      await pressOne(d);
      if (!(await pressOne(c))) {
        alive = true;
        break;
      }
    }
    if (!alive) silent.push(c.text);
  }
  add('every control responds', dead.length === 0 && clicked > 0, dead.length ? `could not click: ${dead.join(', ')}` : `${clicked} pressed`);
  add('a click stops nothing', !killedBy, killedBy ? `the frame loop stopped after: ${killedBy}` : '');
  add('every control does something', hasState ? silent.length === 0 : 'note', hasState ? (silent.length ? `state unchanged by: ${silent.join(', ')}` : 'state changed each time') : 'no SIM.qa.state() to read: only a plan can tell');
  // a button's own hover and focus ring aren't the machine reacting
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);
  const d = await page.screenshot({path: path.join(outDir, 'live-after-clicks.png')});
  add('still drawing after every click', (await compare(page, d, d)).range >= 8);
  const reacted = (await compare(page, a, d)).changed > 0.0005;
  add('the page moves or reacts', movesAlone || reacted, movesAlone ? `${pct(c0.changed)} of pixels changed in 0.8 s` : reacted ? 'still until you act, then it changes' : 'nothing on screen changed, on its own or after every click');
  await readClaims(page);
  await page.close();

  // the keyboard, on a fresh page: Tab has to reach every control, not just the first thing it finds
  const k = await open({viewport: {width: 1600, height: 900}}, false);
  await k.waitForTimeout(300);
  const fresh = (await findControls(k)).filter((c) => c.type !== 'native');
  const reached = new Set();
  for (let i = 0; i < fresh.length + 12; i++) {
    await k.keyboard.press('Tab');
    const id = await k.evaluate(() => document.activeElement?.dataset?.smoke);
    if (id !== undefined) reached.add(Number(id));
  }
  const missed = fresh.filter((c) => !reached.has(c.i));
  const target = fresh.find((c) => c.type === 'button' && reached.has(c.i));
  let works = !target;
  if (target) {
    await k.evaluate((i) => {
      window.__pressed = false;
      const el = document.querySelector(`[data-smoke="${i}"]`);
      el.addEventListener('click', () => (window.__pressed = true));
      el.focus();
    }, target.i);
    await k.keyboard.press('Enter');
    works = await k.evaluate(() => window.__pressed);
  }
  add('the keyboard reaches every control', fresh.length > 0 && missed.length === 0 && works, missed.length ? `Tab never lands on: ${missed.map((c) => c.text).join(', ')}: use real buttons, or kit/access.js` : works ? `all ${fresh.length} by Tab, and Enter presses` : 'Enter does nothing on the focused control');
  await k.close();

  // reduced motion
  const still = await open({viewport: {width: 1600, height: 900}, reducedMotion: 'reduce'}, false);
  await still.waitForTimeout(1200);
  const s1 = await still.screenshot();
  await still.waitForTimeout(1000);
  const moved = (await compare(still, s1, await still.screenshot())).changed;
  add('reduced motion holds it still', moved <= 0.001, `${pct(moved)} of pixels changed in 1 s`);
  await still.close();

  // a phone, in both orientations. It has to be a mobile viewport: a narrow desktop window never shows the layout bugs a phone does.
  let tiny = null;
  for (const [tag, viewport] of [['upright', {width: 390, height: 844}], ['sideways', {width: 844, height: 390}]]) {
    const phone = await open({viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true}, false);
    await phone.waitForTimeout(1200);
    const shot = await phone.screenshot({path: path.join(outDir, `phone-${tag}.png`)});
    await findControls(phone);
    const view = await phone.evaluate(() => {
      const vis = {w: visualViewport.width, h: visualViewport.height};
      const on = (r) => Math.max(0, Math.min(r.right, vis.w) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vis.h) - Math.max(r.top, 0));
      const canvases = [...document.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height);
      const main = canvases[0];
      const controls = [...document.querySelectorAll('[data-smoke]')].filter((e) => !e.matches('summary,a'));
      const rects = controls.map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width && r.height);
      // reachable: on screen, and what a finger on its centre would actually touch
      const reachable = rects.filter(([e, r]) => {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return on(r) >= r.width * r.height * 0.9 && hit && (hit === e || e.contains(hit) || hit.contains(e));
      }).map(([e]) => e);
      return {
        inner: innerWidth,
        over: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth,
        seen: main ? on(main) / (main.width * main.height || 1) : 1,
        targets: rects.length,
        small: rects.filter(([, r]) => Math.min(r.width, r.height) < 32).length,
        compact: !!document.querySelector('#app.compact'),
        reachable: reachable.length,
        blocked: rects.filter(([e]) => !reachable.includes(e)).map(([e]) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 18)),
      };
    });
    const c = await compare(phone, shot, shot);
    const sceneOn = await sceneRange(phone);
    add(`phone ${tag}: shows the scene`, c.range >= 8 && view.seen >= 0.5 && (sceneOn === null || sceneOn >= 8), c.range < 8 ? 'blank' : sceneOn !== null && sceneOn < 8 ? 'the canvas has nothing in it' : `${Math.round(view.seen * 100)} % of the canvas on screen`);
    add(`phone ${tag}: fits the screen`, Math.abs(view.inner - viewport.width) <= 2 && view.over <= 2, view.inner !== viewport.width ? `the page grew to ${view.inner} px wide, so it renders off screen` : `${view.over} px over`);
    add(`phone ${tag}: reaches every control`, view.reachable >= fresh.length, view.reachable >= fresh.length ? `${view.reachable} of ${fresh.length}` : `${view.reachable} of ${fresh.length}${view.blocked.length ? `; blocked: ${view.blocked.slice(0, 6).join(', ')}` : '; the rest are gone'}`);
    if (view.compact) add(`phone ${tag}: tap targets`, view.small === 0, view.small ? `${view.small} of ${view.targets} are under 32 px, in a layout made for this screen` : `all ${view.targets} are 32 px or more`);
    await readClaims(phone); // a machine can be in frame on a desktop and off it here
    tiny = tiny && tiny.small >= view.small ? tiny : view;
    await phone.close();
  }
  if (!tiny.compact) add('phone: tap targets', 'note', tiny.small ? `${tiny.small} of ${tiny.targets} are under 32 px: pass compact: true to the shell and lay out for small screens` : `all ${tiny.targets} are 32 px or more`);
  reportClaims();
}

// ---- a plan: real actions, expected outcomes. Format in references/quality.md.
const plainGet = (o, p) => p.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
const RULES = ['equals', 'min', 'max', 'near', 'tolerance', 'changed'];
function matches(current, before, expect) {
  if (!expect || !Object.keys(expect).length) throw new Error('Every plan step needs a nonempty expect: clicking without an expected outcome proves nothing');
  const bad = [];
  for (const [p, rule] of Object.entries(expect)) {
    if (!rule || !Object.keys(rule).length || Object.keys(rule).some((k) => !RULES.includes(k))) throw new Error(`Invalid rule for ${p}: use ${RULES.join(', ')}`);
    if (Object.keys(rule).every((k) => k === 'tolerance')) throw new Error(`No assertion for ${p}`);
    const value = plainGet(current, p);
    const old = plainGet(before, p);
    if (value === undefined) {
      bad.push(`${p} missing`);
      continue;
    }
    if ('equals' in rule && !isDeepStrictEqual(value, rule.equals)) bad.push(`${p}: expected ${JSON.stringify(rule.equals)}, got ${JSON.stringify(value)}`);
    if ('min' in rule && !(typeof value === 'number' && value >= rule.min)) bad.push(`${p} = ${value}, below ${rule.min}`);
    if ('max' in rule && !(typeof value === 'number' && value <= rule.max)) bad.push(`${p} = ${value}, above ${rule.max}`);
    if ('near' in rule && !(typeof value === 'number' && Math.abs(value - rule.near) <= (rule.tolerance ?? 1e-6))) bad.push(`${p} = ${value}, not near ${rule.near}`);
    if ('changed' in rule && isDeepStrictEqual(old, value) === rule.changed) bad.push(`${p} ${rule.changed ? 'did not change' : 'changed'}`);
  }
  return bad;
}
async function runPlan(planFile) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.steps) || !plan.steps.length) throw new Error('A plan needs schemaVersion: 1 and at least one step');
  if (plan.reducedMotion !== undefined && !['reduce', 'no-preference'].includes(plan.reducedMotion)) throw new Error('reducedMotion must be reduce or no-preference');
  for (const step of plan.steps) matches({}, {}, step.expect); // reject a bad rule before driving anything
  const sizes = plan.viewports ?? [{width: 1600, height: 900}, {width: 390, height: 844}];
  const readState = (page) => page.evaluate((p) => {
    const v = p ? p.split('.').reduce((o, k) => o?.[k], window) : window.SIM?.qa?.state?.();
    if (v === undefined) throw new Error('No state to read: expose window.SIM.qa.state(), or set stateGlobal in the plan');
    return v;
  }, plan.stateGlobal ?? null);
  for (const size of sizes) {
    const small = Math.min(size.width, size.height) < 600;
    const page = await open({viewport: size, reducedMotion: plan.reducedMotion, ...(small ? {deviceScaleFactor: 2, isMobile: true, hasTouch: true} : {})}, false);
    const tag = `${size.width}x${size.height}`;
    for (const [i, step] of plan.steps.entries()) {
      if (step.only && step.only !== (small ? 'phone' : 'desktop')) continue;
      const name = `${tag}: ${step.name ?? i}`.slice(0, 60);
      const touch = async (el, delta) => {
        const b = await el.boundingBox();
        if (!b) throw new Error(`Nothing to drag: ${step.selector}`);
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
        for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + (delta[0] * k) / 8, y: y + (delta[1] * k) / 8}]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      };
      try {
        const before = await readState(page);
        const el = step.selector ? page.locator(step.selector).first() : null;
        switch (step.action) {
          case 'click':
            if (small) await el.tap({timeout: 5000});
            else await el.click({timeout: 5000});
            break;
          case 'fill':
            await el.waitFor({state: 'visible', timeout: 5000});
            // a slider has to fire the same events a hand would
            if ((await el.getAttribute('type')) === 'range') await el.evaluate((e, value) => {
              e.value = value;
              e.dispatchEvent(new Event('input', {bubbles: true}));
              e.dispatchEvent(new Event('change', {bubbles: true}));
            }, String(step.value));
            else await el.fill(String(step.value), {timeout: 5000});
            break;
          case 'press':
            if (el) await el.press(step.key);
            else await page.keyboard.press(step.key);
            break;
          case 'drag': {
            await el.scrollIntoViewIfNeeded();
            if (small) {
              await touch(el, step.delta ?? [60, 0]);
              break;
            }
            const b = await el.boundingBox();
            if (!b) throw new Error(`Nothing to drag: ${step.selector}`);
            const x = b.x + b.width / 2;
            const y = b.y + b.height / 2;
            const delta = step.delta ?? [60, 0];
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x + delta[0], y + delta[1], {steps: 8});
            await page.mouse.up();
            break;
          }
          case 'pinch': {
            const b = await el.boundingBox();
            if (!b) throw new Error(`Nothing to pinch: ${step.selector}`);
            const x = b.x + b.width / 2;
            const y = b.y + b.height / 2;
            const at = (d) => [{x: x - d, y, id: 1}, {x: x + d, y, id: 2}];
            const cdp = await page.context().newCDPSession(page);
            const r0 = 30;
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: at(r0)});
            for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: at(r0 + ((r0 * (step.scale ?? 2) - r0) * k) / 8)});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
            break;
          }
          case 'wait':
            break;
          default:
            throw new Error(`Unknown action: ${step.action}`);
        }
        if (step.waitMs) await page.waitForTimeout(Math.min(10000, step.waitMs));
        const deadline = Date.now() + (step.withinMs ?? 2000);
        let bad;
        for (;;) {
          bad = matches(await readState(page), before, step.expect);
          if (!bad.length || Date.now() > deadline) break;
          await page.waitForTimeout(50);
        }
        add(name, bad.length === 0, bad.join('; '));
      } catch (e) {
        add(name, false, e.message.split('\n')[0].slice(0, 160));
      }
      await page.screenshot({path: path.join(outDir, `plan-${tag}-${String(i).padStart(2, '0')}.png`)});
    }
    await page.close();
  }
}

let kind = 'live';
try {
  const page = await open({viewport: {width: 1600, height: 900}}, opt.mode !== 'live');
  const isFilm = opt.mode ? opt.mode === 'film' : await page.evaluate(() => typeof window.SIM?.render === 'function');
  if (isFilm) {
    kind = 'film';
    await checkFilm(page);
  } else await checkLive(page);
  if (opt.qa) await runPlan(opt.qa);
} catch (e) {
  add('runner', false, e.message.split('\n')[0].slice(0, 200));
}
await browser.close();
add('works offline', network.length === 0, network.length ? network.slice(0, 3).join(', ') : 'no network requests');
add('no page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
const failed = rows.some((r) => r.status === false);
writeJSON(path.join(outDir, 'report.json'), {schemaVersion: 1, file: html, sha256: hashFile(html), bytes: fs.statSync(html).size, kind, status: failed ? 'fail' : 'pass', checks: rows});
console.log(`${kind.toUpperCase()}  ${path.basename(html)}  (${(fs.statSync(html).size / 1024).toFixed(0)} KB)`);
for (const r of rows) console.log(`  ${r.status === 'note' ? 'note' : r.status ? 'ok  ' : 'FAIL'} ${r.name.padEnd(36)} ${r.detail}`);
console.log(`  report and screenshots: ${outDir}`);
process.exitCode = failed ? 1 : 0;
