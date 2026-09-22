// Lazy imports that survive a deploy.
//
// THE FAILURE. The editor is a single page that stays open — a phone propped
// on a desk, a laptop tab from this morning. Its chunk filenames carry a
// content hash, and a deploy replaces them: `WidgetSettingsModal-3XY4RAJ3.js`
// stops existing the moment `WidgetSettingsModal-B8yNFPbi.js` ships. The page
// only finds out when someone opens the settings modal for the first time
// since the deploy, and then the dynamic import 404s and the ErrorBoundary
// shows "Failed to fetch dynamically imported module" — which is true, and
// useless, because the actual situation is "this page is from the last
// version" and the fix is to reload.
//
// THE FIX. Catch exactly that failure and reload once. Once is the whole
// design: a reload gets the new index.html and therefore the new chunk names,
// so if the import fails AGAIN after reloading, the chunk is genuinely missing
// (a broken deploy, an offline device, a proxy eating it) and the error
// belongs on screen rather than in a refresh loop. sessionStorage carries the
// "already tried" flag because it is per-tab and dies with the tab.
//
// Why not just keep old chunks around on the server: that only moves the
// window — a page open for a week still outlives whatever retention you pick,
// and it requires the deploy pipeline to remember. Reloading is correct for
// any age of page.

const RELOAD_FLAG = 'ctrl.chunkReloadAt';
const RELOAD_WINDOW_MS = 60_000;

// Bundlers word this differently per browser, and the message is all we get.
export function isChunkLoadError(err) {
  const msg = String((err && (err.message || err)) || '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \d+ failed/i.test(msg);
}

function reloadedRecently() {
  try {
    const at = parseInt(sessionStorage.getItem(RELOAD_FLAG) || '0', 10);
    return Number.isFinite(at) && Date.now() - at < RELOAD_WINDOW_MS;
  } catch {
    // Private mode / blocked storage: treat as "already reloaded" so a page
    // that cannot remember can never loop.
    return true;
  }
}

function markReloaded() {
  try { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())); } catch { /* ignore */ }
}

// Wraps a `() => import(...)` factory. Returns a promise that either resolves
// with the module or never resolves because the page is reloading.
export function retryOnStaleChunk(factory) {
  return () => factory().catch((err) => {
    if (isChunkLoadError(err) && !reloadedRecently()) {
      markReloaded();
      // Never resolves — the page is on its way out. Resolving with a stub
      // would flash a broken modal during the reload.
      window.location.reload();
      return new Promise(() => {});
    }
    throw err;
  });
}
