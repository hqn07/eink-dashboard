// Concatenates control-src/face-css/*.css (numeric-prefix order) into
// public/dashboard.css — the single stylesheet served to the dashboard
// SSR page AND loaded inside the control app for widget-style reuse.
//
// public/dashboard.css is a GENERATED FILE. Edit the partials, run
// `npm run build:css` (also runs automatically via prebuild/prestart).
// The file stays committed so `node server.js` works without a build
// step; CI (nixpacks build phase) regenerates it on deploy so a stale
// commit can't ship.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(root, 'control-src', 'face-css');
const OUT = join(root, 'public', 'dashboard.css');

const files = (await readdir(SRC_DIR))
  .filter(f => f.endsWith('.css'))
  .sort(); // numeric prefixes (000-, 005-, …) define the cascade order

const parts = await Promise.all(files.map(f => readFile(join(SRC_DIR, f), 'utf8')));
await writeFile(OUT, parts.join('\n'));
console.log(`face-css: ${files.length} partials -> public/dashboard.css (${parts.join('\n').length} bytes)`);
