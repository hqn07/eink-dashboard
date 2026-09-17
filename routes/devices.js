// Device enrollment + roster + event log. Firmware POSTs /api/setup once to
// mint a per-device api_key (gated by the fleet DEVICE_TOKEN when one is
// set); the control UI lists and prunes the roster. Records live in the
// devices-store; firmware-reported events in the logs-store.
const router = require('express').Router();
const { DEVICE_TOKEN } = require('../lib/env');
const { checkAdminAuth, checkDeviceAuth } = require('../lib/auth');
const { loadDevicesSync, saveDevices, genApiKey, genFriendlyId } = require('../lib/devices-store');
const { loadDeviceLogs, appendDeviceLog } = require('../lib/logs-store');

router.post('/api/setup', async (req, res) => {
  try {
    const mac = String((req.body && req.body.mac) || '').toLowerCase().trim();
    // Gate enrollment behind DEVICE_TOKEN when one is set, so a stranger can't
    // mint a device key (and then read /display.*). Open when no token is
    // configured (local dev / first run). Firmware sends the token via addToken().
    //
    // ENROLL_RECOVERY_MAC is the narrow way out of a real trap: a device whose
    // compiled fleet token no longer matches the server cannot authenticate,
    // and cannot re-enroll either, because enrollment needs that same token.
    // Without physical access to reflash, the panel is stuck forever. Setting
    // this to one known MAC lets exactly that device enroll and obtain a
    // durable per-device api_key; every other endpoint stays gated, and every
    // other MAC is still refused. Unset it once the device is back.
    if (DEVICE_TOKEN) {
      const tok = req.query.token || req.headers['x-device-token'];
      const recoveryMac = String(process.env.ENROLL_RECOVERY_MAC || '').toLowerCase().trim();
      const recovering = !!recoveryMac && mac === recoveryMac;
      if (tok !== DEVICE_TOKEN && !recovering) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      if (recovering && tok !== DEVICE_TOKEN) {
        console.warn(`[setup] recovery enrollment for ${mac} — ENROLL_RECOVERY_MAC is set; unset it once the device is back`);
      }
    }
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
    screen:      d.screen || null,
    first_seen_at: d.first_seen_at || null,
    last_seen_at:  d.last_seen_at || null
  }));
  res.json({ devices: out });
});

// Admin: assign a screen to a device (or clear with screen: null). The
// device then renders that screen on every fetch instead of the scheduler's
// pick — this is what lets a second panel show different content. Accepts
// friendly_id or MAC, same lookup as DELETE.
router.patch('/api/device/:id', checkAdminAuth, async (req, res) => {
  const id = String(req.params.id || '').trim();
  const devices = loadDevicesSync();
  const mac = devices[id] ? id
    : Object.keys(devices).find(m =>
        (devices[m].friendly_id || '').toLowerCase() === id.toLowerCase() ||
        m.toLowerCase() === id.toLowerCase());
  if (!mac || !devices[mac]) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  if (!('screen' in b)) return res.status(400).json({ error: 'screen_required' });
  if (b.screen === null || b.screen === '') {
    delete devices[mac].screen;
  } else if (typeof b.screen === 'string' && b.screen.length <= 64) {
    devices[mac].screen = b.screen;
  } else {
    return res.status(400).json({ error: 'bad_screen' });
  }
  await saveDevices(devices);
  res.json({ ok: true, mac, screen: devices[mac].screen || null });
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

// Firmware event log (TRMNL-style /api/log). The device buffers its last
// failure in RTC memory and reports it on the next successful connect, so
// outages become debuggable from the server without a serial cable. Body:
// { msg, level?, code? } — everything else (identity, fw, board) comes from
// the enrolled device record or headers, not the client-controlled body.
router.post('/api/log', checkDeviceAuth, async (req, res) => {
  const b = req.body || {};
  const msg = String(b.msg || '').slice(0, 300).trim();
  if (!msg) return res.status(400).json({ error: 'msg_required' });
  const level = ['info', 'warn', 'error'].includes(b.level) ? b.level : 'info';
  const code = Number.isFinite(+b.code) ? +b.code : undefined;
  const dev = req.device || {};
  await appendDeviceLog({
    at: Date.now(),
    level, msg,
    ...(code !== undefined ? { code } : {}),
    device: dev.friendly_id || null,
    board:  dev.board || req.headers['fw-board'] || null,
    fw:     dev.fw_version || req.headers['fw-version'] || null
  });
  res.json({ ok: true });
});

// Admin: read the device event log, newest first. `?limit=N` caps the
// response (default 100).
router.get('/api/logs', checkAdminAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(300, parseInt(req.query.limit, 10) || 100));
  const logs = await loadDeviceLogs();
  res.json({ logs: logs.slice(-limit).reverse() });
});

module.exports = router;
