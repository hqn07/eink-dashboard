// Widget wiring invariants — the cheap, zero-flake guard for the bugs
// that keep recurring: a widget that renders server-side but is missing
// from the editor palette (the QR miss), or a widget/form/registry set
// that drifted out of sync.
//
// Pure static analysis of source text so it needs no JSX loader, no
// browser, no server — safe to run in prebuild and CI.
//
//   node scripts/check-widgets.mjs
//
// Exit 0 = all wired; exit 1 = a gap, printed with the fix.
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WDIR = join(root, 'control-src', 'widgets');

const entries = await readdir(WDIR);
// Widget render modules: <id>.js, excluding _-prefixed shared helpers.
const widgetIds = entries
  .filter(f => f.endsWith('.js') && !f.startsWith('_'))
  .map(f => f.replace(/\.js$/, ''))
  .sort();
const formIds = new Set(entries
  .filter(f => f.endsWith('.form.jsx'))
  .map(f => f.replace(/\.form\.jsx$/, '')));

const registrySrc = await readFile(join(WDIR, '_registry.js'), 'utf8');
const paletteSrc = await readFile(join(root, 'control-src', 'widgets.js'), 'utf8');
// _ssr.js is the SERVER render path (the panel). A widget missing here
// renders in the editor but shows NO_WIDGETS_ENABLED / blank on the
// e-ink — kept as its own hardcoded list so JSX never enters Node's graph.
const ssrSrc = await readFile(join(WDIR, '_ssr.js'), 'utf8');
const ssrModules = (ssrSrc.match(/const MODULES\s*=\s*\[([\s\S]*?)\];/) || [])[1] || '';
const ssrImports = new Set(
  [...ssrSrc.matchAll(/import \* as ([a-z0-9_]+)\s+from/g)].map(m => m[1])
    .filter(id => new RegExp(`\\b${id}\\b`).test(ssrModules)));

// `import * as <name> from './<id>.js'` → collect the <id>s in MODULES.
const registryImports = new Set(
  [...registrySrc.matchAll(/from\s+'\.\/([a-z0-9_]+)\.js'/g)].map(m => m[1]));
// FORMS map keys (and `<id>: ...Form`) — pull keys from the FORMS object.
const formsBlock = (registrySrc.match(/const FORMS\s*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';
const registryForms = new Set(
  [...formsBlock.matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map(m => m[1]));
// Editor palette: migratedDef('<id>') entries in WIDGET_REGISTRY.
const palette = new Set(
  [...paletteSrc.matchAll(/migratedDef\('([a-z0-9_]+)'\)/g)].map(m => m[1]));

const problems = [];
for (const id of widgetIds) {
  if (!formIds.has(id)) problems.push(`${id}: missing ${id}.form.jsx`);
  if (!registryImports.has(id)) problems.push(`${id}: not imported in _registry.js MODULES`);
  if (!registryForms.has(id)) problems.push(`${id}: missing from _registry.js FORMS map`);
  if (!palette.has(id)) problems.push(`${id}: missing from WIDGET_REGISTRY (editor palette) in widgets.js — renders server-side but never shows in the add-widget pool`);
  if (!ssrImports.has(id)) problems.push(`${id}: missing from _ssr.js MODULES — renders in the editor but blank on the e-ink panel`);
}
// Palette entries that point at a non-existent widget.
for (const id of palette) {
  if (!widgetIds.includes(id)) problems.push(`palette has '${id}' but control-src/widgets/${id}.js does not exist`);
}

// Token registry parity: widgets/_tokens.js (CJS, server) and
// control-src/widgets/_tokens.js (ESM, editor + buildTileCtx) are
// hand-mirrored — compare TOKEN_META and RESOLVABLE_KEYS so a token
// added on one side can't silently miss the other.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const server = require(join(root, 'widgets', '_tokens.js'));
  const client = await import(join(WDIR, '_tokens.js'));
  const metaSig = (meta) => (meta || []).map(t => `${t.name}(${(t.formats || []).join(',')})`).join(' ');
  if (metaSig(server.TOKEN_META) !== metaSig(client.TOKEN_META)) {
    problems.push(`TOKEN_META drift between widgets/_tokens.js and control-src/widgets/_tokens.js:\n      server: ${metaSig(server.TOKEN_META)}\n      client: ${metaSig(client.TOKEN_META)}`);
  }
  if ((server.RESOLVABLE_KEYS || []).join(',') !== (client.RESOLVABLE_KEYS || []).join(',')) {
    problems.push('RESOLVABLE_KEYS drift between widgets/_tokens.js and control-src/widgets/_tokens.js');
  }
}

// Home-facts helper parity: lib/home.js (CJS) and control-src/home.js (ESM)
// are hand-mirrored. Compared by BEHAVIOUR rather than by source text — what
// matters is that the server and the editor agree on where the user lives,
// and a textual compare would both miss a real divergence in a rewritten
// branch and cry over a reformat.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const s = require(join(root, 'lib', 'home.js'));
  const c = await import(join(root, 'control-src', 'home.js'));
  const emptyHome = { city: '', lat: null, lon: null, icalUrls: [], githubUser: '', about: '' };
  const fixtures = [
    {},
    { city: 'Legacy,FL,US', lat: 29.65, lon: -82.32, githubUser: 'x', home: emptyHome },
    { home: { city: 'New,VN', lat: 10.77, lon: 106.7, about: 'hi', icalUrls: ['u'] } },
    { city: 'OLD', home: { city: 'NEW' } },
    { home: { lat: 29.65, lon: null } },
    { timezone: 'America/New_York', home: { timezone: 'Asia/Ho_Chi_Minh' } },
  ];
  const sig = (m) => JSON.stringify(fixtures.map(f => [
    ...m.HOME_KEYS.map(k => m.homeValue(f, k) ?? null),
    m.homeCoords(f), m.homeLoc(f)
  ]));
  if ((s.HOME_KEYS || []).join(',') !== (c.HOME_KEYS || []).join(',')) {
    problems.push('HOME_KEYS drift between lib/home.js and control-src/home.js');
  } else if (sig(s) !== sig(c)) {
    problems.push(`lib/home.js and control-src/home.js disagree:\n      server: ${sig(s)}\n      client: ${sig(c)}`);
  }
}

if (problems.length) {
  console.error('check-widgets FAILED:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`check-widgets: ${widgetIds.length} widgets wired (render + form + registry + palette); token registry + home helper in sync.`);
