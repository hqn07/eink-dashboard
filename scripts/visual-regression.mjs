// Visual-regression snapshot of /widgets-matrix?demo=1 — every widget at
// every preset size and variant. Catches layout drift in any widget
// (the thing we hand-screenshotted on every W2/W3 batch) before it
// reaches the panel.
//
// Deterministic by construction: `?demo=1` makes the server render from
// frozen demo data (no live weather/clock), so the only variation is
// Chrome's own glyph rasterization — handled by a small pixel-diff
// tolerance. Uses sharp (already a dep) for decode + diff; no new deps,
// no test framework.
//
//   node scripts/visual-regression.mjs           # compare vs baseline
//   node scripts/visual-regression.mjs --update   # (re)write the baseline
//
// Exit 0 = match (or baseline written); exit 1 = drift (writes a diff
// PNG next to the baseline for inspection).

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_DIR = join(ROOT, 'test', 'visual-baseline');

const PORT = process.env.VR_PORT || 3970;
const TOKEN = process.env.DEVICE_TOKEN || '';
const UPDATE = process.argv.includes('--update');
// Fraction of differing pixels tolerated before we call it a regression.
// On the same machine + Chrome the render is byte-identical (0 px), so
// this only absorbs cross-version AA jitter. Real layout drift moves
// thousands of px; even a single spacing-token nudge tripped ~0.1%.
// 0.05% catches that while leaving headroom. NOTE: the baseline is
// machine-specific — regenerate with `--update` on yours.
const THRESHOLD = Number(process.env.VR_THRESHOLD || 0.0005);
// Per-channel delta below which two pixels are "the same" (AA softness).
const PIXEL_TOL = 24;

function log(...a) { console.log('[visual-regression]', ...a); }

async function exists(p) { try { await access(p); return true; } catch { return false; } }

// Track the spawned server so it dies with this script no matter how the
// script exits — a killed/timed-out harness run used to orphan the server,
// which then held the port and made every later run fail with EADDRINUSE.
let _serverChild = null;
for (const sig of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (_serverChild) { try { _serverChild.kill('SIGKILL'); } catch { /* gone */ } }
    if (sig !== 'exit') process.exit(1);
  });
}

// Deterministic screen for the editor capture: static strings only, and
// a location set so the setup wizard doesn't auto-open over the canvas.
// The matrix capture renders from ?demo=1 and ignores the config either
// way — a temp DATA_DIR keeps both shots independent of the user's real
// config.
async function seedDataDir() {
  const dir = await mkdtemp(join(tmpdir(), 'eink-vr-'));
  const base = JSON.parse(await readFile(join(ROOT, 'data-defaults', 'config.default.json'), 'utf8'));
  const cfg = {
    ...base,
    // Nonzero coords — the first-run wizard treats lat/lon 0 as unset
    // and would auto-open over the canvas.
    city: 'Testville', lat: 40.7, lon: -74.0, timezone: 'UTC',
    screens: [{
      id: 'vr', name: 'VR', isDefault: true, units: 'F', refreshMinutes: 30,
      layout: [
        { id: 'vr1', widgetId: 'text', x: 0, y: 0, w: 24, h: 2,
          settings: { variant: 'bar', text: 'EDITOR SNAPSHOT', align: 'center' } },
        { id: 'vr2', widgetId: 'qr', x: 0, y: 2, w: 12, h: 6,
          settings: { variant: 'caption', mode: 'url', data: 'https://example.com', caption: 'STATIC', title: 'QR' } }
      ]
    }]
  };
  await writeFile(join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
  return dir;
}

function startServer(dataDir) {
  const env = {
    ...process.env, PORT: String(PORT), NODE_ENV: 'test',
    DATA_DIR: dataDir, DEVICE_TOKEN: '', ADMIN_PIN: ''
  };
  const child = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  _serverChild = child;
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('server did not start in 30s'));
    }, 30000);
    child.stdout.on('data', (b) => {
      if (b.toString().includes('listening')) { clearTimeout(to); resolve(child); }
    });
    child.stderr.on('data', (b) => process.stderr.write(b));
    child.on('exit', (c) => { clearTimeout(to); _serverChild = null; reject(new Error(`server exited early (${c})`)); });
  });
}

async function shootMatrix(browser) {
  const url = `http://localhost:${PORT}/widgets-matrix?demo=1${TOKEN ? `&token=${TOKEN}` : ''}`;
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1 });
    const resp = await page.goto(url, { waitUntil: 'networkidle0' });
    if (!resp || resp.status() !== 200) throw new Error(`matrix HTTP ${resp && resp.status()}`);
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 500));
    return await page.screenshot({ fullPage: true });
  } finally {
    await page.close();
  }
}

// Editor (/control-app) capture. Animations/transitions killed by CSS so
// framer-motion entrance states can't smear the shot; caret hidden for
// the same reason. Viewport-only (fullPage on the editor measures a
// scroll container mid-layout and jitters).
async function shootEditor(browser) {
  const url = `http://localhost:${PORT}/control-app/`;
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const resp = await page.goto(url, { waitUntil: 'networkidle0' });
    if (!resp || ![200, 304].includes(resp.status())) throw new Error(`editor HTTP ${resp && resp.status()}`);
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
    await page.evaluate(() => document.fonts.ready);
    // Let the preview-data fetch land and the canvas settle.
    await new Promise(r => setTimeout(r, 1500));
    return await page.screenshot();
  } finally {
    await page.close();
  }
}

// Returns { diffPixels, total, diffPng } comparing two PNG buffers at the
// raw-pixel level via sharp. Mismatched dimensions = total failure.
async function diff(aBuf, bBuf) {
  const a = sharp(aBuf).ensureAlpha().raw();
  const b = sharp(bBuf).ensureAlpha().raw();
  const [{ data: da, info: ia }, { data: db, info: ib }] = await Promise.all([
    a.toBuffer({ resolveWithObject: true }),
    b.toBuffer({ resolveWithObject: true })
  ]);
  if (ia.width !== ib.width || ia.height !== ib.height) {
    return { sizeMismatch: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
  }
  const { width, height, channels } = ia;
  const out = Buffer.alloc(da.length, 0);
  let diffPixels = 0;
  for (let i = 0; i < da.length; i += channels) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(da[i + c] - db[i + c]));
    if (d > PIXEL_TOL) {
      diffPixels++;
      out[i] = 255; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 255;
    } else {
      out[i] = da[i]; out[i + 1] = da[i + 1]; out[i + 2] = da[i + 2]; out[i + 3] = 255;
    }
  }
  const diffPng = await sharp(out, { raw: { width, height, channels } }).png().toBuffer();
  return { diffPixels, total: width * height, diffPng };
}

// Editor threshold is looser: a full app viewport has far more AA text
// than the face matrix, and React hydration order can wiggle a few px.
const SHOTS = [
  { name: 'widgets-matrix', fn: shootMatrix, threshold: THRESHOLD },
  { name: 'editor',         fn: shootEditor, threshold: Number(process.env.VR_EDITOR_THRESHOLD || 0.002) },
];

async function main() {
  await mkdir(BASELINE_DIR, { recursive: true });
  let server;
  let dataDir;
  let failed = false;
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    dataDir = await seedDataDir();
    server = await startServer(dataDir);
    log(`server up on :${PORT}`);
    for (const shotDef of SHOTS) {
      log(`capturing ${shotDef.name}…`);
      const shot = await shotDef.fn(browser);
      const baselinePath = join(BASELINE_DIR, `${shotDef.name}.png`);
      const diffPath = join(BASELINE_DIR, `${shotDef.name}.diff.png`);

      if (UPDATE || !(await exists(baselinePath))) {
        await writeFile(baselinePath, shot);
        log(`${shotDef.name}: baseline ${UPDATE ? 'updated' : 'created'}.`);
        continue;
      }

      const base = await readFile(baselinePath);
      const r = await diff(base, shot);
      if (r.sizeMismatch) {
        log(`${shotDef.name}: FAIL — dimensions changed (${r.sizeMismatch}). Run with --update if intentional.`);
        await writeFile(diffPath, shot);
        failed = true;
        continue;
      }
      const frac = r.diffPixels / r.total;
      log(`${shotDef.name}: diff ${r.diffPixels}/${r.total} px (${(frac * 100).toFixed(4)}%), threshold ${(shotDef.threshold * 100).toFixed(4)}%`);
      if (frac > shotDef.threshold) {
        await writeFile(diffPath, r.diffPng);
        log(`${shotDef.name}: FAIL — drift exceeds threshold. Diff written to ${diffPath}. If intentional, re-run with --update.`);
        failed = true;
      } else {
        log(`${shotDef.name}: PASS.`);
      }
    }
    return failed ? 1 : 0;
  } finally {
    await browser.close();
    if (server) server.kill('SIGTERM');
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('[visual-regression] error:', e.message);
  process.exit(2);
});
