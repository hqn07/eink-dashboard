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
}
// Palette entries that point at a non-existent widget.
for (const id of palette) {
  if (!widgetIds.includes(id)) problems.push(`palette has '${id}' but control-src/widgets/${id}.js does not exist`);
}

if (problems.length) {
  console.error('check-widgets FAILED:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`check-widgets: ${widgetIds.length} widgets wired (render + form + registry + palette).`);
