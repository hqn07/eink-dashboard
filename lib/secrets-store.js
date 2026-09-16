// Credentials, deliberately kept OUT of config.json.
//
// Backup > EXPORT is `JSON.stringify(cfg)` in the browser, so anything in the
// config travels in a plain JSON file the user may email or attach. We chose
// structure over redaction (2026-09-16): a secret that is not in `cfg` cannot
// be exported by a code path that forgets to redact it, and cannot be
// resurrected by an import that predates the redaction. Restoring a backup
// brings back the provider and model; the key is re-entered once, on purpose.
//
// What this is NOT: encryption at rest. The file sits on the same volume as
// everything else and anyone who can read the volume can read the key. It is
// scoped to a single-tenant instance the user controls, and the threat it
// actually addresses is the key leaving the box inside a backup file. Real
// at-rest encryption needs a key that is not also on the volume, which means
// an env secret or a KMS — worth doing if this goes multi-tenant.
const fsp = require('fs/promises');
const path = require('path');
const { DATA_DIR, atomicWriteFile } = require('./store');

const SECRETS_PATH = path.join(DATA_DIR, 'secrets.json');

// Every secret this server knows about. Adding a key here is all it takes to
// make it settable from the Connections panel and readable by a fetcher.
const SECRET_KEYS = ['aiApiKey'];

// Env fallback per secret, so an instance already configured through Railway
// keeps working untouched and nothing breaks the moment this ships.
const ENV_FALLBACK = { aiApiKey: 'AI_API_KEY' };

let _cache = null; // { aiApiKey?: string } | null until first load

async function loadSecrets() {
  if (_cache) return _cache;
  try {
    const raw = await fsp.readFile(SECRETS_PATH, 'utf8');
    const obj = JSON.parse(raw);
    _cache = (obj && typeof obj === 'object') ? obj : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

// Stored value wins over the env var: if the user typed a key into the UI,
// that is the more recent intent, and silently preferring a stale env var
// would make the field look broken.
async function getSecret(name) {
  const all = await loadSecrets();
  const stored = all[name];
  if (typeof stored === 'string' && stored.trim()) return stored.trim();
  const envName = ENV_FALLBACK[name];
  const fromEnv = envName ? process.env[envName] : '';
  return (typeof fromEnv === 'string' && fromEnv.trim()) ? fromEnv.trim() : '';
}

// An empty/blank value deletes the entry rather than storing "", so
// `getSecret` falls back to the env var again instead of being pinned to a
// blank the user did not mean as an override.
async function setSecret(name, value) {
  if (!SECRET_KEYS.includes(name)) throw new Error(`unknown secret: ${name}`);
  const all = { ...(await loadSecrets()) };
  const v = typeof value === 'string' ? value.trim() : '';
  if (v) all[name] = v; else delete all[name];
  _cache = all;
  // 0600: the volume is shared with nothing else today, but a credentials
  // file should not be world-readable on any host that later mounts it.
  await atomicWriteFile(SECRETS_PATH, JSON.stringify(all));
  try { await fsp.chmod(SECRETS_PATH, 0o600); } catch { /* best effort */ }
  return true;
}

// What the editor is allowed to see: whether a secret exists, where it came
// from, and just enough of the tail to recognise which key was pasted. Never
// the value.
async function describeSecret(name) {
  const all = await loadSecrets();
  const stored = typeof all[name] === 'string' ? all[name].trim() : '';
  const envName = ENV_FALLBACK[name];
  const envVal = envName && typeof process.env[envName] === 'string'
    ? process.env[envName].trim() : '';
  const effective = stored || envVal;
  return {
    configured: !!effective,
    source: stored ? 'stored' : (envVal ? 'env' : null),
    // Four characters is enough to tell two keys apart and not enough to be
    // worth anything on its own.
    hint: effective ? `…${effective.slice(-4)}` : null,
    envName: envName || null,
  };
}

async function describeAll() {
  const out = {};
  for (const k of SECRET_KEYS) out[k] = await describeSecret(k);
  return out;
}

module.exports = {
  SECRETS_PATH, SECRET_KEYS,
  loadSecrets, getSecret, setSecret, describeSecret, describeAll,
};
