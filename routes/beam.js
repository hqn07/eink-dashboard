// Beam to display — send a short message that takes over the panel for
// a few minutes. Pairs the beam store with the push-now fast-wake window
// so the device shows it on its next wake (worst case: one refresh
// interval; then it polls fast until the beam expires).
const router = require('express').Router();
const { checkAdminAuth } = require('../lib/auth');
const { getActiveBeam, setBeam, clearBeam, MAX_TEXT } = require('../lib/beam-store');
const { invalidateImage } = require('../lib/render');
const { pushNow, FAST_WINDOW_MS, FAST_INTERVAL_SECONDS } = require('../lib/refresh');
const { safeError } = require('../lib/http');

router.get('/api/beam', checkAdminAuth, async (req, res) => {
  res.json({ beam: await getActiveBeam() });
});

router.post('/api/beam', checkAdminAuth, async (req, res) => {
  try {
    const { text, minutes } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ ok: false, error: 'text required' });
    }
    if (text.length > MAX_TEXT) {
      return res.status(400).json({ ok: false, error: `text over ${MAX_TEXT} chars` });
    }
    const beam = await setBeam({ text, minutes });
    invalidateImage();
    const fastUntil = pushNow();
    res.json({ ok: true, beam, fastUntil, fastSeconds: FAST_INTERVAL_SECONDS, windowMs: FAST_WINDOW_MS });
  } catch (err) {
    res.status(500).json({ ok: false, ...safeError(err) });
  }
});

router.delete('/api/beam', checkAdminAuth, async (req, res) => {
  try {
    await clearBeam();
    invalidateImage();
    pushNow(); // pull the normal dashboard back quickly too
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, ...safeError(err) });
  }
});

module.exports = router;
