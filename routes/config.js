// Config CRUD for the control panel, plus the editor's live preview-data feed.
// Writes go through the config-store lock and invalidate the render cache.
const fsp = require('fs/promises');
const router = require('express').Router();
const { checkAdminAuth } = require('../lib/auth');
const {
  loadConfig, saveConfig, withConfigLock, invalidateConfigCache,
} = require('../lib/config-store');
const { CONFIG_PATH, DEFAULT_CONFIG_PATH, atomicWriteFile } = require('../lib/store');
const { migrateConfigToScreens, resolveVariant, resolveScreenLayout } = require('../lib/screens');
const { invalidateImage } = require('../lib/render');
const { buildWidgetData } = require('../lib/widget-data');
const { loadBatteryState, loadBatteryHistory } = require('../lib/battery-store');
const { safeError } = require('../lib/http');

// Reset config back to data-defaults. Destructive — the client confirms first.
router.post('/api/config/reset', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await withConfigLock(async () => {
      const raw = await fsp.readFile(DEFAULT_CONFIG_PATH, 'utf8');
      await atomicWriteFile(CONFIG_PATH, raw);
      invalidateConfigCache();
      invalidateImage();
      return migrateConfigToScreens(JSON.parse(raw));
    });
    res.json(cfg);
  } catch (err) {
    res.status(500).json(safeError(err));
  }
});

// Per-screen render context for the editor preview (live data + per-tile slot).
router.get('/api/preview-data', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const { units, screen, activeScreen } = resolveVariant(req, cfg);
    const layout = resolveScreenLayout(activeScreen);
    const data = await buildWidgetData(cfg, units, layout);
    const battery = await loadBatteryState();
    const batteryHistory = await loadBatteryHistory();
    res.json({
      cfg, units, screen, layout, battery, batteryHistory,
      ...data,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json(safeError(err));
  }
});

router.get('/api/config', checkAdminAuth, async (req, res) => {
  res.json(await loadConfig());
});

router.post('/api/config', checkAdminAuth, async (req, res) => {
  try {
    // Guard: req.body must be a plain object. A JSON string/array/number body
    // would otherwise spread into the config and corrupt it.
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ ok: false, error: 'body must be an object' });
    }
    if ('screens' in req.body && !Array.isArray(req.body.screens)) {
      return res.status(400).json({ ok: false, error: 'screens must be an array' });
    }
    const merged = await withConfigLock(async () => {
      const current = await loadConfig();
      // `screens` is canonical — whatever the editor sends wins. Other nested
      // settings are shallow-merged so the editor can patch a single section
      // without clobbering siblings.
      const next = { ...current, ...req.body,
        widgets:  { ...(current.widgets  || {}), ...(req.body.widgets  || {}) },
        message:  { ...(current.message  || {}), ...(req.body.message  || {}) },
        calendar: { ...(current.calendar || {}), ...(req.body.calendar || {}) },
        weather:  { ...(current.weather  || {}), ...(req.body.weather  || {}) },
      };
      if (Array.isArray(req.body.screens)) {
        next.screens = req.body.screens;
        // Drop the legacy single-layout array when the new schema is explicit.
        if (!('layout' in req.body))  delete next.layout;
        if (!('layouts' in req.body)) delete next.layouts;
      }
      await saveConfig(next);
      invalidateImage();
      return next;
    });
    res.json({ ok: true, config: merged });
  } catch (err) {
    res.status(500).json({ ok: false, ...safeError(err) });
  }
});

module.exports = router;
