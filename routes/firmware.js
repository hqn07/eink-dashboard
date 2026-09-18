// Firmware OTA. Compiled `.bin` files live in public/firmware/ named
// `<board>-<semver>.bin`. The device hits /api/firmware/manifest with its
// board + current version; if a newer binary exists the manifest returns a
// download URL, and the device pulls the raw file from /firmware/<name>.
const path = require('path');
const fsp = require('fs/promises');
const router = require('express').Router();
const { DEVICE_TOKEN } = require('../lib/env');
const { checkDeviceAuth, checkAdminAuth } = require('../lib/auth');
const { FW_DIR, FW_NAME_RE, parseSemver, cmpSemver, findNewestFirmware } = require('../lib/firmware');
const { quietSuppressesFirmware } = require('../lib/quiet-cycle');

router.get('/api/firmware/manifest', checkDeviceAuth, async (req, res) => {
  const board = String(req.query.board || '').toLowerCase();
  if (!/^[a-z0-9]+$/.test(board)) {
    return res.status(400).json({ error: 'bad_board' });
  }
  // Quiet cycle: decline to offer firmware so the wake stays short. An image
  // already downloaded is staged in flash and stays staged — this only skips
  // re-sending it. See lib/quiet-cycle.js.
  if (quietSuppressesFirmware()) return res.status(204).end();
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
// How many bytes of the firmware the client actually consumed, per request.
//
// httpUpdate calls Update.begin() BEFORE reading the body: if begin() fails
// (no space, or not enough heap to open the OTA partition) it never drains the
// stream, so the socket closes early and the byte count lands far short. If it
// reads the whole thing and the device still does not boot the image, the
// failure is in Update.end() instead. The device itself cannot tell us — OTA
// failures were serial-only until 1.26.0 — so the server counts for it.
// Newest first, capped.
const fwFetchLog = [];
function recordFwFetch(entry) {
  fwFetchLog.unshift(entry);
  if (fwFetchLog.length > 20) fwFetchLog.pop();
}

router.get('/api/firmware/fetches', checkAdminAuth, (req, res) => {
  res.json({ fetches: fwFetchLog });
});

router.get('/firmware/:file', checkDeviceAuth, (req, res) => {
  const name = req.params.file;
  if (!FW_NAME_RE.test(name)) return res.status(400).send('bad name');
  const full = path.join(FW_DIR, name);

  const started = Date.now();
  let sent = 0;
  const onData = (chunk) => { sent += chunk.length; };
  res.on('pipe', (src) => src.on('data', onData));

  let total = null;
  try { total = require('fs').statSync(full).size; } catch (_) { /* 404 below */ }

  res.on('close', () => {
    if (total === null) return;
    recordFwFetch({
      at: started,
      file: name,
      ua: String(req.headers['user-agent'] || '').slice(0, 40),
      fwVersion: String(req.headers['fw-version'] || '') || null,
      total,
      sent,
      complete: sent >= total,
      ms: Date.now() - started,
    });
    if (sent < total) {
      console.warn('[firmware] %s: client took %d/%d bytes (%d%%) in %d ms — update aborted early',
        name, sent, total, Math.round((sent / total) * 100), Date.now() - started);
    }
  });

  res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).send('not found');
  });
});

module.exports = router;
