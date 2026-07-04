// Device enrollment + roster. Firmware POSTs /api/setup once to mint a
// per-device api_key (gated by the fleet DEVICE_TOKEN when one is set); the
// control UI lists and prunes the roster. Records live in the devices-store.
const router = require('express').Router();
const { DEVICE_TOKEN } = require('../lib/env');
const { checkAdminAuth } = require('../lib/auth');
const { loadDevicesSync, saveDevices, genApiKey, genFriendlyId } = require('../lib/devices-store');

router.post('/api/setup', async (req, res) => {
  try {
    // Gate enrollment behind DEVICE_TOKEN when one is set, so a stranger can't
    // mint a device key (and then read /display.*). Open when no token is
    // configured (local dev / first run). Firmware sends the token via addToken().
    if (DEVICE_TOKEN) {
      const tok = req.query.token || req.headers['x-device-token'];
      if (tok !== DEVICE_TOKEN) return res.status(401).json({ error: 'unauthorized' });
    }
    const mac = String((req.body && req.body.mac) || '').toLowerCase().trim();
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
      return res.status(400).json({ error: 'bad_mac' });
    }
    const devices = loadDevicesSync();
    let dev = devices[mac];
    if (!dev) {
      dev = {
        mac,
        api_key:     genApiKey(),
        friendly_id: genFriendlyId(),
        first_seen_at: Date.now()
      };
    }
    dev.last_seen_at = Date.now();
    if (req.body && req.body.fw_version) dev.fw_version = String(req.body.fw_version);
    if (req.body && req.body.board)      dev.board      = String(req.body.board);
    devices[mac] = dev;
    await saveDevices(devices);
    res.json({ api_key: dev.api_key, friendly_id: dev.friendly_id });
  } catch (err) {
    console.error('setup error:', err);
    res.status(500).json({ error: 'internal' });
  }
});

// Admin: list every enrolled device + its last-seen telemetry. Auth'd behind
// the fleet-wide DEVICE_TOKEN so per-device keys don't expose the whole roster.
router.get('/api/devices', checkAdminAuth, (req, res) => {
  const all = loadDevicesSync();
  // Strip api_key from the response — the UI doesn't need it and it's
  // sensitive. friendly_id is the per-device handle.
  const out = Object.values(all).map(d => ({
    mac: d.mac,
    friendly_id: d.friendly_id,
    fw_version:  d.fw_version || null,
    board:       d.board || null,
    first_seen_at: d.first_seen_at || null,
    last_seen_at:  d.last_seen_at || null
  }));
  res.json({ devices: out });
});

// Admin: remove a stale device record by friendly_id or MAC. The device
// re-enrolls automatically if it ever checks in again, so this just prunes
// dead/duplicate rows from the roster.
router.delete('/api/device/:id', checkAdminAuth, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const devices = loadDevicesSync();
  const mac = devices[id] ? id
    : Object.keys(devices).find(m =>
        (devices[m].friendly_id || '').toLowerCase() === id.toLowerCase() ||
        m.toLowerCase() === id.toLowerCase());
  if (!mac || !devices[mac]) return res.status(404).json({ error: 'not_found' });
  delete devices[mac];
  await saveDevices(devices);
  res.json({ ok: true, removed: id });
});

module.exports = router;
