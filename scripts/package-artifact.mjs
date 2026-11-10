#!/usr/bin/env node
// Makes a built page ready to publish as a Claude Artifact: the host wraps a page in its own document, so this keeps the title,
// the styles, the app root and the module script, and pins the page's own background so it looks the same in either theme.
//   node scripts/package-artifact.mjs teardown-out/dist/my-machine-live.html --title "My Machine" [--bg "#eef1f2"] [--out file.html]
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log('Usage: node scripts/package-artifact.mjs page.html --title "Page Name" [--bg "#eef1f2"] [--out file.html]');
  process.exit(0);
}
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const file = argv.find((a, i) => !a.startsWith('--') && !['--title', '--bg', '--out'].includes(argv[i - 1]));
const title = opt('--title');
if (!file || !title) {
  console.error('Usage: node scripts/package-artifact.mjs page.html --title "Page Name" [--bg "#eef1f2"] [--out file.html]');
  process.exit(2);
}
const src = fs.readFileSync(file, 'utf8');
const style = src.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const script = src.match(/<script type="module">([\s\S]*)<\/script>\s*<\/body>/)?.[1];
if (style === undefined || script === undefined) {
  console.error(`${file} does not look like a page from sims/build.mjs`);
  process.exit(1);
}
const esc = (s) => s.replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]);
const bg = opt('--bg', '#eef1f2');
const out = opt('--out', path.join(path.dirname(file), 'artifact', path.basename(file)));
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, `<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,viewport-fit=cover">
<style>
:root{color-scheme:light}
html,body{height:100%;background:${bg}}
${style}
</style>
<div id="app"></div>
<script type="module">${script}</script>
`);
console.log(`${out}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
