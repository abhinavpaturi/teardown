// What the scripts share: strict argument parsing, hashes, and opening a page the way capture does.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

export function args(options) {
  try {
    return parseArgs({options, allowPositionals: true, strict: true});
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
export const hashFile = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export const writeJSON = (f, v) => {
  fs.mkdirSync(path.dirname(f), {recursive: true});
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
};
export function positive(v, label, integer = false) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) throw new Error(`${label} must be a positive ${integer ? 'integer' : 'number'}`);
  return n;
}
export function viewport(v) {
  if (!/^\d+x\d+$/.test(v)) throw new Error('--size must be WIDTHxHEIGHT');
  const [width, height] = v.split('x').map((x) => positive(x, 'viewport size', true));
  return {width, height};
}
/** Note every WebGL context a page opens, so the GPU we report is the one it really draws with. */
export async function observeRenderers(page) {
  await page.addInitScript(() => {
    if (window.__TEARDOWN_GL) return;
    window.__TEARDOWN_GL = [];
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      const context = getContext.call(this, type, ...options);
      if (context && ['webgl', 'webgl2', 'experimental-webgl'].includes(type) && !window.__TEARDOWN_GL.includes(context)) window.__TEARDOWN_GL.push(context);
      return context;
    };
  });
}
export async function rendererInfo(page) {
  return page.evaluate(() => {
    const gl = window.__TEARDOWN_GL?.[0];
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'not observed';
  });
}
/** Wait for a page to say it's ready. An error on the way fails in seconds, by name, instead of after a minute's silence. */
export async function waitReady(page, errors, ready, base = 0) {
  const t0 = Date.now();
  let failing = 0;
  for (;;) {
    if (await page.evaluate(ready).catch(() => false)) return;
    if (errors.length > base && !failing) failing = Date.now();
    if (failing && Date.now() - failing > 3000) throw new Error(`The page failed while loading: ${errors[base]}`);
    if (Date.now() - t0 > 60000) throw new Error('The page never said it was ready: no window.SIM.ready or window.SIM_SHOWN after 60 s');
    await page.waitForTimeout(100);
  }
}
/** Open a page in capture mode, whichever contract it uses: window.SIM.render(t) or window.seek(t). */
export async function openCapture(page, html, config = {}, errors = []) {
  await observeRenderers(page);
  await page.addInitScript((cfg) => {
    window.__CAPTURE = true;
    window.__SIM_CONFIG = cfg;
  }, config);
  await page.goto(pathToFileURL(html).href + '?capture&render');
  await waitReady(page, errors, () => (window.SIM?.ready && typeof window.SIM.render === 'function') || typeof window.seek === 'function');
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => ({
    duration: window.SIM?.duration ?? window.DURATION,
    contract: window.SIM?.ready && typeof window.SIM.render === 'function' ? 'SIM' : 'seek',
    hasState: typeof window.SIM?.state === 'function',
  }));
}
export const draw = (page, t) => page.evaluate(async (x) => {
  if (window.SIM?.ready && typeof window.SIM.render === 'function') await window.SIM.render(x);
  else await window.seek(x);
}, t);
