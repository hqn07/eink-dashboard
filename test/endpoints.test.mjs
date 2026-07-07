// Endpoint/integration tests for the server. Boots a real server instance
// against a throwaway DATA_DIR (seeded from data-defaults) with a known
// DEVICE_TOKEN, then exercises the critical routes over HTTP via fetch.
//
// Zero new deps: node:test + global fetch. Rendering routes (/display.*)
// spin up Puppeteer, so this is slower than the lint guards — run it as
// `npm run test:api`, not on every build.
//
// Usage: node --test test/endpoints.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-token-abc';
let proc, dataDir;

const url = (p) => `${BASE}${p}`;
const tok = (p) => url(p + (p.includes('?') ? '&' : '?') + 'token=' + TOKEN);

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'eink-test-'));
  proc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir,
      DEVICE_TOKEN: TOKEN, PRERENDER: '0', NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  // Wait for /health to come up (server seeds config on first run).
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const r = await fetch(url('/health'));
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server did not start');
    await new Promise(r => setTimeout(r, 250));
  }
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (dataDir) { try { rmSync(dataDir, { recursive: true, force: true }); } catch {} }
});

test('GET /health → ok', async () => {
  const r = await fetch(url('/health'));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('device endpoints require the token', async () => {
  assert.equal((await fetch(url('/display.bin'))).status, 401);
  assert.equal((await fetch(url('/sleep'))).status, 401);
});

test('GET /sleep → minutes + seconds', async () => {
  const r = await fetch(tok('/sleep'));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Number.isFinite(j.minutes) && j.minutes >= 1);
  assert.equal(j.seconds, j.minutes * 60);
});

test('GET /display.bin → 48000 bytes + refresh headers', async () => {
  const r = await fetch(tok('/display.bin'));
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('x-refresh-rate'));
  assert.ok(r.headers.get('x-refresh-seconds'));
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.length, 48000);
});

test('battery-aware refresh: low battery stretches the interval', async () => {
  const r = await fetch(tok('/display.bin'), { headers: { 'Battery-Voltage': '3.4', 'Battery-Pct': '5' } });
  assert.equal(r.status, 200);
  // <10% floor is 240 min (unless config base is already higher).
  assert.ok(Number(r.headers.get('x-refresh-rate')) >= 240);
});

test('POST /api/config rejects a non-object body', async () => {
  const r = await fetch(tok('/api/config'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify('not-an-object'),
  });
  assert.equal(r.status, 400);
});

test('POST /api/config rejects non-array screens', async () => {
  const r = await fetch(tok('/api/config'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ screens: { nope: true } }),
  });
  assert.equal(r.status, 400);
});

test('POST /api/config merges a valid patch', async () => {
  const r = await fetch(tok('/api/config'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timezone: 'UTC' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.config.timezone, 'UTC');
});

// Runs BEFORE the push-now test below: a fast window (push-now) outranks
// quiet hours, so asserting quiet here keeps it independent of that state.
test('quiet hours stretches sleep to the window end', async () => {
  // Set a window that always covers "now" in UTC.
  await fetch(tok('/api/config'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timezone: 'UTC', quietHours: { enabled: true, from: '00:00', to: '23:59' } }),
  });
  const s = await (await fetch(tok('/sleep'))).json();
  assert.equal(s.fast, false);
  assert.equal(s.quiet, true);
  assert.ok(s.minutes > 1);
  // disable again so later tests see a normal interval
  await fetch(tok('/api/config'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quietHours: { enabled: false, from: '00:00', to: '23:59' } }),
  });
});

test('push-now opens a fast-refresh window', async () => {
  const w = await fetch(tok('/api/wake'), { method: 'POST' });
  assert.equal(w.status, 200);
  assert.equal((await w.json()).ok, true);
  const s = await (await fetch(tok('/sleep'))).json();
  assert.equal(s.fast, true);
  assert.ok(s.seconds <= 60);
});

test('/api/setup is gated by the token; enroll + delete roundtrip', async () => {
  const mac = 'aa:bb:cc:dd:ee:01';
  // No token → 401
  const bad = await fetch(url('/api/setup'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mac, board: 'b', fw_version: '1.15.0' }),
  });
  assert.equal(bad.status, 401);
  // With token → 200 + api_key + friendly_id
  const ok = await fetch(tok('/api/setup'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mac, board: 'b', fw_version: '1.15.0' }),
  });
  assert.equal(ok.status, 200);
  const dev = await ok.json();
  assert.ok(dev.api_key && dev.friendly_id);
  // Delete by friendly_id → 200, second delete → 404
  const d1 = await fetch(tok('/api/device/' + dev.friendly_id), { method: 'DELETE' });
  assert.equal(d1.status, 200);
  const d2 = await fetch(tok('/api/device/' + dev.friendly_id), { method: 'DELETE' });
  assert.equal(d2.status, 404);
});

test('POST /api/battery validates input', async () => {
  const bad = await fetch(tok('/api/battery'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ v: 99, pct: 50 }),
  });
  assert.equal(bad.status, 400);
  const good = await fetch(tok('/api/battery'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ v: 3.9, pct: 77 }),
  });
  assert.equal(good.status, 200);
});

test('device log: POST /api/log + admin read-back', async () => {
  const noMsg = await fetch(tok('/api/log'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'error' }),
  });
  assert.equal(noMsg.status, 400);
  const ok = await fetch(tok('/api/log'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'error', msg: 'Could not fetch image (x3)', code: -11 }),
  });
  assert.equal(ok.status, 200);
  const r = await fetch(tok('/api/logs'));
  assert.equal(r.status, 200);
  const { logs } = await r.json();
  assert.ok(logs.length >= 1);
  assert.equal(logs[0].msg, 'Could not fetch image (x3)');
  assert.equal(logs[0].code, -11);
  assert.equal(logs[0].level, 'error');
});

test('per-device screen assignment roundtrip', async () => {
  const mac = 'aa:bb:cc:dd:ee:02';
  const enroll = await fetch(tok('/api/setup'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mac, board: 'b', fw_version: '1.20.0' }),
  });
  const dev = await enroll.json();
  // Assign a screen by friendly_id
  const set = await fetch(tok('/api/device/' + dev.friendly_id), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ screen: 'screen-2' }),
  });
  assert.equal(set.status, 200);
  assert.equal((await set.json()).screen, 'screen-2');
  // Roster shows it
  const roster = await (await fetch(tok('/api/devices'))).json();
  const row = roster.devices.find(d => d.mac === mac);
  assert.equal(row.screen, 'screen-2');
  // Clear it
  const clear = await fetch(tok('/api/device/' + dev.friendly_id), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ screen: null }),
  });
  assert.equal((await clear.json()).screen, null);
  // Missing body key → 400
  const bad = await fetch(tok('/api/device/' + dev.friendly_id), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(bad.status, 400);
  await fetch(tok('/api/device/' + dev.friendly_id), { method: 'DELETE' });
});

test('webhook: validation + store + read-back', async () => {
  // Bad key (illegal chars) → 400
  const badKey = await fetch(tok('/api/webhook/no%20spaces'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(badKey.status, 400);
  // Array body → 400
  const badBody = await fetch(tok('/api/webhook/steps'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify([1, 2, 3]),
  });
  assert.equal(badBody.status, 400);
  // Valid → 200, admin read-back returns the payload
  const ok = await fetch(tok('/api/webhook/steps'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps: 8432, goal: 10000 }),
  });
  assert.equal(ok.status, 200);
  const back = await (await fetch(tok('/api/webhook/steps'))).json();
  assert.equal(back.data.steps, 8432);
  assert.ok(back.at > 0);
  // Re-POST of the identical payload reports changed:false (no re-render)
  const dup = await fetch(tok('/api/webhook/steps'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps: 8432, goal: 10000 }),
  });
  assert.equal((await dup.json()).changed, false);
  // A different payload flips it back
  const diff = await fetch(tok('/api/webhook/steps'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps: 9000, goal: 10000 }),
  });
  assert.equal((await diff.json()).changed, true);
  // Unknown key → 404
  assert.equal((await fetch(tok('/api/webhook/nothing'))).status, 404);
});
