// Firmware OTA. Compiled `.bin` files live in public/firmware/ named
// `<board>-<semver>.bin`. The device hits /api/firmware/manifest with its
// board + current version; if a newer binary exists the manifest returns a
// download URL, and the device pulls the raw file from /firmware/<name>.
const path = require('path');
const fsp = require('fs/promises');
const router = require('express').Router();
const { DEVICE_TOKEN } = require('../lib/env');
const { checkDeviceAuth } = require('../lib/auth');
const { FW_DIR, FW_NAME_RE, parseSemver, cmpSemver, findNewestFirmware } = require('../lib/firmware');
const { quietCycleActive } = require('../lib/quiet-cycle');

router.get('/api/firmware/manifest', checkDeviceAuth, async (req, res) => {
  const board = String(req.query.board || '').toLowerCase();
  if (!/^[a-z0-9]+$/.test(board)) {
    return res.status(400).json({ error: 'bad_board' });
  }
  // Quiet cycle: decline to offer firmware so the wake stays short. An image
  // already downloaded is staged in flash and stays staged — this only skips
  // re-sending it. See lib/quiet-cycle.js.
  if (quietCycleActive()) return res.status(204).end();
  const from = parseSemver(req.query.from);
  const best = await findNewestFirmware(board);
  if (!best) return res.status(204).end();
  if (from && cmpSemver(best.ver, from) <= 0) return res.status(204).end();

  let size = null;
  try {
    const st = await fsp.stat(path.join(FW_DIR, best.name));
    size = st.size;
  } catch (_) { /* ignore */ }

  const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  let url = `${proto}://${host}/firmware/${best.name}`;
  if (DEVICE_TOKEN) url += `?token=${encodeURIComponent(DEVICE_TOKEN)}`;
  res.json({ version: best.version, board, url, size });
});

// Serve the raw .bin. Filename is strict-validated against the same regex the
// manifest uses, so a malicious `?file=../../etc/passwd` request can't escape
// the firmware directory.
router.get('/firmware/:file', checkDeviceAuth, (req, res) => {
  const name = req.params.file;
  if (!FW_NAME_RE.test(name)) return res.status(400).send('bad name');
  const full = path.join(FW_DIR, name);
  res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).send('not found');
  });
});

module.exports = router;
