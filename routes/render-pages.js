// HTML/PNG render surfaces: the /dashboard SSR page Puppeteer screenshots, the
// /dev/* designer hot-reload pages, the modal /preview endpoints, and the
// /widgets-matrix visual-regression page. All share the same renderPage path
// (parity with the editor canvas is load-bearing).
const sharp = require('sharp');
const router = require('express').Router();
const { DEVICE_TOKEN, IS_PROD } = require('../lib/env');
const { checkDeviceAuth, checkAdminAuth } = require('../lib/auth');
const { loadConfig } = require('../lib/config-store');
const { resolveVariant, resolveScreenLayout } = require('../lib/screens');
const { buildWidgetData } = require('../lib/widget-data');
const { loadBatteryState, loadBatteryHistory } = require('../lib/battery-store');
const { renderPage } = require('../lib/ssr');
const { loadDashboardHtml, loadSsr } = require('../lib/ssr-shell');
const { getBrowser, tryAcquirePage, releasePage } = require('../lib/render');
const { preThreshold } = require('../lib/image');
const { decodeSettingsParam } = require('../lib/htmlutil');
const { safeError } = require('../lib/http');
const { freezeTime, DEMO_INSTANT } = require('../lib/timefreeze');
const { getActiveBeam } = require('../lib/beam-store');
const dev = require('../lib/dev');

const PORT = process.env.PORT || 3000;
const SCREEN_W = 800, SCREEN_H = 480;

// Dashboard HTML — built from the active screen's layout + live data. All
// widget rendering happens server-side; the shell only carries CSS + autofit.
router.get('/dashboard', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const { units, screen, activeScreen } = resolveVariant(req, cfg);
    const layout = resolveScreenLayout(activeScreen);
    const data = await buildWidgetData(cfg, units, layout);

    const [shell, ssr] = await Promise.all([loadDashboardHtml(), loadSsr()]);
    const battery = await loadBatteryState();
    const batteryHistory = await loadBatteryHistory();
    const beam = await getActiveBeam();
    const payload = {
      cfg, units, screen, layout, battery, batteryHistory, beam,
      cardStyle: (activeScreen && activeScreen.cardStyle) || 'grid',
      ...data,
      generatedAt: new Date().toISOString()
    };
    const html = renderPage({ payload, shell, ssr });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Dashboard render error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// ---------- Dev tooling ----------
// /dev/widget/:id renders a single widget full-screen with an SSE hot-reload
// script. Gated to non-production so Railway doesn't expose the watcher.
router.get('/dev/events', (req, res) => {
  if (IS_PROD) return res.status(404).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  dev.addClient(res);
  dev.startDevWatchers();
  req.on('close', () => dev.removeClient(res));
});

router.get('/dev/widget/:id', checkAdminAuth, async (req, res) => {
  if (IS_PROD) return res.status(404).end();
  try {
    const id = String(req.params.id);
    const sizeKey = req.query.size ? String(req.query.size) : null;

    const cfg = await loadConfig();
    const units = cfg.units || 'F';
    // Single-widget layout. Without a size, fill the whole 24x12 grid.
    const item = { id: `dev-${id}`, widgetId: id, x: 0, y: 0, enabled: true };
    if (sizeKey) item.size = sizeKey;
    else { item.w = 24; item.h = 12; }
    const layout = [item];

    const data = await buildWidgetData(cfg, units, layout);
    const [shell, ssr] = await Promise.all([loadDashboardHtml(), loadSsr()]);
    const payload = {
      cfg, units, screen: 0, layout,
      ...data,
      devWidgetId: id,
      generatedAt: new Date().toISOString()
    };
    let html = renderPage({ payload, shell, ssr, mode: 'dev' });
    // EventSource auto-reload on any source file change.
    const reloadScript = `<script>
      try {
        const es = new EventSource('/dev/events');
        es.addEventListener('reload', () => location.reload());
      } catch(e) {}
    </script>`;
    html = html.replace('</body>', reloadScript + '</body>');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Dev widget render error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// ---------- Modal preview (single-widget HTML + PNG) ----------
// GET /preview/widget renders one widget at w/h with draft settings (the modal
// loads it in an iframe, matching dashboard SSR pixel-for-pixel). POST
// /api/preview-render screenshots that same page through the display.bin
// threshold pipeline so the result is bit-identical to what the ESP32 draws.
async function buildPreviewPayload({ widgetId, w, h, settings, units, density }) {
  const cfg = await loadConfig();
  const effUnits = (units === 'C' || units === 'F') ? units : (cfg.units || 'F');
  const item = {
    id: `preview-${widgetId}`,
    widgetId,
    x: 0, y: 0,
    w: Math.max(1, Math.min(24, parseInt(w, 10) || 8)),
    h: Math.max(1, Math.min(12, parseInt(h, 10) || 4)),
    enabled: true,
    settings: settings || undefined,
    density: density || undefined
  };
  const layout = [item];
  const data = await buildWidgetData(cfg, effUnits, layout);
  return {
    cfg, units: effUnits, screen: 0, layout,
    ...data,
    devWidgetId: widgetId,
    generatedAt: new Date().toISOString()
  };
}

router.get('/preview/widget', checkAdminAuth, async (req, res) => {
  try {
    const widgetId = String(req.query.widget || '').trim();
    if (!widgetId) return res.status(400).send('missing widget');
    const settings = decodeSettingsParam(req.query.settings);
    const payload = await buildPreviewPayload({
      widgetId,
      w: req.query.w, h: req.query.h,
      settings,
      units: req.query.units,
      density: req.query.density
    });
    const [shell, ssr] = await Promise.all([loadDashboardHtml(), loadSsr()]);
    const html = renderPage({ payload, shell, ssr, mode: 'preview' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    // Don't long-cache — every keystroke produces a new URL via the settings
    // hash, and the user expects fresh data on reload.
    res.set('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    console.error('Preview render error:', err);
    res.status(500).send(safeError(err).error);
  }
});

async function renderPreviewPng({ widgetId, w, h, settings, units, density }) {
  // Non-blocking acquire: editor scrubbing a slider could fire dozens of
  // preview requests; better to "busy" them fast than to queue and starve the
  // dashboard render path (which devices depend on).
  if (!tryAcquirePage()) {
    throw new Error('preview busy');
  }
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(12000);
    page.setDefaultNavigationTimeout(12000);
    try {
      // Preview mode collapses the page chrome down to the widget's pixel size,
      // so the viewport matches 1:1 — full screenshot is the widget.
      const PX_W = SCREEN_W / 24, PX_H = SCREEN_H / 12;
      const cellW = Math.max(1, Math.round(w * PX_W));
      const cellH = Math.max(1, Math.round(h * PX_H));
      await page.setViewport({ width: cellW, height: cellH, deviceScaleFactor: 1 });
      const qs = new URLSearchParams({
        widget: widgetId, w: String(w), h: String(h)
      });
      if (settings) {
        qs.set('settings', Buffer.from(JSON.stringify(settings)).toString('base64'));
      }
      if (units) qs.set('units', units);
      if (density) qs.set('density', density);
      if (DEVICE_TOKEN) qs.set('token', DEVICE_TOKEN);
      const url = `http://127.0.0.1:${PORT}/preview/widget?${qs}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await Promise.race([
        page.evaluate(() => document.fonts && document.fonts.ready),
        new Promise(r => setTimeout(r, 3500))
      ]);
      await page.waitForFunction(() => window.__autofitDone === true, { timeout: 3000 }).catch(() => {});

      const rgba = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: cellW, height: cellH }
      });

      // Run the same threshold pipeline /display.bin uses so the PNG is
      // bit-identical to what the ESP32 will draw.
      const { data, info } = await preThreshold(sharp(rgba))
        .threshold(128)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const png = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 1 }
      }).png({ palette: true, colors: 2 }).toBuffer();
      return png;
    } finally {
      try { await page.close(); } catch (_) {}
    }
  } finally {
    releasePage();
  }
}

router.post('/api/preview-render', checkAdminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const widgetId = String(body.widgetId || '').trim();
    if (!widgetId) return res.status(400).json({ error: 'missing widgetId' });
    const w = Math.max(1, Math.min(24, parseInt(body.w, 10) || 8));
    const h = Math.max(1, Math.min(12, parseInt(body.h, 10) || 4));
    const png = await renderPreviewPng({
      widgetId, w, h,
      settings: body.settings || null,
      units: body.units,
      density: body.density
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    const msg = err && err.message;
    if (msg === 'preview busy') return res.status(503).json({ error: 'busy' });
    console.error('Preview PNG error:', err);
    res.status(500).json(safeError(err));
  }
});

// Visual matrix — every widget at every preset size, top-to-bottom. Pure dev
// tooling for spotting layout bugs before they hit the panel.
router.get('/widgets-matrix', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const units = cfg.units || 'F';
    // `?demo=1` skips the live fetch so every tile falls back to the frozen
    // demo data — deterministic output for the visual-regression snapshot.
    const demoOnly = req.query.demo === '1' || req.query.demo === 'true';
    const fakeLayout = [
      { widgetId: 'weather' },
      { widgetId: 'calendar' }, { widgetId: 'text' }
    ];
    const data = demoOnly ? {} : await buildWidgetData(cfg, units, fakeLayout);
    const [shell, ssr] = await Promise.all([loadDashboardHtml(), loadSsr()]);
    const payload = {
      cfg, units, screen: 1, layout: [],
      ...data,
      generatedAt: demoOnly ? DEMO_INSTANT : new Date().toISOString()
    };
    // Demo mode is the visual-regression snapshot, so the clock is frozen
    // too — otherwise the date line, calendar grouping, moon phase and
    // word-of-day redraw the baseline red every day. renderPage is
    // synchronous, so nothing else can observe the swap.
    const html = demoOnly
      ? freezeTime(DEMO_INSTANT, () => renderPage({ payload, shell, ssr, mode: 'matrix' }))
      : renderPage({ payload, shell, ssr, mode: 'matrix' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Matrix render error:', err);
    res.status(500).send(safeError(err).error);
  }
});

module.exports = router;
