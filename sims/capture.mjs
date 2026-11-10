#!/usr/bin/env node
// Frame-accurate capture: steps window.SIM.render(t) (or a page's seek(t)) for every frame in headless Chromium and pipes the
// screenshots to ffmpeg. A failure fails the run: a page error, a dead encoder and an audio track that's too short all exit
// nonzero, and the video only replaces an earlier one once it's complete. Every run leaves <out>.capture.json with its settings and hashes.
//
//   node sims/capture.mjs <name|file.html> [--size 1600x900] [--dpr 1.2] [--fps 60] [--from 0] [--to <duration>] [--out f.mp4]
//     --size is the layout in CSS px and --dpr multiplies it: 1600x900 at 1.2 is 1920x1080. Size x dpr must be whole, even numbers.
//   What to make (a video if none of these):
//     --still 12.5                     one PNG
//     --stills 0,4,9,14 [--cols 3]     a tiled review sheet, every tile labelled t=
//     --stills beats [--timeline f]    one tile per timeline beat, +0.3 s so motion settles; every 2 s if it has no beats
//     --stills every:0.2 --from 3 --to 5   scrub a transition
//   Sound:
//     --score synced.wav               a score already on the film's timeline: kept as mastered, no warping
//     --music song.mp3 [--music-start auto|SEC] [--no-sync] [--lufs -21]   a song: analysed, and the director follows its beats
//   Also: --config post.json  --crf 16
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CHROMIUM, CHROMIUM_ARGS, DIST, FFMPEG, FFPROBE, OUT, PYTHON, playwright} from '../paths.mjs';
import {reviewTimes} from '../timeline.mjs';
import {args, draw, hashFile, openCapture, positive, rendererInfo, viewport, writeJSON} from '../scripts/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const {values: opt, positionals} = args({
  help: {type: 'boolean'}, config: {type: 'string'}, out: {type: 'string'},
  size: {type: 'string', default: '1600x900'}, dpr: {type: 'string', default: '1.2'},
  fps: {type: 'string', default: '60'}, from: {type: 'string', default: '0'}, to: {type: 'string'},
  still: {type: 'string'}, stills: {type: 'string'}, timeline: {type: 'string'}, cols: {type: 'string', default: '3'},
  score: {type: 'string'}, music: {type: 'string'}, 'music-start': {type: 'string', default: 'auto'},
  'no-sync': {type: 'boolean'}, lufs: {type: 'string', default: '-21'}, crf: {type: 'string', default: '16'},
});
if (opt.help || !positionals.length) {
  console.log('Usage: node sims/capture.mjs <built-name|file.html> [--size 1600x900 --dpr 1.2 --fps 60]\n  --still T | --stills beats|every:STEP|T,T [--timeline file.json]\n  --from T --to T --out file.mp4 [--score synced.wav | --music song.mp3]\n--score keeps the film\'s timing and the audio master. --music needs --to or config.duration.');
  process.exit(opt.help ? 0 : 1);
}
const name = positionals[0];
const html = path.resolve(name.endsWith('.html') ? name : path.join(DIST, `${name}.html`));
const label = path.basename(html, '.html');
const isImage = opt.still !== undefined || !!opt.stills;
const out = path.resolve(opt.out || path.join(OUT, `${label}${opt.still !== undefined ? '-' + opt.still : opt.stills ? '-sheet' : ''}.${isImage ? 'png' : 'mp4'}`));
const report = {schemaVersion: 1, input: html, output: out, status: 'running', errors: []};
let browser;
let encoder;
const temps = [];
const finished = (child) => {
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: exit ${code}, signal ${signal}`))));
  });
  done.catch(() => {}); // awaited later; this stops an unhandled rejection if the encoder dies during a screenshot
  return done;
};
const ffmpeg = (argv) => finished(spawn(FFMPEG, ['-loglevel', 'error', '-y', ...argv], {stdio: 'inherit'}));

try {
  if (positionals.length !== 1) throw new Error('Pass exactly one built name or HTML file');
  if (!fs.existsSync(html)) throw new Error(`Missing ${html}: build it first (node sims/build.mjs ${name})`);
  if (opt.score && opt.music) throw new Error('Use --score or --music, not both');
  if (opt.still !== undefined && opt.stills) throw new Error('Use --still or --stills, not both');
  const v = viewport(opt.size);
  const dpr = positive(opt.dpr, 'dpr');
  const fps = positive(opt.fps, 'fps');
  const cols = positive(opt.cols, 'cols', true);
  const from = Number(opt.from);
  if (!Number.isFinite(from) || from < 0) throw new Error('--from must not be negative');
  if (!isImage && [v.width * dpr, v.height * dpr].some((n) => Math.abs(n - Math.round(n)) > 1e-6 || Math.round(n) % 2))
    throw new Error(`H.264 needs whole, even output dimensions: ${opt.size} at dpr ${dpr} is ${v.width * dpr} x ${v.height * dpr}`);
  if (!Number.isFinite(Number(opt.crf)) || Number(opt.crf) < 0 || Number(opt.crf) > 51) throw new Error('--crf must be between 0 and 51');
  if (!Number.isFinite(Number(opt.lufs))) throw new Error('--lufs must be a number');
  if (opt.still !== undefined && (!Number.isFinite(Number(opt.still)) || Number(opt.still) < 0)) throw new Error('--still must not be negative');
  if (opt.stills?.startsWith('every:')) positive(opt.stills.slice(6), 'the --stills interval');
  if (opt.timeline && !fs.existsSync(opt.timeline)) throw new Error(`Missing timeline: ${opt.timeline}`);
  const config = opt.config ? JSON.parse(fs.readFileSync(opt.config, 'utf8')) : {};
  let beats;
  if (opt.music) {
    const duration = positive(Number(opt.to ?? config.duration) - from, 'the music capture length; pass --to or config.duration');
    const song = path.resolve(opt.music);
    const cache = path.join(OUT, 'beats', `${hashFile(song).slice(0, 16)}-${duration}-${String(opt['music-start']).replace(/[^a-zA-Z0-9.-]/g, '_')}.json`);
    fs.mkdirSync(path.dirname(cache), {recursive: true});
    execFileSync(PYTHON, ['-I', path.join(HERE, 'beats.py'), song, '--duration', String(duration), '--start', opt['music-start'], '-o', cache], {stdio: 'inherit'});
    beats = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (!opt['no-sync']) config.beats = beats;
  }
  fs.mkdirSync(path.dirname(out), {recursive: true});
  Object.assign(report, {sha256: hashFile(html), viewport: v, dpr, fps, from, config});
  browser = await playwright().chromium.launch({executablePath: CHROMIUM, args: CHROMIUM_ARGS});
  const page = await browser.newPage({viewport: v, deviceScaleFactor: dpr});
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  page.on('requestfailed', (r) => report.errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  const info = await openCapture(page, html, config, report.errors);
  report.gpu = await rendererInfo(page);
  report.contract = info.contract;
  console.log(`gpu: ${report.gpu}`);
  const end = positive(opt.to ?? info.duration, 'the duration; pass --to for a page with no DURATION');
  if (end <= from) throw new Error('--to must be after --from');
  report.to = end;
  const render = async (t) => {
    await draw(page, t);
    if (report.errors.length) throw new Error(`Page errors: ${report.errors.join('\n')}`);
  };

  if (opt.still !== undefined) {
    const t = Number(opt.still);
    if (t > end) throw new Error('--still is past the end of the film');
    await render(t);
    await page.screenshot({path: out});
    report.times = [t];
  } else if (opt.stills) {
    let ts;
    if (opt.stills === 'beats') {
      // beside the machine you're building, or an example in the skill
      const file = [opt.timeline, path.resolve(name, 'timeline.json'), path.resolve('timeline.json'), path.join(HERE, name, 'timeline.json')].filter(Boolean).find((f) => fs.existsSync(f));
      if (!file) throw new Error(`No timeline.json for ${name}: pass --timeline <file>, or use --stills every:2`);
      const tl = JSON.parse(fs.readFileSync(file, 'utf8'));
      // the page carries the timeline it was built with, so this file can have moved on without it
      if (Number.isFinite(tl.duration) && Number.isFinite(info.duration) && Math.abs(tl.duration - info.duration) > 0.01) throw new Error(`${path.basename(file)} says ${tl.duration} s and the built page says ${info.duration} s: rebuild the page`);
      if (fs.statSync(file).mtimeMs > fs.statSync(html).mtimeMs) console.log(`note: ${path.basename(file)} is newer than the built page. If the film reads it, rebuild first.`);
      const {times, fallback} = reviewTimes(tl, end);
      if (fallback) console.log(`${path.basename(file)} has no beats beyond its duration: one tile every 2 s`);
      ts = fallback ? times : [0, ...times.map((t) => t + 0.3)];
    } else if (opt.stills.startsWith('every:')) {
      const step = positive(opt.stills.slice(6), 'the --stills interval');
      const count = Math.floor((end - from) / step) + 1;
      if (count > 10000) throw new Error('Too many stills: use a larger interval or a smaller range');
      ts = Array.from({length: count}, (_, i) => from + i * step);
    } else ts = opt.stills.split(',').map(Number);
    if (!ts.length || ts.some((t) => !Number.isFinite(t) || t < 0)) throw new Error('Invalid still times');
    ts = [...new Set(ts.map((t) => +Math.min(t, Math.max(0, end - 1 / 120)).toFixed(4)))].sort((a, b) => a - b);
    const dir = out.replace(/\.[^.]+$/, '') + '-frames';
    fs.mkdirSync(dir, {recursive: true});
    // a shorter run mustn't inherit tiles from a longer one
    for (const f of fs.readdirSync(dir).filter((f) => /^\d{3,}\.png$/.test(f))) fs.rmSync(path.join(dir, f));
    for (const [i, t] of ts.entries()) {
      await render(t);
      // the t= label goes into the DOM for the screenshot only, so no ffmpeg font setup is needed
      await page.evaluate((text) => {
        const el = document.createElement('div');
        el.id = '__capture_time';
        el.textContent = text;
        el.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;font:600 24px monospace;color:white;background:#000b;padding:4px 10px';
        document.body.appendChild(el);
      }, `t=${t.toFixed(2)}`);
      await page.screenshot({path: path.join(dir, `${String(i).padStart(4, '0')}.png`)});
      await page.evaluate(() => document.getElementById('__capture_time')?.remove());
    }
    const ncols = Math.min(cols, ts.length);
    const sheet = out.endsWith('.png') ? out : out + '.png';
    await ffmpeg(['-framerate', '1', '-i', path.join(dir, '%04d.png'), '-vf', `scale=${Math.round(v.width * 0.4)}:${Math.round(v.height * 0.4)},tile=${ncols}x${Math.ceil(ts.length / ncols)}:padding=4:color=0x333333`, '-frames:v', '1', sheet]);
    Object.assign(report, {output: sheet, framesDirectory: dir, times: ts});
  } else {
    const frames = Math.round((end - from) * fps);
    if (frames < 1) throw new Error('The capture range contains no frames');
    const audio = opt.score || opt.music;
    if (audio) {
      if (!fs.existsSync(audio)) throw new Error(`Missing audio: ${audio}`);
      const length = Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], {encoding: 'utf8'}).trim());
      const needed = opt.score ? from + frames / fps : beats.start + frames / fps;
      if (!Number.isFinite(length) || length + 0.001 < needed) throw new Error(`The audio is too short: ${length} s, and this needs ${needed} s`);
      report.audio = {file: path.resolve(audio), sha256: hashFile(audio), mode: opt.score ? 'score' : 'music'};
    }
    const silent = path.join(path.dirname(out), `.${label}-${process.pid}-render.mp4`);
    temps.push(silent);
    // -c:v mjpeg: says what's coming down the pipe, because a small, flat first frame can defeat ffmpeg's guess
    encoder = spawn(FFMPEG, ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', opt.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], {stdio: ['pipe', 'inherit', 'inherit']});
    const done = finished(encoder);
    let pipeError;
    encoder.stdin.on('error', (e) => {
      pipeError = e;
    });
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      await render(from + i / fps);
      const buf = await page.screenshot({type: 'jpeg', quality: 97});
      if (pipeError || encoder.exitCode !== null || encoder.stdin.destroyed) throw pipeError || new Error('The encoder exited before all frames were written');
      if (!encoder.stdin.write(buf)) await Promise.race([once(encoder.stdin, 'drain'), done.then(() => {
        throw new Error('The encoder exited while writing');
      })]);
      if (i % Math.round(fps) === 0) process.stdout.write(`\r${i}/${frames} frames  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    encoder.stdin.end();
    await done;
    encoder = undefined;
    if (audio) {
      const mux = path.join(path.dirname(out), `.${label}-${process.pid}-mux.mp4`);
      temps.push(mux);
      const af = opt.score ? [] : ['-af', `loudnorm=I=${opt.lufs}:TP=-3,afade=t=in:d=0.04,afade=t=out:st=${Math.max(0, frames / fps - 0.6)}:d=0.6`];
      await ffmpeg(['-i', silent, '-ss', String(opt.score ? from : beats.start), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', ...af, '-t', String(frames / fps), '-movflags', '+faststart', mux]);
      fs.renameSync(mux, out);
    } else fs.renameSync(silent, out);
    Object.assign(report, {frames, encodedDuration: frames / fps});
    console.log(`\r${frames}/${frames} frames  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  if (report.errors.length) throw new Error('Page errors occurred during capture');
  report.status = 'pass';
  report.outputSha256 = hashFile(report.output);
  console.log(`→ ${report.output}`);
} catch (e) {
  report.status = 'fail';
  report.errors.push(e.message);
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (encoder) {
    encoder.stdin.destroy();
    encoder.kill('SIGKILL');
  }
  await browser?.close();
  for (const f of temps) fs.rmSync(f, {force: true});
  writeJSON(out + '.capture.json', report);
}
