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
const sharp = require('sharp');
const status = require('./_status');
const execFileP = promisify(execFile);

const CACHE_MS = 5 * 1000;
let cached = null;

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

// Convert nowplaying-cli's raw artwork bytes (jpeg/png) into a 160x160
// 1-bit Floyd-Steinberg dithered PNG, base64-encoded for embedding in
// the dashboard HTML.
async function ditherArtwork(rawBuf) {
  const SIZE = 160;
  // Greyscale + resize first.
  const { data, info } = await sharp(rawBuf)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  // Use signed buffer so we can carry errors below zero.
  const buf = new Int16Array(w * h);
  for (let i = 0; i < buf.length; i++) buf[i] = data[i];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const oldVal = buf[i];
      const newVal = oldVal < 128 ? 0 : 255;
      buf[i] = newVal;
      const err = oldVal - newVal;
      if (x + 1 < w)         buf[i + 1] += (err * 7) >> 4;
      if (y + 1 < h) {
        if (x - 1 >= 0)      buf[i + w - 1] += (err * 3) >> 4;
                             buf[i + w]     += (err * 5) >> 4;
        if (x + 1 < w)       buf[i + w + 1] += (err * 1) >> 4;
      }
    }
  }
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] > 127 ? 255 : 0;
  }
  const png = await sharp(out, {
    raw: { width: w, height: h, channels: 1 }
  }).png({ compressionLevel: 9 }).toBuffer();
  return png.toString('base64');
}

async function fetchArtwork() {
  // nowplaying-cli prints the raw bytes when format=raw. Without it,
  // older versions of the CLI return base64.
  try {
    const { stdout } = await execFileP('nowplaying-cli',
      ['get-raw', 'artworkData'], {
      timeout: 3000,
      maxBuffer: 12 * 1024 * 1024,
      encoding: 'buffer'
    }).catch(() => execFileP('nowplaying-cli', ['get', 'artworkData'], {
      timeout: 3000,
      maxBuffer: 12 * 1024 * 1024,
      encoding: 'buffer'
    }));
    if (!stdout || stdout.length < 200) return null;
    // get-raw outputs the binary directly; `get` might base64-encode
    // (decimal ASCII range). Detect heuristically: if the first bytes
    // look like a JPEG/PNG magic, use as-is.
    const head = stdout.slice(0, 4);
    const looksJpeg = head[0] === 0xFF && head[1] === 0xD8;
    const looksPng  = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47;
    let bytes;
    if (looksJpeg || looksPng) {
      bytes = stdout;
    } else {
      // Treat as base64 ASCII.
      try {
        bytes = Buffer.from(stdout.toString('ascii').trim(), 'base64');
      } catch {
        return null;
      }
    }
    if (!bytes || bytes.length < 200) return null;
    return await ditherArtwork(bytes);
  } catch {
    return null;
  }
}

function parseFloatSafe(s) {
  const n = parseFloat(String(s || '').trim());
  return Number.isFinite(n) ? n : null;
}

async function fetchMacNowPlaying() {
  if (process.platform !== 'darwin') return null;
  if (cached && (Date.now() - cached.at) < CACHE_MS) {
    status.cacheHit('mac_nowplaying');
    return cached.data;
  }
  const t0 = Date.now();
  try {
    const [titleR, artistR, albumR, rateR, durR, elapR, bundleR] = await Promise.all([
      readField('title'),
      readField('artist'),
      readField('album'),
      readField('playbackRate'),
      readField('duration'),
      readField('elapsedTime'),
      readField('bundleIdentifier')
    ]);
    const title = titleR.trim();
    if (!title) {
      cached = { at: Date.now(), data: null };
      status.record('mac_nowplaying', { ok: true, ms: Date.now() - t0 });
      return null;
    }
    const artwork = await fetchArtwork();
    const bundle = bundleR.trim();
    const label = SOURCE_LABELS[bundle] || (bundle ? bundle.split('.').pop().toUpperCase() : '');
    const data = {
      title,
      artist: artistR.trim(),
      album:  albumR.trim(),
      isPlaying: (parseFloat(rateR) || 0) > 0,
      durationSec: parseFloatSafe(durR),
      elapsedSec:  parseFloatSafe(elapR),
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
