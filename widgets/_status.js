// In-memory health tracker for each data-fetching widget. The /health
// endpoint surfaces this so users can see WHY a widget is empty: stale
// cache, upstream 4xx, timeout, never-called, etc.
const records = new Map();

function record(name, info) {
  const prev = records.get(name) || { calls: 0, ok: 0, fail: 0 };
  const entry = {
    ...prev,
    calls: prev.calls + 1,
    ok: prev.ok + (info.ok ? 1 : 0),
    fail: prev.fail + (info.ok ? 0 : 1),
    lastAt: Date.now(),
    lastOk: info.ok ? Date.now() : prev.lastOk,
    lastErr: info.ok ? prev.lastErr : (info.err || 'unknown'),
    lastLatencyMs: info.ms,
    lastCacheHit: !!info.cacheHit
  };
  records.set(name, entry);
}

function snapshot() {
  const out = {};
  for (const [name, e] of records) out[name] = e;
  return out;
}

// Helper that wraps an async fetch so timing + ok/fail are tracked
// automatically. Returns the inner promise's resolved value or null.
async function tracked(name, fn) {
  const t0 = Date.now();
  try {
    const v = await fn();
    record(name, { ok: true, ms: Date.now() - t0, cacheHit: false });
    return v;
  } catch (e) {
    record(name, { ok: false, ms: Date.now() - t0, err: e.message || String(e) });
    throw e;
  }
}

// Mark a cache hit (no network) without changing ok/fail counts much.
function cacheHit(name) {
  const prev = records.get(name) || { calls: 0, ok: 0, fail: 0 };
  records.set(name, {
    ...prev,
    lastAt: Date.now(),
    lastCacheHit: true
  });
}

module.exports = { record, snapshot, tracked, cacheHit };
