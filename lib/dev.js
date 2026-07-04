// Dev-only hot-reload: /dev/widget pages open an EventSource to /dev/events,
// and this module fans a `reload` event out to them whenever a source file
// changes. Owns the client set + watcher state. Gated to non-production by the
// route, so Railway never starts the watcher.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const clients = new Set();
let watchersStarted = false;

function broadcast() {
  for (const r of clients) {
    try { r.write('event: reload\ndata: 1\n\n'); } catch (_) { /* drop */ }
  }
}

function addClient(res) { clients.add(res); }
function removeClient(res) { clients.delete(res); }

function startDevWatchers() {
  if (watchersStarted) return;
  watchersStarted = true;
  let pending = null;
  const onChange = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => { pending = null; broadcast(); }, 200);
  };
  const dirs = ['public', 'control-src', 'widgets', 'data-defaults'];
  for (const d of dirs) {
    try {
      fs.watch(path.join(ROOT, d), { recursive: true }, onChange);
    } catch (e) {
      console.warn('[dev] watch skipped', d, e.message);
    }
  }
  console.log('[dev] file watchers started');
}

module.exports = { addClient, removeClient, startDevWatchers };
