// Battery telemetry report/read for the ESP32. Stored to disk so it survives
// a server restart (the panel only POSTs once per wake, ~every 30 min, so an
// in-memory-only value would frequently be missing). Note: firmware also
// sends battery over headers on /display.bin; this POST stays for compat.
const router = require('express').Router();
const { checkDeviceAuth } = require('../lib/auth');
const { loadBatteryState, saveBatteryState } = require('../lib/battery-store');
const { invalidateImage } = require('../lib/render');

router.post('/api/battery', checkDeviceAuth, async (req, res) => {
  const v = parseFloat(req.body && req.body.v);
  const pct = parseInt(req.body && req.body.pct, 10);
  if (!Number.isFinite(v) || v < 0 || v > 6) {
    return res.status(400).json({ error: 'bad voltage' });
  }
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return res.status(400).json({ error: 'bad pct' });
  }
  await saveBatteryState({ v, pct, at: Date.now() });
  invalidateImage(); // so the next render shows the fresh value
  res.json({ ok: true });
});

router.get('/api/battery', checkDeviceAuth, async (req, res) => {
  const b = await loadBatteryState();
  res.json(b || { v: null, pct: null, at: null });
});

module.exports = router;
