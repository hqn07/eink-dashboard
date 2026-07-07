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
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_DIR = join(ROOT, 'test', 'visual-baseline');
const BASELINE = join(BASELINE_DIR, 'widgets-matrix.png');
const DIFF_OUT = join(BASELINE_DIR, 'widgets-matrix.diff.png');

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

function startServer() {
  const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'test' };
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

async function shoot() {
  const url = `http://localhost:${PORT}/widgets-matrix?demo=1${TOKEN ? `&token=${TOKEN}` : ''}`;
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1 });
    const resp = await page.goto(url, { waitUntil: 'networkidle0' });
    if (!resp || resp.status() !== 200) throw new Error(`matrix HTTP ${resp && resp.status()}`);
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 500));
    return await page.screenshot({ fullPage: true });
  } finally {
    await browser.close();
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

async function main() {
  await mkdir(BASELINE_DIR, { recursive: true });
  let server;
  try {
    server = await startServer();
    log(`server up on :${PORT}, capturing matrix…`);
    const shot = await shoot();

    if (UPDATE || !(await exists(BASELINE))) {
      await writeFile(BASELINE, shot);
      log(UPDATE ? 'baseline updated.' : 'no baseline found — wrote initial baseline.');
      return 0;
    }

    const base = await readFile(BASELINE);
    const r = await diff(base, shot);
    if (r.sizeMismatch) {
      log(`FAIL — dimensions changed (${r.sizeMismatch}). Run with --update if intentional.`);
      await writeFile(DIFF_OUT, shot);
      return 1;
    }
    const frac = r.diffPixels / r.total;
    log(`diff ${r.diffPixels}/${r.total} px (${(frac * 100).toFixed(4)}%), threshold ${(THRESHOLD * 100).toFixed(4)}%`);
    if (frac > THRESHOLD) {
      await writeFile(DIFF_OUT, r.diffPng);
      log(`FAIL — drift exceeds threshold. Diff written to ${DIFF_OUT}. If intentional, re-run with --update.`);
      return 1;
    }
    log('PASS — no significant drift.');
    return 0;
  } finally {
    if (server) server.kill('SIGTERM');
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('[visual-regression] error:', e.message);
  process.exit(2);
});
