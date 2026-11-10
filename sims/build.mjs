#!/usr/bin/env node
// Bundles every sims/<name>/main.js into one self-contained HTML file:
// teardown-out/dist/<name>.html (three.js, fonts, CSS inlined). Opens from file://,
// works offline, can be published as-is.
//
//   node sims/build.mjs                 every example in sims/
//   node sims/build.mjs v8-live         one example
//   node sims/build.mjs ./my-machine    your own sim: any folder with a main.js. Import the kit as
//                                       'teardown-kit/runtime.js', 'teardown-kit/util.js' and so on.
//
// A folder next to you wins over an example of the same name. Every build leaves <name>.build.json: bytes, SHA-256, whether the
// page is one file, and what takes the room.
//
// An entry may carry build.json with {"title": "The page's name"}, {"css": "../style.css"} and {"kitCss": false} (use your own
// stylesheet, without the kit's full-screen layout), and {"swap": {"heavy.glb": "light.glb"}}: every import of a file named heavy.glb is
// served from light.glb in the same folder (a site page with lighter models than its film). {"external": {...}} does
// the same but leaves the model out of the page: the import becomes the string "url:light.glb", the file is copied
// next to the page and listed in <name>.assets.json (the site build copies those too). The page stays small enough
// for link crawlers (X reads the share card from it). {"files": [...]} copies more files from node_modules next to the
// page the same way (decoders a loader fetches at runtime).
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEPS, DIST, fromDeps} from '../paths.mjs';

if (process.argv.includes('--help')) {
  console.log('Usage: node sims/build.mjs [example-name | ./entry-folder ...]\nWrites offline HTML, plus <name>.build.json with its size, hash and largest inputs.');
  process.exit(0);
}
const esbuild = fromDeps('esbuild');

const HERE = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(DIST, {recursive: true});

const font = (weight) => {
  const file = path.join(
    DEPS,
    `@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${weight}-normal.woff2`,
  );
  const b64 = fs.readFileSync(file).toString('base64');
  return `@font-face{font-family:'JetBrains Mono';font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
};
const inter = fs.readFileSync(path.join(DEPS, '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
const FONTS = [400, 600, 700].map(font).join('\n') +
  `\n@font-face{font-family:'Inter';font-weight:100 900;font-style:normal;font-display:block;src:url(data:font/woff2;base64,${inter}) format('woff2');}`;
const KIT_CSS = fs.readFileSync(path.join(HERE, 'kit/style.css'), 'utf8');

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs
      .readdirSync(HERE)
      .filter((d) => fs.existsSync(path.join(HERE, d, 'main.js')));

// `teardown-kit/x.js` resolves to sims/kit/x.js, so a sim outside this folder can use the kit.
const kitPlugin = {
  name: 'teardown-kit',
  setup(b) {
    b.onResolve({filter: /^teardown-kit\//}, (args) => ({path: path.join(HERE, 'kit', args.path.slice('teardown-kit/'.length))}));
  },
};

for (const arg of names) {
  // your own folder first: a machine you named v8 must not build the bundled V8
  const dir = fs.existsSync(path.join(path.resolve(arg), 'main.js')) ? path.resolve(arg) : path.join(HERE, arg);
  if (!fs.existsSync(path.join(dir, 'main.js'))) {
    console.error(`no main.js in ${dir}`);
    process.exit(1);
  }
  const name = path.basename(dir);
  const t0 = Date.now();
  const cfgFile = path.join(dir, 'build.json');
  const bcfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
  const swap = bcfg.swap || {};
  const external = bcfg.external || {};
  const assets = [];
  const plugins = Object.keys(external).length
    ? [
        {
          name: 'external',
          setup(b) {
            b.onResolve({filter: /\.glb$/}, (args) => {
              const base = path.basename(args.path);
              if (!external[base]) return undefined;
              const src = path.join(args.resolveDir, path.dirname(args.path), external[base]);
              if (!assets.includes(src)) assets.push(src);
              return {path: external[base], namespace: 'ext'};
            });
            b.onLoad({filter: /.*/, namespace: 'ext'}, (args) => ({contents: `export default ${JSON.stringify('url:' + args.path)};`, loader: 'js'}));
          },
        },
      ]
    : Object.keys(swap).length
    ? [
        {
          name: 'swap',
          setup(b) {
            b.onResolve({filter: /\.glb$/}, (args) => {
              const base = path.basename(args.path);
              if (!swap[base]) return undefined;
              return {path: path.join(args.resolveDir, path.dirname(args.path), swap[base])};
            });
          },
        },
      ]
    : [];
  const res = await esbuild.build({
    plugins: [kitPlugin, ...plugins],
    entryPoints: [path.join(dir, 'main.js')],
    bundle: true,
    nodePaths: [DEPS],
    format: 'esm',
    minify: !process.env.SIMS_DEBUG,
    write: false,
    target: 'es2022',
    legalComments: 'none',
    metafile: true,
    loader: {'.glb': 'base64', '.woff2': 'base64'},
    logLevel: 'warning',
  });
  const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
  const cssPath = path.resolve(dir, bcfg.css || 'style.css');
  if (bcfg.css && !fs.existsSync(cssPath)) throw new Error(`Missing project CSS: ${cssPath}`);
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,viewport-fit=cover">
<title>${String(bcfg.title || name).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c])}</title>
<style>
${FONTS}
${bcfg.kitCss === false ? '' : KIT_CSS}
${css}
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
${js}
</script>
</body>
</html>
`;
  const out = path.join(DIST, `${name}.html`);
  fs.writeFileSync(out, html);
  const listFile = path.join(DIST, `${name}.assets.json`);
  assets.push(...(bcfg.files || []).map((f) => path.join(DEPS, f)));
  if (assets.length) {
    for (const a of assets) fs.copyFileSync(a, path.join(DIST, path.basename(a)));
    fs.writeFileSync(listFile, JSON.stringify(assets.map((a) => path.basename(a))));
  } else if (fs.existsSync(listFile)) fs.rmSync(listFile);
  const inputs = Object.values(res.metafile.outputs).flatMap((o) => Object.entries(o.inputs || {})).map(([file, v]) => ({file: file.replace(/.*node_modules\//, ''), bytes: v.bytesInOutput})).sort((x, y) => y.bytes - x.bytes);
  const report = {schemaVersion: 1, output: out, bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex'), singleFile: assets.length === 0,
    assets: assets.map((a) => ({file: path.basename(a), bytes: fs.statSync(a).size})), largestInputs: inputs.slice(0, 25)};
  fs.writeFileSync(path.join(DIST, `${name}.build.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`${out}  ${(report.bytes / 1024).toFixed(0)} KB  ${Date.now() - t0} ms`);
  // over the link-preview guideline: say what is taking the room instead of leaving it to guesswork
  if (report.bytes > 1024 * 1024) console.log(`  over 1 MB (fine offline, link crawlers may skip the card). Largest: ${inputs.slice(0, 6).map((i) => `${path.basename(i.file)} ${(i.bytes / 1024).toFixed(0)} KB`).join(', ')}`);
}
