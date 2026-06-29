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
// --check: don't write — verify the committed dashboard.css matches the
// partials and exit 1 on drift. Catches edits made to the GENERATED file
// directly (which the next build would silently clobber). Wired into
// prebuild so a hand-edit to dashboard.css fails the build loudly.
const CHECK = process.argv.includes('--check');

const files = (await readdir(SRC_DIR))
  .filter(f => f.endsWith('.css'))
  .sort(); // numeric prefixes (000-, 005-, …) define the cascade order

const parts = await Promise.all(files.map(f => readFile(join(SRC_DIR, f), 'utf8')));
const built = parts.join('\n');

if (CHECK) {
  const current = await readFile(OUT, 'utf8').catch(() => '');
  if (current !== built) {
    console.error('face-css CHECK FAILED: public/dashboard.css is out of sync '
      + 'with control-src/face-css/*.css.\n  → Edit the partials, not the '
      + 'generated file, then run `npm run build:css`.');
    process.exit(1);
  }
  console.log(`face-css: in sync (${files.length} partials).`);
} else {
  await writeFile(OUT, built);
  console.log(`face-css: ${files.length} partials -> public/dashboard.css (${built.length} bytes)`);
}
