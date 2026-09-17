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

test('stale api_key gets flagged for re-enrollment', async () => {
  // Bogus key + valid fleet token → request succeeds but carries the
  // stale-enrollment flag (firmware >=1.20.1/1.14.1 clears NVS on it).
  const r = await fetch(tok('/sleep'), { headers: { 'x-api-key': 'not-a-real-key' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-enroll-stale'), '1');
  // A properly enrolled key does NOT get the flag.
  const mac = 'aa:bb:cc:dd:ee:03';
  const dev = await (await fetch(tok('/api/setup'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mac, board: 'b', fw_version: '1.20.1' }),
  })).json();
  const ok = await fetch(url('/sleep'), { headers: { 'x-api-key': dev.api_key } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('x-enroll-stale'), null);
  await fetch(tok('/api/device/' + dev.friendly_id), { method: 'DELETE' });
});

// --- Config migration v8: three market widgets become one ------------------
//
// v7 dropped tiles; this one CONVERTS them, so the assertion that matters is
// that nothing the user configured is lost — symbols, heading, and the tile's
// place on the grid all have to survive. A migration that quietly emptied a
// tile would look like a working merge right up until the panel redrew.
test('config migration v8 converts stocks/crypto/fx into markets', async () => {
  const { migrateConfigToScreens } = await import('../lib/screens.js');
  const mk = (widgetId, settings) => ({
    gridVersion: 7, firstRunSeeded: true,
    screens: [{ id: 'x', isDefault: true, layoutKind: 'free',
      layout: [{ id: 't', widgetId, x: 3, y: 4, w: 8, h: 5, settings }] }],
  });
  const out = (widgetId, settings) => migrateConfigToScreens(mk(widgetId, settings)).screens[0].layout[0];

  const st = out('stocks', { symbols: ['AAPL', 'VOO'], title: 'MY MONEY', variant: 'trmnl' });
  assert.equal(st.widgetId, 'markets');
  assert.deepEqual(st.settings.symbols, ['AAPL', 'VOO']);
  assert.equal(st.settings.title, 'MY MONEY', 'a custom heading must survive the merge');
  assert.deepEqual([st.x, st.y, st.w, st.h], [3, 4, 8, 5], 'the tile must not move');

  // CoinGecko ids carry over verbatim — markets.js classifies a known id as
  // crypto, so the tile resolves to the same coins it did before.
  const cr = out('crypto', { coins: ['bitcoin', 'ethereum'], vs: 'eur' });
  assert.equal(cr.widgetId, 'markets');
  assert.deepEqual(cr.settings.symbols, ['bitcoin', 'ethereum']);
  assert.equal(cr.settings.vs, 'eur', 'the quote currency must survive');

  // A base + targets list becomes explicit pairs.
  const fx = out('fx', { base: 'USD', targets: ['EUR', 'GBP'] });
  assert.equal(fx.widgetId, 'markets');
  assert.deepEqual(fx.settings.symbols, ['USD/EUR', 'USD/GBP']);

  // The old keys must not linger: markets reads `symbols`, and a stale
  // `coins`/`targets` would be dead weight that a later reader could mistake
  // for intent.
  for (const t of [st, cr, fx]) {
    for (const dead of ['coins', 'base', 'targets']) {
      assert.ok(!(dead in t.settings), `${dead} should not survive into markets`);
    }
  }

  // Untouched widgets stay untouched.
  const other = out('clock', { format: '12h' });
  assert.equal(other.widgetId, 'clock');
});

// --- Connections: the key must never reach the exportable config ---------
//
// The entire reason this store exists is that Backup > EXPORT serialises the
// config, so a key living in the config travels in a file people email. That
// makes "the value never appears in /api/config" the assertion worth owning:
// it fails the moment someone "helpfully" merges secrets into the config for
// convenience.
const SENTINEL = 'sk-test-DO-NOT-EXPORT-4242';

test('connections: key is stored, masked on read, and absent from the config', async () => {
  const set = await fetch(tok('/api/connections'), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aiApiKey: SENTINEL }),
  });
  assert.equal(set.status, 200);
  const setBody = await set.json();
  // The write echoes a description, not the value.
  assert.equal(JSON.stringify(setBody).includes(SENTINEL), false,
    'PATCH response must not echo the key');
  assert.equal(setBody.secrets.aiApiKey.configured, true);
  assert.equal(setBody.secrets.aiApiKey.source, 'stored');
  assert.equal(setBody.secrets.aiApiKey.hint, '…4242');

  // The read is presence + mask only.
  const read = await fetch(tok('/api/connections'));
  assert.equal(read.status, 200);
  const readText = await read.text();
  assert.equal(readText.includes(SENTINEL), false, 'GET must not return the key');

  // The payload Backup > Export serialises.
  const cfg = await fetch(tok('/api/config'));
  const cfgText = await cfg.text();
  assert.equal(cfgText.includes(SENTINEL), false,
    'the key must not be reachable through /api/config — that is what gets exported');

  // Clearing removes the stored value (and falls back to the env var, which
  // is unset in the test environment).
  const cleared = await fetch(tok('/api/connections'), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aiApiKey: null }),
  });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).secrets.aiApiKey.configured, false);
});

test('connections: rejects unknown fields and oversized values', async () => {
  const unknown = await fetch(tok('/api/connections'), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sshKey: 'nope' }),
  });
  assert.equal(unknown.status, 400);

  const huge = await fetch(tok('/api/connections'), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aiApiKey: 'A'.repeat(600) }),
  });
  assert.equal(huge.status, 400);
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

// --- Device binaries must be identity-encoded, never chunked ---------------
//
// Regression guard for a fleet-wide display corruption. The firmware reads
// http.getStreamPtr() — the raw socket — which does not strip HTTP chunk
// framing. When the route answered with res.end(bin) and no Content-Length,
// Node fell back to Transfer-Encoding: chunked and prefixed the body with
// "17700\r\n" (the hex size of 96000). Those 7 bytes were read as pixels, so
// every image landed 56px sideways, with another ~64px step at each further
// chunk boundary. It read exactly like a panel hardware fault.
//
// Uses its own server with CALIB_3C=raw so the assertion covers the framing
// without dragging Puppeteer (and a Chrome install) into it, and a raw socket
// because fetch() hides transfer framing.
test('device binaries send Content-Length and are not chunked', async () => {
  const { createConnection } = await import('node:net');
  const P = PORT + 1;
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(P), DATA_DIR: dataDir, DEVICE_TOKEN: TOKEN,
      PRERENDER: '0', CALIB_3C: 'raw', NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${P}/health`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error('calib server did not start');
      await new Promise((r) => setTimeout(r, 200));
    }
    const raw = await new Promise((resolve, reject) => {
      const parts = [];
      const sock = createConnection(P, '127.0.0.1', () => {
        sock.write(`GET /display-3c.bin HTTP/1.1\r\nHost: localhost\r\n`
          + `X-Device-Token: ${TOKEN}\r\nConnection: close\r\n\r\n`);
      });
      sock.on('data', (d) => parts.push(d));
      sock.on('error', reject);
      sock.on('end', () => resolve(Buffer.concat(parts)));
    });
    const split = raw.indexOf('\r\n\r\n') + 4;
    const headers = raw.subarray(0, split).toString();
    const body = raw.subarray(split);

    assert.ok(!/transfer-encoding:\s*chunked/i.test(headers),
      'must not be chunked — the firmware reads the raw socket');
    assert.match(headers, /Content-Length:\s*96000/i);
    assert.equal(body.length, 96000, 'body must be exactly two 48000-byte planes');
    // A chunk header would look like hex digits followed by CRLF.
    assert.ok(!/^[0-9a-f]+\r\n/i.test(body.subarray(0, 12).toString('latin1')),
      'body must start with image data, not a chunk-size header');
  } finally {
    child.kill();
  }
});

// --- Config migration v5: retire cosmetic per-tile settings ----------------
//
// The risk this guards is asymmetric. Dropping a cosmetic key is recoverable
// (the design decides the look now); dropping a DATA or CONTENT key silently
// destroys something the user typed — a calendar URL, a ticker list, a
// forecast-day count — with no way to know it is gone until the tile renders
// wrong. So this asserts both directions, not just that the strip happened.
test('config migration v5 strips cosmetics and keeps content', async () => {
  const { migrateConfigToScreens } = await import('../lib/screens.js');
  const cfg = {
    gridVersion: 4,
    firstRunSeeded: true,
    screens: [{
      id: 'x', name: 'X', isDefault: true, layoutKind: 'free',
      layout: [
        { id: 'a', widgetId: 'weather_forecast', x: 0, y: 0, w: 14, h: 9,
          density: 'rich',
          settings: { lat: 1, lon: 2, city: 'Town', forecastDays: 4, includeToday: true,
                      variant: 'columns', theme: 'inverted', fontScale: 1, padding: 14,
                      bold: true, fontFamily: 'system', frame: 'none' } },
        { id: 'b', widgetId: 'calendar', x: 0, y: 9, w: 10, h: 3,
          settings: { icalUrls: ['https://example.com/c.ics'], density: 'compact',
                      variant: 'strip5', showTime: true, padding: 14 } },
        { id: 'c', widgetId: 'art', x: 10, y: 9, w: 10, h: 3,
          settings: { density: 22, seed: 7, theme: 'normal' } },
      ],
    }],
  };
  const { GRID_VERSION } = await import('../lib/screens.js');
  const out = migrateConfigToScreens(JSON.parse(JSON.stringify(cfg)));
  assert.equal(out.gridVersion, GRID_VERSION);
  const [a, b, c] = out.screens[0].layout;

  // Cosmetics gone, including the item-level layout-density override.
  // fontFamily is stripped again now that the world clock's grotesk face
  // lives in .wclock-time rather than in one tile's settings.
  for (const k of ['theme', 'fontScale', 'padding', 'bold', 'frame', 'fontFamily']) {
    assert.ok(!(k in a.settings), `${k} should be stripped`);
  }
  assert.ok(!('density' in a), 'item-level density override should be stripped');

  // Data and content survive untouched.
  assert.deepEqual(
    { lat: a.settings.lat, lon: a.settings.lon, city: a.settings.city,
      forecastDays: a.settings.forecastDays, includeToday: a.settings.includeToday,
      variant: a.settings.variant },
    { lat: 1, lon: 2, city: 'Town', forecastDays: 4, includeToday: true, variant: 'columns' });
  assert.deepEqual(b.settings.icalUrls, ['https://example.com/c.ics']);
  assert.equal(b.settings.showTime, true);

  // settings.density is the widget's OWN parameter on art (grid fineness) and
  // calendar (how much of each event shows) — not the retired layout knob.
  assert.equal(b.settings.density, 'compact');
  assert.equal(c.settings.density, 22);
  assert.equal(c.settings.seed, 7);

  // theme: 'normal' is the escape hatch the modal writes; only 'inverted'
  // (now the default) is redundant.
  assert.equal(c.settings.theme, 'normal');

  // A variant that no longer exists is dropped so the tile falls through to
  // the widget default instead of pinning something unreachable.
  assert.ok(!('variant' in b.settings), 'cut variant strip5 should be dropped');
});

// --- Config migration v6: drop per-tile locations that restate Setup -------
//
// Same asymmetry as v5, sharper: this deletes a location. Dropping one that
// merely duplicates cfg.home costs nothing (the tile inherits the identical
// value); dropping one that points somewhere ELSE silently moves a tile to
// another city. So the override case is asserted as hard as the strip case.
test('config migration v6 drops duplicated tile locations, keeps real overrides', async () => {
  const { migrateConfigToScreens } = await import('../lib/screens.js');
  const mk = (settings) => ({
    gridVersion: 5,
    firstRunSeeded: true,
    // Legacy top-level shape on purpose — a config old enough to need v6 is
    // exactly one written before cfg.home existed.
    city: 'Gainesville,Florida,US', lat: 29.65163, lon: -82.32483,
    screens: [{ id: 'x', isDefault: true, layoutKind: 'free',
      layout: [{ id: 't', widgetId: 'weather_hero', settings }] }],
  });
  const out = (settings) => migrateConfigToScreens(mk(settings)).screens[0].layout[0].settings;

  // The live config's actual shape: same place, different comma spacing.
  assert.deepEqual(out({ city: 'Gainesville, Florida, US', lat: 29.65163, lon: -82.32483 }), {});
  // Coordinates alone are enough to call it a duplicate; siblings survive.
  assert.deepEqual(out({ lat: 29.65163, lon: -82.32483, variant: 'split' }), { variant: 'split' });
  // City-only, spacing-insensitive.
  assert.deepEqual(out({ city: 'Gainesville, Florida, US' }), {});

  // A tile deliberately pointed elsewhere must survive intact.
  const tokyo = { city: 'Tokyo,JP', lat: 35.68, lon: 139.69 };
  assert.deepEqual(out(tokyo), tokyo);
  assert.deepEqual(out({ city: 'Boston,MA,US' }), { city: 'Boston,MA,US' });
  // Coordinates that differ are an override even when the city string matches.
  assert.deepEqual(out({ city: 'Gainesville,Florida,US', lat: 1, lon: 2 }),
    { city: 'Gainesville,Florida,US', lat: 1, lon: 2 });

  // With no home to inherit from, nothing is touched — stripping there would
  // leave the tile with no location at all.
  const homeless = migrateConfigToScreens({
    gridVersion: 5, firstRunSeeded: true,
    screens: [{ id: 'x', isDefault: true, layoutKind: 'free',
      layout: [{ id: 't', widgetId: 'weather_hero', settings: { lat: 1, lon: 2 } }] }],
  });
  assert.deepEqual(homeless.screens[0].layout[0].settings, { lat: 1, lon: 2 });
});
