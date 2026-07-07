// Webhook payload store — the server half of the TRMNL-style "private
// plugin": anything that can POST JSON (shortcuts, cron scripts, Home
// Assistant) pushes to /api/webhook/:key and the `webhook` widget renders
// the latest payload on the panel. One JSON file maps key → { at, data },
// last write wins per key. Bounded: keys and payload size are capped at
// the route; the store also drops the oldest keys past MAX_KEYS as a
// belt-and-braces guard for the Railway volume.
const fsp = require('fs/promises');
const { WEBHOOKS_PATH, atomicWriteFile } = require('./store');

const MAX_KEYS = 32;

async function loadWebhooks() {
  try {
    const raw = await fsp.readFile(WEBHOOKS_PATH, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

async function loadWebhook(key) {
  const all = await loadWebhooks();
  return all[key] || null;
}

// Serialized writes so concurrent POSTs to different keys can't lose each
// other in the read-modify-write. Resolves to `true` when the payload
// actually changed — the route only busts the render cache (a Puppeteer
// re-render) on real changes, so a chatty script re-POSTing the same JSON
// every few seconds costs a file write, not a render.
let _writeChain = Promise.resolve(false);

function saveWebhook(key, data) {
  _writeChain = _writeChain.then(async () => {
    const all = await loadWebhooks();
    const prev = all[key];
    const changed = !prev || JSON.stringify(prev.data) !== JSON.stringify(data);
    all[key] = { at: Date.now(), data };
    const keys = Object.keys(all);
    if (keys.length > MAX_KEYS) {
      keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
      for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete all[k];
    }
    await atomicWriteFile(WEBHOOKS_PATH, JSON.stringify(all));
    return changed;
  }).catch(err => {
    console.warn('webhook persist failed:', err.message);
    return false;
  });
  return _writeChain;
}

module.exports = { loadWebhooks, loadWebhook, saveWebhook, MAX_KEYS };
