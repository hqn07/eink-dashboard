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

// D4: a schema form's FIELDS must agree with the widget's defaults().
//
// This is the check a hand-written form could never offer. A field whose key
// is not in defaults() writes a setting the renderer never reads (dead); a
// default that no field exposes is a setting nobody can reach except by
// editing config.json (unreachable). Both survive review easily and both have
// shipped here before.
//
// Static analysis, like the rest of this script: FIELDS entries are read as
// `key: 'name'` pairs out of the source, and defaults() keys the same way, so
// no JSX loader or browser is needed. A form with no FIELDS export is a
// hand-written one and is skipped — schema forms are opt-in per widget.
{
  const KEYS_FROM_FIELDS = /\bkey:\s*'([A-Za-z0-9_]+)'/g;
  // Keys every tile carries that no widget form owns: the variant picker is
  // modal chrome, and the rest are per-tile chrome handled outside the form.
  const CHROME = new Set(['variant', 'theme', 'zone', 'frame', 'accent', 'fontFamily',
    'fontScale', 'scaleAnchor', 'padding', 'bold', 'italic', 'upper', 'letterSpacing',
    'semanticRed']);

  for (const id of widgetIds) {
    let form;
    try { form = await readFile(join(WDIR, `${id}.form.jsx`), 'utf8'); } catch { continue; }
    if (!/export const FIELDS\s*=/.test(form)) continue;   // hand-written form

    const fieldKeys = new Set(
      [...form.replace(/\/\/[^\n]*/g, '').matchAll(KEYS_FROM_FIELDS)].map(m => m[1]));
    const src = await readFile(join(WDIR, `${id}.js`), 'utf8');
    const block = src.match(/defaults:\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)/);
    if (!block) {
      problems.push(`${id}: has a FIELDS schema but no defaults() the guard can read`);
      continue;
    }
    // Comments first: `// YYYY-MM-DDTHH:MM` and `// 'wifi' = build WIFI: payload`
    // both look exactly like a key to a naive scan, and both produced a false
    // failure the first time this ran.
    const body = block[1].replace(/\/\/[^\n]*/g, '');
    const defaultKeys = new Set(
      [...body.matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)].map(m => m[1]));

    // Well-formedness: a typo in `type` renders nothing at all, silently —
    // the schema's one failure mode that is worse than the JSX it replaced,
    // because a missing field looks like a deliberate omission.
    const TYPES = new Set(['text', 'select', 'segmented', 'toggle', 'slider', 'csv', 'list', 'location']);
    for (const m of form.matchAll(/type:\s*'([A-Za-z0-9_]+)'/g)) {
      if (!TYPES.has(m[1])) {
        problems.push(`${id}.form.jsx: field type '${m[1]}' has no renderer in _schema.jsx`);
      }
    }

    for (const k of fieldKeys) {
      if (!defaultKeys.has(k) && !CHROME.has(k)) {
        problems.push(`${id}.form.jsx: field '${k}' is not in ${id}.js defaults() — `
          + 'the renderer never reads it');
      }
    }
    for (const k of defaultKeys) {
      if (!fieldKeys.has(k) && !CHROME.has(k)) {
        problems.push(`${id}.js: default '${k}' is not exposed by ${id}.form.jsx — `
          + 'unreachable without hand-editing config.json');
      }
    }
  }
}

if (problems.length) {
  console.error('check-widgets FAILED:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`check-widgets: ${widgetIds.length} widgets wired (render + form + registry + palette); token registry + home helper in sync.`);
