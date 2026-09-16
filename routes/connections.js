// Connections — provider credentials, kept out of the exportable config.
//
// The value only ever travels inbound. `GET` answers with presence, source and
// the last four characters; there is no endpoint that returns a key, because
// the editor never needs one and an endpoint that could hand one back is an
// endpoint that can be tricked into handing one back.
const router = require('express').Router();
const { checkAdminAuth } = require('../lib/auth');
const { SECRET_KEYS, setSecret, describeAll } = require('../lib/secrets-store');
const { safeError } = require('../lib/http');

// Long enough to catch an empty paste, short enough to refuse a pasted file.
const MAX_SECRET_LEN = 512;

router.get('/api/connections', checkAdminAuth, async (req, res) => {
  try {
    res.json({ secrets: await describeAll() });
  } catch (err) {
    console.error('connections read error:', err);
    res.status(500).json(safeError(err));
  }
});

router.patch('/api/connections', checkAdminAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'body must be an object' });
    }
    const applied = [];
    for (const name of Object.keys(body)) {
      if (!SECRET_KEYS.includes(name)) {
        return res.status(400).json({ error: `unknown field: ${name}` });
      }
      const v = body[name];
      // null/'' is the documented way to clear a secret and fall back to the
      // environment variable, so it is valid input, not a malformed one.
      if (v !== null && typeof v !== 'string') {
        return res.status(400).json({ error: `${name} must be a string or null` });
      }
      if (typeof v === 'string' && v.length > MAX_SECRET_LEN) {
        return res.status(400).json({ error: `${name} is too long` });
      }
      await setSecret(name, v || '');
      applied.push(name);
    }
    // Echo the description, never the value — so the UI can update its masked
    // display from the response without the key making a round trip.
    res.json({ ok: true, applied, secrets: await describeAll() });
  } catch (err) {
    // The error could carry the value it choked on; log our own sentence.
    console.error('connections write error');
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
