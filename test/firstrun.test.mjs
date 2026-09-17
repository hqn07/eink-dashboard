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

// --- Changing the PIN must evict every existing session --------------------
//
// The whole reason to change a PIN is that you believe someone else has it.
// Before this, sessionSecret was preserved across the change, so every cookie
// issued under the old PIN stayed valid for its full 30 days — the one thing
// the action had to do was the one thing it did not do.
test('changing the PIN invalidates old sessions and keeps the caller signed in', async () => {
  // Sign in with the PIN set by the bootstrap test above.
  const login = await fetch(url('/api/auth/login'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  assert.equal(login.status, 200);
  const oldJar = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url('/api/config'), { headers: { cookie: oldJar } })).status, 200,
    'sanity: the old session works before the change');

  // Change it, authorised by that same session.
  const change = await fetch(url('/api/auth/set-pin'), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: oldJar },
    body: JSON.stringify({ pin: '13579' }),
  });
  assert.equal(change.status, 200);
  const newJar = change.headers.get('set-cookie').split(';')[0];

  // The old cookie is dead...
  assert.equal((await fetch(url('/api/config'), { headers: { cookie: oldJar } })).status, 401,
    'the session that existed before the PIN change must be evicted');
  // ...and the caller is not locked out of their own browser.
  assert.equal((await fetch(url('/api/config'), { headers: { cookie: newJar } })).status, 200,
    'the caller who changed the PIN keeps working');
  assert.notEqual(oldJar, newJar);
});

// --- Repeated wrong PINs back off ------------------------------------------
test('failed logins trigger an escalating lockout', async () => {
  const guess = (pin) => fetch(url('/api/auth/login'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin }),
  });

  // The first few wrong guesses are plain 401s — someone mistyping their own
  // PIN should never meet a lockout.
  for (let i = 0; i < 3; i++) {
    assert.equal((await guess('0000')).status, 401, `guess ${i + 1} should be a plain 401`);
  }

  // Past the grace count the endpoint starts refusing outright.
  const locked = await guess('0000');
  assert.equal(locked.status, 429, 'the 4th failure must start the backoff');
  assert.ok(Number(locked.headers.get('retry-after')) > 0, 'expected a Retry-After');

  // And it refuses even the CORRECT PIN while locked, so the response cannot
  // be used as an oracle for whether a guess was right.
  const rightButLocked = await guess('13579');
  assert.equal(rightButLocked.status, 429,
    'a locked-out caller must not learn that their PIN was correct');
});
