// First-run security gate: a production instance with no PIN and no token
// must not serve an open editor or accept admin writes — it forces PIN setup.
// Runs its own server in production mode (separate from endpoints.test.mjs,
// which runs non-prod with a token).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4324;
const BASE = `http://127.0.0.1:${PORT}`;
let proc, dataDir;
const url = (p) => `${BASE}${p}`;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'eink-firstrun-'));
  // Production mode, NO DEVICE_TOKEN, NO PIN → the gated state.
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dataDir,
    PRERENDER: '0', NODE_ENV: 'production' };
  delete env.DEVICE_TOKEN;
  delete env.RAILWAY_ENVIRONMENT; // NODE_ENV already forces IS_PROD
  proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  const deadline = Date.now() + 30000;
  for (;;) {
    try { if ((await fetch(url('/health'))).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('server did not start');
    await new Promise(r => setTimeout(r, 250));
  }
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (dataDir) { try { rmSync(dataDir, { recursive: true, force: true }); } catch {} }
});

test('prod + no PIN → /control redirects to setup', async () => {
  const r = await fetch(url('/control'), { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location') || '', /\/control\/setup$/);
});

test('setup page renders the create-PIN form', async () => {
  const r = await fetch(url('/control/setup'));
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Secure your dashboard/);
});

test('admin writes are refused before a PIN exists', async () => {
  const r = await fetch(url('/api/config'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timezone: 'UTC' }),
  });
  assert.equal(r.status, 401);
});

test('first-run set-pin bootstraps access', async () => {
  const r = await fetch(url('/api/auth/set-pin'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie');
  assert.ok(cookie, 'expected a session cookie');
  const jar = cookie.split(';')[0];
  // Editor + admin API now reachable with the session.
  const c = await fetch(url('/control'), { headers: { cookie: jar }, redirect: 'manual' });
  assert.equal(c.status, 200);
  const a = await fetch(url('/api/config'), { headers: { cookie: jar } });
  assert.equal(a.status, 200);
});

test('once a PIN exists, /control/setup bounces to login', async () => {
  // (runs after the set-pin test above)
  const r = await fetch(url('/control/setup'), { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location') || '', /\/control\/login$/);
});
