// Device-facing render endpoints: the PNG previews, the raw 1-bit and 3-color
// packed binaries the ESP32 downloads, the two-zone header/body slices, and
// the sleep/wake cadence endpoints. All image bytes come from the render
// module's cache; this router is just HTTP shaping + battery-header capture.
const router = require('express').Router();
const { checkDeviceAuth, checkAdminAuth } = require('../lib/auth');
const { loadConfig } = require('../lib/config-store');
const { resolveVariant, pickActiveScreen, resolveRefreshMinutes } = require('../lib/screens');
const { getCurrentImage } = require('../lib/render');
const { effectiveRefresh, pushNow, FAST_INTERVAL_SECONDS, FAST_WINDOW_MS } = require('../lib/refresh');
const { saveBatteryState } = require('../lib/battery-store');
const { planesToPng, shiftPlanesLeft } = require('../lib/image');
const { calibPlanes, calibTag } = require('../lib/calib');
const { strongEtag } = require('../lib/htmlutil');
const { safeError } = require('../lib/http');

const SCREEN_W = 800, SCREEN_H = 480;

// Parse + validate the battery telemetry the firmware sends as headers on
// every image fetch. Returns the pct when valid (and persists it), else null.
function captureBatteryHeaders(req) {
  const hBattV = parseFloat(req.headers['battery-voltage']);
  const hBattPct = parseInt(req.headers['battery-pct'], 10);
  const battOk = Number.isFinite(hBattV) && hBattV >= 0 && hBattV <= 6 &&
      Number.isFinite(hBattPct) && hBattPct >= 0 && hBattPct <= 100;
  if (battOk) {
    saveBatteryState({ v: hBattV, pct: hBattPct, at: Date.now() })
      .catch(e => console.warn('battery-header save:', e.message));
    return hBattPct;
  }
  return undefined;
}

// Preview as PNG (for your browser)
router.get('/display.png', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { png } = await getCurrentImage(variant);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    console.error('PNG error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Panel-accurate 3-color preview — composites the actual black+red planes
// (what the B panel draws) into a true-color PNG. checkAdminAuth: it's a
// human/editor preview, not a device endpoint.
router.get('/display-3c.png', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { bin } = await (await getCurrentImage(variant)).get3c();
    const png = await planesToPng(bin);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    console.error('3C PNG error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Preview of the alignment-calibration target, so it can be checked in a
// browser before CALIB_3C puts it on glass. `?shift=N` previews what the
// panel is sent at that compensation (default: the raw, unshifted target).
router.get('/display-3c-calib.png', checkAdminAuth, async (req, res) => {
  try {
    const shift = parseInt(req.query.shift, 10) || 0;
    const bin = shift ? shiftPlanesLeft(calibPlanes(), shift) : calibPlanes();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(await planesToPng(bin));
  } catch (err) {
    console.error('3C CALIB PNG error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Raw 1-bit packed binary for ESP32 (smaller, no decode needed)
// 800 * 480 / 8 = 48000 bytes
router.get('/display.bin', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { bin, etagBin } = await getCurrentImage(variant);

    // Battery telemetry over headers (firmware sends Battery-Voltage +
    // Battery-Pct on every /display.bin request). Parsed first so the
    // adaptive-refresh header below can stretch the interval on low battery.
    const battPct = captureBatteryHeaders(req);

    // Adaptive-refresh header — how long to sleep before the next wake.
    // X-Refresh-Seconds carries the exact cadence (push-now fast window);
    // X-Refresh-Rate stays minute-granular for current firmware, floored at 1.
    const refresh = effectiveRefresh(cfg, battPct);
    res.set('X-Refresh-Rate', String(refresh.minutes));
    res.set('X-Refresh-Seconds', String(refresh.seconds));

    res.set('ETag', etagBin);
    res.set('Cache-Control', 'no-store');
    // Conditional GET: unchanged image → 304 so the firmware skips the refresh.
    if (req.headers['if-none-match'] === etagBin) {
      return res.status(304).end();
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('X-Image-Width', String(SCREEN_W));
    res.set('X-Image-Height', String(SCREEN_H));
    // res.end (not res.send) so Express keeps our strong ETag as-is.
    res.end(bin);
  } catch (err) {
    console.error('BIN error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Panel column-offset compensation for the B panel (hardware trait: the
// panel displays the image rotated right by a fixed number of columns, the
// rightmost strip wrapping to the left edge). The server pre-rotates the
// 3c binary LEFT by the same amount so the two cancel on glass. Applied
// here — NOT in the render cache — so /display-3c.png keeps previewing the
// true image and the BW endpoints are untouched. Calibrate via the
// PANEL_SHIFT_3C_PX env var (px); 0/unset = off.
const PANEL_SHIFT_3C_PX =
  (((parseInt(process.env.PANEL_SHIFT_3C_PX, 10) || 0) % SCREEN_W) + SCREEN_W) % SCREEN_W;

// Alignment-calibration mode. CALIB_3C=raw serves the measurement target
// with NO shift applied (so a photo reads the panel's native offset);
// CALIB_3C=shifted serves it through the current PANEL_SHIFT_3C_PX (so a
// photo confirms the compensation actually lands). Anything falsy = off.
// Deliberately env-driven: the device asks for /display-3c.bin and can't be
// told to add a query param, so this is the only way to get a target onto
// glass without reflashing or editing the user's screens.
const CALIB_3C = (process.env.CALIB_3C || '').trim().toLowerCase();
const CALIB_ON = CALIB_3C === 'raw' || CALIB_3C === 'shifted'
  || CALIB_3C === 'nocache' || CALIB_3C === '1';
const CALIB_SHIFTED = CALIB_3C === 'shifted';
// `nocache` hands out a unique ETag per request so the device can never 304
// its way out of redrawing. That makes the fault repeatable on demand: press
// the button a few times and compare where it lands each draw. A fixed row
// means a deterministic indexing bug; a row that moves means the transfer
// itself is unreliable. Costs a full ~20s colour refresh every single wake,
// so it is strictly a bench mode — never leave it on.
const CALIB_NOCACHE = CALIB_3C === 'nocache';

// Raw two-plane packed binary for the 3-color (B) panel.
// 96000 bytes = black plane (48000) + red plane (48000), each MSB-first.
router.get('/display-3c.bin', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    let bin, etag;
    if (CALIB_ON) {
      // Skip the render pipeline entirely — the target is pure pixel math,
      // so it's deterministic and needs no Puppeteer round-trip.
      bin = calibPlanes();
      etag = CALIB_NOCACHE
        ? `"calib-nocache-${Date.now()}"`
        : `"calib-${CALIB_3C}-${PANEL_SHIFT_3C_PX}-${calibTag()}"`;
      if (CALIB_SHIFTED && PANEL_SHIFT_3C_PX) bin = shiftPlanesLeft(bin, PANEL_SHIFT_3C_PX);
    } else {
      const entry = await getCurrentImage(variant);
      ({ bin, etag } = await entry.get3c());
    }
    if (!CALIB_ON && PANEL_SHIFT_3C_PX) {
      bin = shiftPlanesLeft(bin, PANEL_SHIFT_3C_PX);
      // Deterministic transform → still a strong ETag; suffixing the shift
      // makes a recalibration invalidate the device's cached ETag so it
      // redraws instead of 304-ing the stale alignment.
      etag = etag.replace(/"$/, `-s${PANEL_SHIFT_3C_PX}"`);
    }

    const battPct = captureBatteryHeaders(req);
    const refresh3c = effectiveRefresh(cfg, battPct);
    res.set('X-Refresh-Rate', String(refresh3c.minutes));
    res.set('X-Refresh-Seconds', String(refresh3c.seconds));
    res.set('ETag', etag);
    res.set('Cache-Control', 'no-store');
    // Conditional GET: identical image → 304, firmware skips the slow
    // ~15-26 s color refresh entirely and goes back to sleep.
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('X-Image-Width', String(SCREEN_W));
    res.set('X-Image-Height', String(SCREEN_H));
    res.set('X-Image-Planes', '2');
    res.end(bin);
  } catch (err) {
    console.error('3C BIN error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Two-zone refresh helpers for BW panels.
//
// Splitting display.bin into a header strip (top 60 rows) and a body region
// (next 420 rows) lets the firmware partial-refresh just the always-changing
// clock band while ETag-gating the larger body. Rows are top-to-bottom
// row-major MSB-first, so the split is a clean byte slice (0..6000, 6000..48000).
const HEADER_H_ROWS = 60;
const BODY_H_ROWS = SCREEN_H - HEADER_H_ROWS;   // 420
const HEADER_BYTES = (SCREEN_W * HEADER_H_ROWS) / 8;  // 6000
const BODY_BYTES   = (SCREEN_W * BODY_H_ROWS) / 8;    // 42000

function sendBinSlice(req, res, slice) {
  const etag = strongEtag(slice);
  res.set('ETag', etag);
  res.set('Cache-Control', 'no-store');
  res.set('X-Image-Width', String(SCREEN_W));
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.set('Content-Type', 'application/octet-stream');
  res.send(slice);
}

router.get('/display-header.bin', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { bin } = await getCurrentImage(variant);
    res.set('X-Image-Height', String(HEADER_H_ROWS));
    sendBinSlice(req, res, bin.subarray(0, HEADER_BYTES));
  } catch (err) {
    console.error('BIN header error:', err);
    res.status(500).send(safeError(err).error);
  }
});

router.get('/display-body.bin', checkDeviceAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const variant = resolveVariant(req, cfg);
    const { bin } = await getCurrentImage(variant);
    res.set('X-Image-Height', String(BODY_H_ROWS));
    sendBinSlice(req, res, bin.subarray(HEADER_BYTES, HEADER_BYTES + BODY_BYTES));
  } catch (err) {
    console.error('BIN body error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// Tell ESP32 how long to sleep — uses the active screen's refresh interval
// (which may differ per scheduled window).
router.get('/sleep', checkDeviceAuth, async (req, res) => {
  const cfg = await loadConfig();
  const s = pickActiveScreen(cfg);
  const refresh = effectiveRefresh(cfg);
  res.json({
    minutes: refresh.minutes, seconds: refresh.seconds,
    fast: refresh.fast, battSaver: refresh.battSaver, quiet: refresh.quiet,
    screenId: s ? s.id : null, screenName: s ? s.name : null
  });
});

// Push now — opens a fast-refresh window so the device picks up the latest
// render quickly instead of waiting out its full sleep interval. The device
// still has to wake once to enter the window (deep sleep can't be interrupted
// remotely), so the response reports the worst-case latency for the UI.
router.post('/api/wake', checkAdminAuth, async (req, res) => {
  const fastUntil = pushNow();
  const cfg = await loadConfig().catch(() => ({}));
  res.json({
    ok: true,
    fastUntil,
    fastSeconds: FAST_INTERVAL_SECONDS,
    windowMs: FAST_WINDOW_MS,
    maxLatencyMinutes: resolveRefreshMinutes(cfg) // until the device next wakes
  });
});

module.exports = router;
