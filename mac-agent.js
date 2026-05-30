#!/usr/bin/env node
// Mac-side push agent. Polls the local macOS state (now playing +
// battery) using the same widget fetchers the server uses, then POSTs
// to a remote dashboard server's /api/mac-state. Dedupes artwork by
// track key so an unchanged song doesn't re-send the ~150KB base64
// payload on every cycle.
//
// Env vars:
//   CLOUD_URL       — base URL of the cloud server. Required.
//   DEVICE_TOKEN    — auth token (matches the server's DEVICE_TOKEN).
//                     Sent as X-Device-Token; falls back to ?token=
//                     for transports that strip headers.
//   MAC_AGENT_INTERVAL_MS — push cadence in ms. Default 30000.
//
// Run: `CLOUD_URL=https://eink.example.com DEVICE_TOKEN=xxx \
//       node mac-agent.js`
// or:  `npm run mac-agent` (set vars in .env first).

require('dotenv').config();

// This agent always wants to spawn the local Mac bridges, never read
// from a remote cache. The widget modules check the FROM_CACHE flag
// at require-time, so clear the env var before they load.
delete process.env.MAC_FROM_CACHE;

const { fetchMacNowPlaying } = require('./widgets/macnowplaying');
const { fetchMacBattery } = require('./widgets/macbattery');

const CLOUD_URL = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const INTERVAL_MS = Math.max(5000, parseInt(process.env.MAC_AGENT_INTERVAL_MS, 10) || 30000);

if (!CLOUD_URL) {
  console.error('CLOUD_URL env var required (e.g. https://eink.example.com)');
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.error('mac-agent is meant to run on macOS — current platform is ' + process.platform);
  // Don't hard-exit: someone might be testing on Linux with mocked fetchers.
}

let lastTrackKey = null;

function trackKeyOf(np) {
  if (!np) return null;
  return [np.title || '', np.artist || '', np.album || ''].join('\0');
}

async function pushOnce() {
  const t0 = Date.now();
  const [np, bt] = await Promise.all([
    fetchMacNowPlaying().catch(() => null),
    fetchMacBattery().catch(() => null)
  ]);

  const key = trackKeyOf(np);
  let payload;
  if (np) {
    if (key && key === lastTrackKey) {
      // Same song as last push — skip the artwork payload. Server keeps
      // the previously stored frame so the widget stays visually stable.
      const { artworkBase64, ...lean } = np;
      payload = { nowplaying: lean, battery: bt, trackKey: key };
    } else {
      payload = { nowplaying: np, battery: bt, trackKey: key };
    }
  } else {
    payload = { nowplaying: null, battery: bt, trackKey: null };
  }

  const url = `${CLOUD_URL}/api/mac-state${DEVICE_TOKEN ? `?token=${encodeURIComponent(DEVICE_TOKEN)}` : ''}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(DEVICE_TOKEN ? { 'X-Device-Token': DEVICE_TOKEN } : {})
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`[mac-agent] push ${res.status}: ${txt.slice(0, 200)}`);
      return;
    }
    lastTrackKey = key;
    const dt = Date.now() - t0;
    const sentArt = !!(payload.nowplaying && payload.nowplaying.artworkBase64);
    const songLabel = np ? `${np.artist || '?'} — ${np.title || '?'}` : 'no song';
    console.log(`[mac-agent] ok (${dt}ms) ${sentArt ? '+art' : '    '}  ${songLabel}`);
  } catch (err) {
    console.warn(`[mac-agent] push failed: ${err.message}`);
  }
}

console.log(`[mac-agent] pushing ${CLOUD_URL}/api/mac-state every ${INTERVAL_MS}ms`);
pushOnce();
setInterval(pushOnce, INTERVAL_MS);
