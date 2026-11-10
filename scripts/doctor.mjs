#!/usr/bin/env node
// Preflight: can this machine build and record? Checks the dependencies and draws a real WebGL frame in headless Chromium.
// Installs nothing. Run it first; the failures it prevents otherwise surface as a 60 s capture timeout.
//   node scripts/doctor.mjs [--video]     (--video makes ffmpeg, ffprobe and Python required, not just noted)
import {spawnSync} from 'node:child_process';
import {CHROMIUM, CHROMIUM_ARGS, DEPS, FFMPEG, FFPROBE, PYTHON, fromDeps, hasDep} from '../paths.mjs';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/doctor.mjs [--video]\nChecks the dependencies and draws a real WebGL frame. Installs nothing.');
  process.exit(0);
}
const video = process.argv.includes('--video');
const rows = [];
const add = (name, ok, detail, remedy, required = true) => rows.push({name, ok, detail, remedy, required});

const major = Number(process.versions.node.split('.')[0]);
add('Node 20+', major >= 20, process.version, 'Install Node.js 20 or newer.');
for (const id of ['esbuild', 'three', 'playwright']) {
  const ok = hasDep(id);
  add(id, ok, ok ? 'installed' : `not in ${DEPS}`, 'Run: npm ci   (in the skill folder)');
}
for (const [name, exe, flag, remedy] of [
  ['ffmpeg', FFMPEG, '-version', 'Needed for video. Install ffmpeg, or set FFMPEG to its path.'],
  ['ffprobe', FFPROBE, '-version', 'Needed for video. It ships with ffmpeg; or set FFPROBE to its path.'],
  ['Python 3', PYTHON, '--version', 'Needed for the score. Install Python 3, or set PYTHON to its path.'],
]) {
  const r = spawnSync(exe, [flag], {encoding: 'utf8', timeout: 10000});
  const ok = !r.error && r.status === 0;
  add(name, ok, ok ? (r.stdout || r.stderr).split('\n')[0].slice(0, 60) : 'not found', remedy, video);
}
let gpu = null;
let browser;
try {
  browser = await fromDeps('playwright').chromium.launch({executablePath: CHROMIUM, args: CHROMIUM_ARGS, timeout: 30000});
  const page = await browser.newPage();
  gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('no WebGL2 context');
    gl.clearColor(0.25, 0.5, 0.75, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (px[1] < 120) throw new Error('WebGL draw did not read back');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  add('Chromium WebGL2', true, gpu);
  if (/swiftshader|llvmpipe|software/i.test(gpu)) add('GPU', false, 'software renderer: pages will work, renders will be slow', 'Check the GPU flags in paths.mjs (CHROMIUM_ARGS).', false);
} catch (e) {
  add('Chromium WebGL2', false, String(e.message).split('\n')[0].slice(0, 110),
    'Run: npx playwright install chromium. In Claude Code, run this and capture.mjs with the Bash sandbox disabled: inside it the Chromium install has been seen to hang while unpacking.');
} finally {
  await browser?.close();
}
let bad = 0;
for (const r of rows) {
  const tag = r.ok ? 'ok  ' : r.required ? 'FAIL' : 'note';
  if (!r.ok && r.required) bad++;
  console.log(`${tag} ${r.name.padEnd(16)} ${r.detail}`);
  if (!r.ok) console.log(`     -> ${r.remedy}`);
}
console.log(bad ? `\n${bad} problem(s) to fix.` : '\nReady.');
process.exitCode = bad ? 1 : 0;
