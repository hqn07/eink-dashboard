// widgets/macnowplaying.js
// Reads the macOS "Now Playing" state via the third-party
// `nowplaying-cli` binary (brew install nowplaying-cli). Captures any
// MediaSession-aware player including YouTube Music / Spotify Web in a
// browser tab.
//
// Output fields:
//   title, artist, album, isPlaying, durationSec, elapsedSec,
//   sourceLabel ("via SPOTIFY" / "via MUSIC" / etc.),
//   artworkBase64 (1-bit Floyd-Steinberg-dithered 160×160 PNG, or null
//                  when the source didn't expose album art).
//
// Returns null when off macOS, nowplaying-cli is missing, or nothing
// is currently playing. The renderer treats null as "MAC OFFLINE".

const { execFile } = require('child_process');
const { promisify } = require('util');
const status = require('./_status');
const { ditherImageToBase64 } = require('./_dither');
const macState = require('./_mac_state');
const execFileP = promisify(execFile);

// `MAC_FROM_CACHE=1` forces the read-from-cache path even on darwin,
// which is useful when running the cloud-mode pipeline locally for
// testing (lets dev verify the cache shape without standing up Linux).
const FROM_CACHE = process.env.MAC_FROM_CACHE === '1'
  || process.platform !== 'darwin';

const CACHE_MS = 5 * 1000;
let cached = null;

// Local HTTP API exposed by the pear-devs (formerly th-ch) YouTube Music
// desktop app's "API Server" plugin. nowplaying-cli can't see YouTube Music
// playing in Chrome (MediaRemote returns elapsedTime=0/infoUpdateTime=null),
// but this app exposes accurate position over localhost.
const YTM_URL = 'http://localhost:26538/api/v1/song-info';
let ytmArtCache = { src: null, b64: null };

const SOURCE_LABELS = {
  'com.spotify.client':            'SPOTIFY',
  'com.apple.Music':               'MUSIC',
  'com.apple.podcasts':            'PODCASTS',
  'com.google.Chrome':             'CHROME',
  'com.google.Chrome.canary':      'CHROME',
  'org.mozilla.firefox':           'FIREFOX',
  'com.apple.Safari':              'SAFARI',
  'com.brave.Browser':             'BRAVE',
  'company.thebrowser.Browser':    'ARC',
  'com.tidal.desktop':             'TIDAL'
};

async function readField(key, opts) {
  try {
    const { stdout } = await execFileP('nowplaying-cli', ['get', key], {
      timeout: 2500,
      maxBuffer: 12 * 1024 * 1024,    // album art can be big
      ...(opts || {})
    });
    return stdout;
  } catch {
    return '';
  }
}

// Album art: dither at 320x320 to match the largest art slot the
// widget renders. Shared FS implementation lives in widgets/_dither.js
// so other widgets can reuse it.
async function ditherArtwork(rawBuf) {
  return ditherImageToBase64(rawBuf, { size: 320, fit: 'cover' });
}

async function fetchArtwork() {
  // nowplaying-cli `get artworkData` returns the image as base64 ASCII
  // (verified against the macOS MediaRemote bridge — output starts with
  // `/9j/` for JPEG or `iVBO` for PNG). Some forks have a `get-raw`
  // subcommand that emits binary, but it's not standard, so don't
  // bother trying it; just decode base64 unconditionally.
  try {
    const { stdout } = await execFileP('nowplaying-cli',
      ['get', 'artworkData'], {
      timeout: 3000,
      maxBuffer: 12 * 1024 * 1024
    });
    const trimmed = (stdout || '').trim();
    if (trimmed.length < 200) return null;
    const bytes = Buffer.from(trimmed, 'base64');
    if (bytes.length < 200) return null;
    return await ditherArtwork(bytes);
  } catch {
    return null;
  }
}

function parseFloatSafe(s) {
  const n = parseFloat(String(s || '').trim());
  return Number.isFinite(n) ? n : null;
}

async function fetchYtmArtwork(src) {
  if (!src) return null;
  if (ytmArtCache.src === src && ytmArtCache.b64) return ytmArtCache.b64;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = await ditherArtwork(buf);
    ytmArtCache = { src, b64 };
    return b64;
  } catch {
    return null;
  }
}

async function fetchYtMusic() {
  try {
    const res = await fetch(YTM_URL, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || !j.title) return null;
    const artwork = await fetchYtmArtwork(j.imageSrc);
    return {
      title: String(j.title || ''),
      artist: String(j.artist || ''),
      album: String(j.album || ''),
      isPlaying: !j.isPaused,
      durationSec: Number.isFinite(j.songDuration) ? j.songDuration : null,
      elapsedSec: Number.isFinite(j.elapsedSeconds) ? j.elapsedSeconds : null,
      sourceLabel: 'YT MUSIC',
      artworkBase64: artwork
    };
  } catch {
    return null;
  }
}

async function fetchMacNowPlaying() {
  if (FROM_CACHE) {
    // Cloud / non-darwin path: read the latest agent push from the
    // shared on-disk cache. Stale entries (>STALE_MS) resolve to null
    // so the renderer shows "MAC OFFLINE" instead of a frozen song.
    const s = await macState.read();
    if (!s || !macState.fresh(s.at)) return null;
    return s.nowplaying || null;
  }
  if (cached && (Date.now() - cached.at) < CACHE_MS) {
    status.cacheHit('mac_nowplaying');
    return cached.data;
  }
  const t0 = Date.now();
  // YouTube Music desktop app (if running) exposes accurate position over
  // localhost — prefer it over nowplaying-cli which returns 0 for YT Music.
  const ytm = await fetchYtMusic();
  if (ytm) {
    cached = { at: Date.now(), data: ytm };
    status.record('mac_nowplaying', { ok: true, ms: Date.now() - t0 });
    return ytm;
  }
  try {
    const [titleR, artistR, albumR, rateR, durR, elapR, updateR, bundleR] = await Promise.all([
      readField('title'),
      readField('artist'),
      readField('album'),
      readField('playbackRate'),
      readField('duration'),
      readField('elapsedTime'),
      readField('infoUpdateTime'),
      readField('bundleIdentifier')
    ]);
    const title = titleR.trim();
    if (!title) {
      cached = { at: Date.now(), data: null };
      status.record('mac_nowplaying', { ok: true, ms: Date.now() - t0 });
      return null;
    }
    const artwork = await fetchArtwork();
    const bundleRaw = bundleR.trim();
    // nowplaying-cli can print the literal string "null" when MediaRemote
    // doesn't expose a bundle id for the current source — filter that out
    // so the tile doesn't render "via NULL".
    const bundle = (bundleRaw && bundleRaw.toLowerCase() !== 'null') ? bundleRaw : '';
    const label = bundle
      ? (SOURCE_LABELS[bundle] || bundle.split('.').pop().toUpperCase())
      : '';
    const isPlaying = (parseFloat(rateR) || 0) > 0;
    // nowplaying-cli's `elapsedTime` is a snapshot — only updated when
    // the media player emits a state change (play/pause/seek). When the
    // song is just steadily playing the field stays frozen, which made
    // the dashboard's progress bar look broken. Add the wall-clock delta
    // since the last update to get the actual playback position.
    let elapsed = parseFloatSafe(elapR);
    const infoUpdateSec = parseFloatSafe(updateR);
    // Some sources (notably YouTube Music in Chrome) don't expose
    // position state at all: elapsedTime comes back as `0` and
    // infoUpdateTime as `null`. Distinguish that "unknown" case from
    // "song genuinely at second 0" so the renderer can hide the
    // progress bar instead of pinning it permanently at zero.
    if (!Number.isFinite(infoUpdateSec) && elapsed === 0) {
      elapsed = null;
    } else if (isPlaying && Number.isFinite(elapsed) && Number.isFinite(infoUpdateSec)) {
      const driftSec = (Date.now() / 1000) - infoUpdateSec;
      if (driftSec > 0 && driftSec < 24 * 60 * 60) {
        elapsed += driftSec;
      }
    }
    const data = {
      title,
      artist: artistR.trim(),
      album:  albumR.trim(),
      isPlaying,
      durationSec: parseFloatSafe(durR),
      elapsedSec: elapsed,
      sourceLabel: label,
      artworkBase64: artwork
    };
    cached = { at: Date.now(), data };
    status.record('mac_nowplaying', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('mac_nowplaying', { ok: false, ms: Date.now() - t0, err: err.message });
    return null;
  }
}

module.exports = { fetchMacNowPlaying };
