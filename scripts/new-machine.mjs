#!/usr/bin/env node
// Starts a machine as a working project: a slider-crank with its model and test, geometry, console, film and live page, all built
// on the kit. It runs before you change anything, so every later change starts from something that works.
//   node scripts/new-machine.mjs /path/to/project --name my-engine [--title "My Engine"]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log('Usage: node scripts/new-machine.mjs /path/to/project --name my-engine [--title "My Engine"]\nWrites a working starter machine there, and refuses to overwrite a file.');
  process.exit(0);
}
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const dest = argv.find((a, i) => !a.startsWith('--') && !['--name', '--title'].includes(argv[i - 1]));
const name = opt('--name');
if (!dest || !name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('Usage: node scripts/new-machine.mjs /path/to/project --name my-engine [--title "My Engine"]\nThe name is lower case letters, digits and hyphens.');
  process.exit(2);
}
const title = opt('--title') || name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const root = path.resolve(dest);
const starter = path.join(HERE, '../assets/starter');
// a title can hold an apostrophe or a quote: write it as a string literal where the file treats it as one
const literal = JSON.stringify(title);
const fill = (s) => s
  .replaceAll("'__TITLE__'", literal)
  .replaceAll('"__TITLE__"', literal)
  .replaceAll('__NAME__', name)
  .replaceAll('__TITLE__', title.replace(/["\\]/g, ''));
const made = [];
const walk = (from, to) => {
  for (const e of fs.readdirSync(from, {withFileTypes: true})) {
    const a = path.join(from, e.name);
    const b = path.join(to, fill(e.name));
    if (e.isDirectory()) walk(a, b);
    else {
      if (fs.existsSync(b)) {
        console.error(`Refusing to overwrite ${b}`);
        process.exit(1);
      }
      made.push([b, fill(fs.readFileSync(a, 'utf8'))]);
    }
  }
};
walk(starter, root);
for (const [f, text] of made) {
  fs.mkdirSync(path.dirname(f), {recursive: true});
  fs.writeFileSync(f, text);
}
const skill = path.resolve(HERE, '..');
console.log(`Created ${title} in ${root}\n
cd "${root}"
node --test ${name}-shared/model.test.mjs
node "${skill}/sims/build.mjs" ./${name}-live ./${name}-film
node "${skill}/scripts/smoke.mjs" teardown-out/dist/${name}-live.html --qa ${name}-shared/qa.json
node "${skill}/scripts/smoke.mjs" teardown-out/dist/${name}-film.html --timeline ${name}-film/timeline.json`);
