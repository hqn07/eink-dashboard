// Webhook ingest — the push half of the `webhook` widget. POST any JSON
// object to /api/webhook/:key (device token or per-device API key auth,
// same credential scripts already use for /api/battery) and the widget
// configured with that key renders it on the next panel refresh.
const router = require('express').Router();
const { checkDeviceAuth, checkAdminAuth } = require('../lib/auth');
const { loadWebhook, saveWebhook } = require('../lib/webhook-store');
const { invalidateImage } = require('../lib/render');

const KEY_RE = /^[a-z0-9_-]{1,32}$/i;
// Panel is 800×480 — anything beyond a few KB can't render anyway.
const MAX_PAYLOAD_BYTES = 4096;

router.post('/api/webhook/:key', checkDeviceAuth, async (req, res) => {
  const key = String(req.params.key || '');
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'bad_key' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'json_object_required' });
  }
  if (JSON.stringify(body).length > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: 'payload_too_large', max: MAX_PAYLOAD_BYTES });
  }
  const changed = await saveWebhook(key, body);
  // Bust the render cache so the next device wake picks the new payload up
  // — but only when the payload actually changed. A script re-POSTing the
  // same JSON on a timer shouldn't trigger a Puppeteer re-render per POST.
  if (changed) invalidateImage();
  res.json({ ok: true, key, changed });
});

// Admin: inspect the stored payload for a key (debugging aid).
router.get('/api/webhook/:key', checkAdminAuth, async (req, res) => {
  const key = String(req.params.key || '');
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'bad_key' });
  const entry = await loadWebhook(key);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  res.json({ key, ...entry });
});

module.exports = router;
