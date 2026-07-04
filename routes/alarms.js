// Alarm config CRUD + the device-facing "next alarm" lookup. Alarms live in
// config.alarms; the device fetches /api/alarm/next each wake to decide how
// long to sleep.
const router = require('express').Router();
const { checkAdminAuth, checkDeviceAuth } = require('../lib/auth');
const { loadConfig, saveConfig, withConfigLock } = require('../lib/config-store');
const { invalidateImage } = require('../lib/render');
const { loadBatteryState } = require('../lib/battery-store');
const { computeNextAlarm, normalizeAlarmList } = require('../widgets/alarms');
const { renderTokens } = require('../widgets/_tokens');
const { safeError } = require('../lib/http');

router.get('/api/alarms', checkAdminAuth, async (req, res) => {
  const cfg = await loadConfig();
  res.json({ alarms: Array.isArray(cfg.alarms) ? cfg.alarms : [] });
});

router.post('/api/alarms', checkAdminAuth, async (req, res) => {
  try {
    const alarms = await withConfigLock(async () => {
      const cfg = await loadConfig();
      cfg.alarms = normalizeAlarmList(req.body && req.body.alarms);
      await saveConfig(cfg);
      invalidateImage();
      return cfg.alarms;
    });
    res.json({ ok: true, alarms });
  } catch (err) {
    console.error('alarms POST error:', err);
    res.status(500).json({ ok: false, ...safeError(err) });
  }
});

// Device fetches this each wake to decide how long to sleep. Returns the
// soonest-firing alarm as Unix ms + label + duration hint, or { next: null }.
router.get('/api/alarm/next', checkDeviceAuth, async (req, res) => {
  const cfg = await loadConfig();
  const next = computeNextAlarm(cfg.alarms || []);
  if (next && next.label) {
    const battery = await loadBatteryState();
    const ctx = {
      now: Date.now(),
      timezone: cfg.timezone || 'UTC',
      cfg, weather: null, battery, units: cfg.units || 'F',
      lastRefresh: Date.now(),
    };
    next.label = renderTokens(next.label, ctx);
  }
  res.json({
    now: Date.now(),
    next: next || null
  });
});

module.exports = router;
