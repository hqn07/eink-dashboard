// Mac-agent push endpoints. The Mac-side agent POSTs now-playing + battery
// state; the ESP32 only ever reads the cloud, so these light up the
// mac_nowplaying / mac_battery tiles. Writes are serialized to avoid an
// artwork-dedup race, and only render-visible changes invalidate the image.
const router = require('express').Router();
const { checkAdminAuth } = require('../lib/auth');
const { invalidateImage } = require('../lib/render');
const { safeError } = require('../lib/http');
const macStateMod = require('../widgets/_mac_state');

// Serialize mac-state writes so two concurrent agent pushes can't both read
// `_lastTrackKey`, decide they're the same track, and race to write — which
// would leave the artwork stuck null even after the song actually changed.
let _macStateChain = Promise.resolve();
let _lastTrackKey = null;

router.post('/api/mac-state', checkAdminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const np = body.nowplaying || null;
    const bt = body.battery || null;
    const trackKey = typeof body.trackKey === 'string' ? body.trackKey : null;

    const result = await (_macStateChain = _macStateChain.then(async () => {
      const prev = await macStateMod.read();
      let mergedNp = np;
      // Artwork-less push for an unchanged track: keep the stored art. The
      // known key comes from memory OR the persisted state file — the on-disk
      // fallback matters after a server restart, when the agent (mid-song)
      // keeps omitting artwork but `_lastTrackKey` was wiped.
      const knownKey = _lastTrackKey || (prev && prev.trackKey) || null;
      if (np && !('artworkBase64' in np) && trackKey && trackKey === knownKey) {
        const prevArt = prev && prev.nowplaying && prev.nowplaying.artworkBase64;
        mergedNp = { ...np, artworkBase64: prevArt || null };
      }
      if (trackKey) _lastTrackKey = trackKey;
      await macStateMod.write({ nowplaying: mergedNp, battery: bt, trackKey });
      // Only force a re-render when the rendered payload actually changed.
      // Battery percent ticking 87 → 86 is a real change; an identical no-op
      // push (same song, same battery) shouldn't burn a Puppeteer cycle.
      const changed = !sameMacState(prev, { nowplaying: mergedNp, battery: bt });
      if (changed) invalidateImage();
      return changed;
    }).catch(err => {
      console.error('mac-state chain error:', err);
      throw err;
    }));

    res.json({ ok: true, changed: result });
  } catch (err) {
    console.error('mac-state error:', err);
    res.status(500).json(safeError(err));
  }
});

// Compare two mac-state snapshots for render-visible equality. Artwork is
// hashed by length so the bytes themselves don't blow the comparison up.
function sameMacState(a, b) {
  const npA = (a && a.nowplaying) || null;
  const npB = (b && b.nowplaying) || null;
  if (!npA !== !npB) return false;
  if (npA && npB) {
    if (npA.title !== npB.title) return false;
    if (npA.artist !== npB.artist) return false;
    if (npA.album !== npB.album) return false;
    if (npA.isPlaying !== npB.isPlaying) return false;
    if (Math.round((npA.elapsedSec || 0) / 5) !== Math.round((npB.elapsedSec || 0) / 5)) return false;
    if ((npA.artworkBase64 || '').length !== (npB.artworkBase64 || '').length) return false;
    if (npA.sourceLabel !== npB.sourceLabel) return false;
  }
  const btA = (a && a.battery) || null;
  const btB = (b && b.battery) || null;
  if (!btA !== !btB) return false;
  if (btA && btB) {
    if (btA.percent !== btB.percent) return false;
    if (btA.state !== btB.state) return false;
  }
  return true;
}

router.get('/api/mac-state', checkAdminAuth, async (req, res) => {
  const s = await macStateMod.read();
  res.json(s || { nowplaying: null, battery: null, at: null });
});

module.exports = router;
