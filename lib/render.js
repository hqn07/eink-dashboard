// Rendering + image cache. Owns the single persistent Puppeteer browser, the
// page semaphore, the per-variant image cache, and the background pre-render
// warmer. renderDashboardPng screenshots the server's own /dashboard endpoint
// over HTTP (it does not import the SSR renderer), so this module only needs
// the image pipeline + config/screen resolution for the warmer.
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const { DEVICE_TOKEN } = require('./env');
const { rgbaToMono, packMonoBin, rgbaToPlanes } = require('./image');
const { loadConfig } = require('./config-store');
const { resolveVariant } = require('./screens');

const PORT = process.env.PORT || 3000;
const SCREEN_W = 800, SCREEN_H = 480;

// ---------- Puppeteer (one persistent browser, auto-relaunch if it dies) ----------
let browserPromise = null;
async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      // Puppeteer marks a Browser as disconnected if the process crashed.
      if (b && b.connected) return b;
    } catch (_) {
      // Fall through to relaunch
    }
    browserPromise = null;
  }
  const launchOpts = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // Chromium spawns a chrome_crashpad_handler helper. When the browser
      // dies it re-parents to PID 1; if PID 1 doesn't reap it (bare `node`),
      // the zombie leaks and the container eventually hits its PID limit
      // (fork: EAGAIN -> every launch fails). Disable the reporter so no
      // handler is spawned; `tini` (nixpacks start cmd) reaps any that slip
      // through. See the Aug-2026 fleet-down incident.
      '--disable-crash-reporter',
      '--disable-breakpad'
    ]
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  browserPromise = puppeteer.launch(launchOpts).then(b => {
    b.on('disconnected', () => {
      console.warn('Puppeteer browser disconnected — will relaunch on next request');
      browserPromise = null;
    });
    return b;
  }).catch(err => {
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

async function killBrowser() {
  // Null the handle FIRST (synchronously) so a getBrowser() that races the
  // close sees no browser and relaunches into a fresh promise; this function
  // then only ever closes the OLD instance and never clobbers the new one.
  const p = browserPromise;
  browserPromise = null;
  try {
    const b = p ? await p : null;
    if (b) await b.close();
  } catch (_) {}
}

// ---------- Idle browser close ----------
// Chromium holds ~300-500 MB resident. On an infrequently-woken e-ink fleet it
// sits idle almost all the time, yet a cloud host bills that RAM every minute.
// So after a quiet period with no active render, close the browser and let
// getBrowser() relaunch on the next render. The image cache is separate bytes,
// so a device is still served instantly from cache while the browser is down —
// only the background revalidate pays the cold relaunch (+1-2s), invisible to a
// device that wakes every 15-30 min.
//
// DEFAULT OFF (0). The launch/kill churn this introduced leaked orphaned
// chrome_crashpad_handler processes (bare `node` as PID 1 never reaped them),
// exhausting the container PID table after ~10 days and taking the whole fleet
// down with `fork: EAGAIN` (Aug 2026). One resident browser — the model that
// ran stable for months — has no relaunch churn. Re-enable only alongside the
// `tini` init (nixpacks) + crash-reporter-off launch args that make repeated
// relaunch safe: set BROWSER_IDLE_MS to the desired quiet window in ms.
const BROWSER_IDLE_MS = Math.max(
  0,
  parseInt(process.env.BROWSER_IDLE_MS, 10) || 0
);
let _idleTimer = null;
let _rendersInflight = 0;
function cancelIdleClose() {
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
}
function armIdleClose() {
  cancelIdleClose();
  if (!BROWSER_IDLE_MS || _rendersInflight > 0 || !browserPromise) return;
  _idleTimer = setTimeout(() => {
    _idleTimer = null;
    if (_rendersInflight === 0) killBrowser().catch(() => {});
  }, BROWSER_IDLE_MS);
  if (_idleTimer.unref) _idleTimer.unref(); // never keep the process alive
}

// Shared page semaphore. Puppeteer pages each hold ~200-300 MB of Chromium
// memory — under request spikes unbounded page creation would OOM. Dashboard
// renders queue; preview renders fail fast so the editor gets instant feedback.
const MAX_PAGES = 2;
let _pagesInflight = 0;
const _pageWaiters = [];
function acquirePage() {
  return new Promise(resolve => {
    if (_pagesInflight < MAX_PAGES) {
      _pagesInflight++;
      resolve();
    } else {
      _pageWaiters.push(resolve);
    }
  });
}
function tryAcquirePage() {
  if (_pagesInflight < MAX_PAGES) {
    _pagesInflight++;
    return true;
  }
  return false;
}
function releasePage() {
  if (_pageWaiters.length) {
    // Hand the slot directly to a waiter — slot stays "occupied".
    const next = _pageWaiters.shift();
    next();
  } else {
    _pagesInflight--;
  }
}

async function renderDashboardPng({ units, screen }) {
  await acquirePage();
  // A render is starting: hold the browser open (cancel any pending idle close).
  _rendersInflight++;
  cancelIdleClose();
  // Everything after the acquire lives inside try/finally — if getBrowser() or
  // newPage() throws the slot must still be released or the semaphore leaks.
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    await page.setViewport({
      width: SCREEN_W,
      height: SCREEN_H,
      deviceScaleFactor: 1
    });
    const qs = new URLSearchParams();
    if (units) qs.set('units', units);
    if (screen) qs.set('screen', String(screen));
    if (DEVICE_TOKEN) qs.set('token', DEVICE_TOKEN);
    const url = `http://127.0.0.1:${PORT}/dashboard${qs.toString() ? '?' + qs : ''}`;
    // domcontentloaded fires fast; the dashboard's JS runs synchronously. We
    // then wait for web fonts to settle so the screenshot has the right
    // typography, with a hard cap so a slow CDN can't hang us.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await Promise.race([
      page.evaluate(() => document.fonts && document.fonts.ready),
      new Promise(r => setTimeout(r, 4000))
    ]);
    // Wait for the page's autofit pass to finish so text measures at final
    // glyph metrics, not the fallback serif default.
    await page.waitForFunction(() => window.__autofitDone === true, { timeout: 4000 }).catch(() => {});
    const buf = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: SCREEN_W, height: SCREEN_H }
    });
    return buf;
  } catch (err) {
    // The browser may be wedged. Close it so the next request relaunches a
    // fresh instance instead of retrying against the broken one.
    //
    // But ONLY if we are the last render out. MAX_PAGES is 2, so a second
    // render can be in flight, and killing the browser underneath it turned
    // one slow page into two failures — recovery logic causing the thing it
    // was meant to contain. A wedged browser will be recycled by whichever
    // render is genuinely last.
    if (_rendersInflight <= 1) {
      console.error('Render failed, recycling browser:', err.message);
      await killBrowser();
    } else {
      console.error('Render failed (browser kept — %d other render(s) in flight):',
        _rendersInflight - 1, err.message);
    }
    throw err;
  } finally {
    if (page) { try { await page.close(); } catch (_) {} }
    releasePage();
    _rendersInflight--;
    armIdleClose(); // last render out → schedule the browser to close when idle
  }
}

// ---------- Image cache ----------
const imageCache = new Map();     // key: "units|screen" -> { at, png, bin }
const inflightImage = new Map();  // key -> Promise so concurrent hits share work
const IMAGE_CACHE_MS = 60 * 1000; // entry is "fresh" for 60s; older = revalidate
// Hard ceiling on stale-while-revalidate. Past this the cached entry is no
// longer served and a render happens inline, even though that makes the device
// wait. Without it, a permanently failing background re-render (Chromium won't
// launch, an upstream hangs, disk full) meant the SAME frame was served
// forever while the panel looked perfectly healthy — an e-ink display has no
// other way to say it is frozen. Better a slow refresh, or an honest error,
// than a screen that is confidently three days out of date.
const IMAGE_MAX_STALE_MS = Math.max(
  IMAGE_CACHE_MS,
  parseInt(process.env.IMAGE_MAX_STALE_MS, 10) || 30 * 60 * 1000
);

const imageCacheKey = (variant) => `${variant.units}|${variant.screen}`;

// Render the dashboard for one variant and store it in the cache. Concurrent
// callers for the same key share one render (inflight dedup).
function renderImage(variant) {
  const key = imageCacheKey(variant);
  const pending = inflightImage.get(key);
  if (pending) return pending;
  const promise = (async () => {
    const rgba = await renderDashboardPng(variant);
    const { rawMono, info, png } = await rgbaToMono(rgba);
    const bin = packMonoBin(rawMono, info);
    // 3-color plane pair (black+red, 96000 B). Cached lazily on first access
    // so BW-only fleets don't pay the extra RGBA pass. ETags (content hash)
    // let the firmware skip a redundant refresh via conditional-GET 304.
    let bin3c = null, etag3c = null;
    const etagOf = (b) => `"${crypto.createHash('sha1').update(b).digest('hex')}"`;
    const entry = {
      at: Date.now(), png, bin,
      etagBin: etagOf(bin),
      get3c: async () => {
        if (!bin3c) { bin3c = await rgbaToPlanes(rgba); etag3c = etagOf(bin3c); }
        return { bin: bin3c, etag: etag3c };
      }
    };
    imageCache.set(key, entry);
    return entry;
  })().finally(() => inflightImage.delete(key));
  inflightImage.set(key, promise);
  return promise;
}

// Stale-while-revalidate: once an entry exists, the device is ALWAYS served
// instantly. A stale entry is returned as-is and a refresh runs in the
// background, so the ESP32 wake never blocks on a cold Puppeteer render. Only
// the very first request for a key (cold cache) renders inline.
async function getCurrentImage(variant) {
  const key = imageCacheKey(variant);
  const cached = imageCache.get(key);
  if (cached) {
    const age = Date.now() - cached.at;
    // Too old to keep serving blind: re-render inline and let the caller wait.
    // If that throws, the error propagates rather than silently handing back a
    // frame from another era.
    if (age >= IMAGE_MAX_STALE_MS) {
      console.warn('Image cache exceeded max-stale (%ds) — rendering inline',
        Math.round(age / 1000));
      return renderImage(variant);
    }
    if (age >= IMAGE_CACHE_MS && !inflightImage.has(key)) {
      renderImage(variant).catch(err =>
        console.error('Background re-render failed:', err.message));
    }
    return cached;
  }
  return renderImage(variant);
}

// Force re-render on next request (called after config save). Clearing the
// cache plus an immediate warm means the next device hit is already fresh.
function invalidateImage() {
  imageCache.clear();
  if (PRERENDER_ENABLED) warmActiveImage();
}

// ---------- Background pre-render (keeps the device cache warm) ----------
// OFF by default. On an infrequently-woken fleet the interval re-render burns
// CPU and keeps Chromium resident 24/7 for renders nobody reads. Stale-while-
// revalidate already serves the device from cache and refreshes in the
// background on wake, so on-demand is enough. Opt back in with PRERENDER=1
// (e.g. a shared always-on host with many frequently-waking devices); tune
// cadence with PRERENDER_INTERVAL_MS.
const PRERENDER_ENABLED = process.env.PRERENDER === '1';
const PRERENDER_INTERVAL_MS = Math.max(
  60_000,
  parseInt(process.env.PRERENDER_INTERVAL_MS, 10) || 5 * 60_000
);

async function warmActiveImage() {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant({ query: {} }, cfg);
    await renderImage(variant); // force fresh so the served entry is current
  } catch (err) {
    console.error('Pre-render warm failed:', err.message);
  }
}

module.exports = {
  getBrowser, killBrowser,
  acquirePage, tryAcquirePage, releasePage,
  renderDashboardPng, renderImage, getCurrentImage, invalidateImage,
  warmActiveImage, imageCache,
  PRERENDER_ENABLED, PRERENDER_INTERVAL_MS, BROWSER_IDLE_MS,
  IMAGE_CACHE_MS, IMAGE_MAX_STALE_MS,
};
