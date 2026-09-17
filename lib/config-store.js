// config.json persistence: cached load, atomic save, and a write lock that
// serializes read-merge-write transactions. Owns its own cache/lock state.
//
// loadConfig runs the loaded JSON through a migrator (the server's
// migrateConfigToScreens, injected via setMigrator) so callers always get a
// current-schema config. The migrator is injected rather than imported to
// avoid a cycle with the screen-resolution code that lives in server.js.
const fsp = require('fs/promises');
const { CONFIG_PATH, DEFAULT_CONFIG_PATH, atomicWriteFile } = require('./store');

let _migrate = (cfg) => cfg;
function setMigrator(fn) { if (typeof fn === 'function') _migrate = fn; }

// In-memory config cache. Invalidated by saveConfig() and skipped when the
// file's mtime advances (covers out-of-process edits to config.json).
let _configCache = null; // { mtimeMs, cfg }

async function loadConfig() {
  try {
    const st = await fsp.stat(CONFIG_PATH);
    if (_configCache && _configCache.mtimeMs === st.mtimeMs) {
      return _configCache.cfg;
    }
    const raw = await fsp.readFile(CONFIG_PATH, 'utf8');
    const cfg = _migrate(JSON.parse(raw));
    _configCache = { mtimeMs: st.mtimeMs, cfg };
    return cfg;
  } catch (err) {
    // Seed from defaults ONLY when the file doesn't exist yet. Any other
    // failure (corrupted JSON, transient fs error) must NOT clobber the
    // user's config with defaults — surface the error instead so the bad
    // file can be inspected/repaired.
    if (err.code !== 'ENOENT') {
      console.error('config.json unreadable (NOT overwriting):', err.message);
      throw err;
    }
    const raw = await fsp.readFile(DEFAULT_CONFIG_PATH, 'utf8');
    await atomicWriteFile(CONFIG_PATH, raw);
    const cfg = _migrate(JSON.parse(raw));
    const st = await fsp.stat(CONFIG_PATH).catch(() => null);
    _configCache = { mtimeMs: st ? st.mtimeMs : 0, cfg };
    return cfg;
  }
}

// The schema version the server is writing. Injected alongside the migrator so
// config-store does not have to import lib/screens (which would be a cycle).
let _gridVersion = null;
function setGridVersion(v) { if (Number.isFinite(v)) _gridVersion = v; }

async function saveConfig(cfg) {
  // Stamp the SERVER's schema version on every write.
  //
  // The editor runs its own hand-mirrored migrateConfigToScreens and stamps
  // its own GRID_VERSION, which had drifted to 4 while the server was at 10.
  // Saving from the editor therefore wrote gridVersion:4 over an
  // already-migrated config, and the next load re-ran v5 against v9's output
  // and silently deleted a world clock's `zones` variant. The tile kept its
  // zones and rendered local time instead.
  //
  // The client is not the authority on the server's schema version. Whatever
  // it sends, what lands on disk is what this server actually migrated to.
  const out = _gridVersion != null ? { ...cfg, gridVersion: _gridVersion } : cfg;
  await atomicWriteFile(CONFIG_PATH, JSON.stringify(out, null, 2));
  _configCache = null;
}

function invalidateConfigCache() { _configCache = null; }

// Serialize all read-merge-write transactions on config.json. Two concurrent
// POSTs would otherwise both load the same baseline, merge their own patches,
// and the second write would silently clobber the first.
let _configWriteChain = Promise.resolve();
function withConfigLock(fn) {
  const run = _configWriteChain.then(fn, fn);
  _configWriteChain = run.catch(() => {}); // swallow rejections so one error doesn't wedge the lock
  return run;
}

module.exports = {
  loadConfig, saveConfig, withConfigLock, invalidateConfigCache, setMigrator,
  setGridVersion,
};
