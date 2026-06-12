// E-ink physics lint — mechanically enforces what the panel taught us:
//
//   1. No font-size below 11px (smaller mono is unreadable on the
//      panel; 1-bit threshold shreds the glyphs).
//   2. No border/outline/stroke strokes below 2px (single-pixel lines
//      vanish on e-ink).
//   3. No colors outside pure 1-bit black/white (anything between
//      thresholds unpredictably at sharp.threshold(128): #999 borders
//      disappear, #555 text silently becomes black — the editor
//      preview lies either way).
//
// Scans the face stylesheets (control-src/face-css/*.css) and the
// widget renderers' inline styles (control-src/widgets/*.js — NOT the
// .form.jsx files, which are editor-only UI).
//
// Escape hatch: append `/* eink-lint-allow */` (CSS) or
// `// eink-lint-allow` (JS, same line) to a deliberate exception.
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = join(root, 'control-src', 'face-css');
const JS_DIR = join(root, 'control-src', 'widgets');

const MIN_FONT_PX = 11;
const MIN_STROKE_PX = 2;
const ALLOW = /eink-lint-allow/;

const problems = [];

function stripComments(css) {
  // Replace comment contents with spaces, preserving newlines so the
  // reported line numbers stay correct.
  return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

function stripDataUris(s) {
  // Dither tiles are SVG data URIs using black/white keywords — never
  // lint inside url(...).
  return s.replace(/url\([^)]*\)/g, m => m.replace(/[^\n]/g, ' '));
}

function lintChunk(text, file, lineOffset = 0, rawLines = null) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const n = lineOffset + i + 1;
    const raw = rawLines ? (rawLines[lineOffset + i] || '') : line;
    if (ALLOW.test(raw)) return;

    // 1. font-size floor
    for (const m of line.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      if (parseFloat(m[1]) < MIN_FONT_PX) {
        problems.push(`${file}:${n}  font-size ${m[1]}px < ${MIN_FONT_PX}px (unreadable on panel)`);
      }
    }
    // 2. stroke floor — border*/outline/stroke-width with a px value.
    //    `border: 0`/`none` don't match (no px).
    for (const m of line.matchAll(/(border[a-z-]*|outline|stroke-width)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      if (parseFloat(m[2]) < MIN_STROKE_PX) {
        problems.push(`${file}:${n}  ${m[1]} ${m[2]}px < ${MIN_STROKE_PX}px (vanishes on panel)`);
      }
    }
    // 3. 1-bit colors only
    for (const m of line.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
      const hex = m[1].toLowerCase();
      const ok = ['000', 'fff', '000000', 'ffffff'].includes(hex);
      if (!ok) {
        problems.push(`${file}:${n}  color #${m[1]} is not 1-bit black/white (thresholds unpredictably)`);
      }
    }
    for (const m of line.matchAll(/rgba?\(([^)]*)\)/g)) {
      const parts = m[1].split(',').map(s => parseFloat(s));
      const rgbOk = parts.slice(0, 3).every(v => v === 0 || v === 255);
      const aOk = parts.length < 4 || parts[3] === 1;
      if (!(rgbOk && aOk)) {
        problems.push(`${file}:${n}  ${m[0]} is not 1-bit (grays/opacity dither into noise)`);
      }
    }
    if (/\bopacity\s*:\s*(?!1\b|1;|1\s)/.test(line) && !/opacity\s*:\s*1$/.test(line.trim())) {
      const m = line.match(/opacity\s*:\s*([\d.]+)/);
      if (m && parseFloat(m[1]) < 1) {
        problems.push(`${file}:${n}  opacity ${m[1]} (dithers into noise at 1-bit)`);
      }
    }
  });
}

// --- CSS partials ---
for (const f of (await readdir(CSS_DIR)).filter(f => f.endsWith('.css')).sort()) {
  const raw = await readFile(join(CSS_DIR, f), 'utf8');
  lintChunk(stripDataUris(stripComments(raw)), `face-css/${f}`, 0, raw.split('\n'));
}

// --- renderer inline styles ---
for (const f of (await readdir(JS_DIR)).filter(f => f.endsWith('.js')).sort()) {
  const raw = await readFile(join(JS_DIR, f), 'utf8');
  // strip JS comments the same newline-preserving way
  const noComments = raw
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  lintChunk(stripDataUris(noComments), `widgets/${f}`, 0, raw.split('\n'));
}

if (problems.length) {
  console.error(`eink-lint: ${problems.length} violation(s)\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nIntentional? Append /* eink-lint-allow */ (CSS) or // eink-lint-allow (JS).');
  process.exit(1);
}
console.log('eink-lint: clean (1-bit colors, ≥11px type, ≥2px strokes)');
