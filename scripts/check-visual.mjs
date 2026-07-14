// Visual regression check for the e-ink face. Boots the real server
// with a deterministic config (static text + QR — no clock/weather/date
// so the pixels can't drift between runs), fetches /display.png, and
// diffs it against the committed baseline with sharp.
//
//   node scripts/check-visual.mjs           # compare, exit 1 on drift
//   node scripts/check-visual.mjs --update  # (re)write the baseline
//
// Baselines are rendered locally, so this is a local-dev guard, not CI:
// a different Chromium/font stack renders slightly different pixels.
// On failure the fresh render is left at test/visual/current.png so you
// can eyeball the two.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(root, 'test', 'visual', 'baseline-dashboard.png');
const CURRENT  = join(root, 'test', 'visual', 'current.png');
const PORT = 3798;
const UPDATE = process.argv.includes('--update');
// Fraction of pixels allowed to differ before we call it drift. Antialias
// wobble on an 800×480 1-bit-ish render stays way under this.
const THRESHOLD = 0.005;

// Deterministic screen: static strings only.
function testConfig(base) {
  return {
    ...base,
    city: 'Testville', lat: 0, lon: 0, timezone: 'UTC',
    screens: [{
      id: 'visual', name: 'Visual', isDefault: true, units: 'F', refreshMinutes: 30,
      layout: [
        { id: 'vt1', widgetId: 'text', x: 0, y: 0, w: 24, h: 2,
          settings: { variant: 'bar', text: 'VISUAL REGRESSION BASELINE', subtitle: 'static strings only', align: 'center' } },
        { id: 'vt2', widgetId: 'text', x: 0, y: 2, w: 12, h: 5,
          settings: { variant: 'card', text: 'Serif headline block', subtitle: 'The quick brown fox — 0123456789', schedule: [] } },
        { id: 'vq1', widgetId: 'qr', x: 12, y: 2, w: 12, h: 5,
          settings: { variant: 'caption', mode: 'url', data: 'https://example.com/baseline', caption: 'QR CAPTION', title: 'QR' } },
        { id: 'vt3', widgetId: 'text', x: 0, y: 7, w: 24, h: 5,
          settings: { variant: 'bar', text: 'Bottom strip — **bold** and *italic* markdown', align: 'left', upper: false } }
      ]
    }]
  };
}

async function waitForHealth(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('server did not become healthy');
}

const dataDir = await mkdtemp(join(tmpdir(), 'eink-visual-'));
const defaults = JSON.parse(await readFile(join(root, 'data-defaults', 'config.default.json'), 'utf8'));
await writeFile(join(dataDir, 'config.json'), JSON.stringify(testConfig(defaults), null, 2));

const child = spawn('node', ['server.js'], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), DEVICE_TOKEN: '', ADMIN_PIN: '' },
  stdio: 'ignore'
});

let exitCode = 0;
try {
  await waitForHealth(`http://localhost:${PORT}/health`);
  const r = await fetch(`http://localhost:${PORT}/display.png`, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`display.png ${r.status}`);
  const png = Buffer.from(await r.arrayBuffer());

  await mkdir(dirname(BASELINE), { recursive: true });
  if (UPDATE || !existsSync(BASELINE)) {
    await writeFile(BASELINE, png);
    console.log(`check-visual: baseline ${UPDATE ? 'updated' : 'created'} (${png.length} bytes) at test/visual/baseline-dashboard.png`);
  } else {
    const { default: sharp } = await import('sharp');
    const a = await sharp(BASELINE).raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
      throw new Error(`size drift: baseline ${a.info.width}×${a.info.height} vs current ${b.info.width}×${b.info.height}`);
    }
    let diff = 0;
    const ch = a.info.channels;
    for (let i = 0; i < a.data.length; i += ch) {
      if (a.data[i] !== b.data[i]) diff++;
    }
    const total = a.info.width * a.info.height;
    const frac = diff / total;
    if (frac > THRESHOLD) {
      await writeFile(CURRENT, png);
      console.error(`check-visual FAILED: ${(frac * 100).toFixed(2)}% of pixels differ (allowed ${(THRESHOLD * 100).toFixed(2)}%).`);
      console.error('  fresh render written to test/visual/current.png — compare against the baseline,');
      console.error('  then either fix the regression or rerun with --update if the change is intended.');
      exitCode = 1;
    } else {
      console.log(`check-visual: OK (${(frac * 100).toFixed(3)}% pixel drift, allowed ${(THRESHOLD * 100).toFixed(2)}%)`);
    }
  }
} catch (err) {
  console.error('check-visual error:', err.message);
  exitCode = 1;
} finally {
  // Wait for the server (and its Puppeteer child) to actually release
  // the port before cleaning up — otherwise back-to-back runs race a
  // zombie still bound to PORT whose DATA_DIR we just deleted.
  const exited = new Promise(r => child.once('exit', r));
  child.kill();
  await Promise.race([exited, new Promise(r => setTimeout(r, 4000))]);
  if (child.exitCode == null) {
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise(r => setTimeout(r, 2000))]);
  }
  await rm(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);
