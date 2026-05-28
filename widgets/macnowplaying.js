// widgets/macnowplaying.js
// Reads the macOS "Now Playing" state via the third-party
// `nowplaying-cli` binary. Captures any MediaSession-aware player
// (Apple Music, Spotify, YouTube Music in a browser tab, etc.).
//
// Returns null when:
//   - not running on macOS (Railway / Linux server)
//   - nowplaying-cli not installed (brew install nowplaying-cli)
//   - nothing is currently playing
//
// The renderer treats null as "MAC OFFLINE".
const { execFile } = require('child_process');
const { promisify } = require('util');
const status = require('./_status');
const execFileP = promisify(execFile);
const CACHE_MS = 5 * 1000;  // tracks change fast; short cache
let cached = null;

async function readField(key) {
  try {
    const { stdout } = await execFileP('nowplaying-cli', ['get', key], { timeout: 2000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function fetchMacNowPlaying() {
  if (process.platform !== 'darwin') return null;
  if (cached && (Date.now() - cached.at) < CACHE_MS) {
    status.cacheHit('mac_nowplaying');
    return cached.data;
  }
  const t0 = Date.now();
  try {
    const [title, artist, album, rate] = await Promise.all([
      readField('title'),
      readField('artist'),
      readField('album'),
      readField('playbackRate')
    ]);
    if (!title) {
      status.record('mac_nowplaying', { ok: true, ms: Date.now() - t0 });
      cached = { at: Date.now(), data: null };
      return null;
    }
    const data = {
      title,
      artist,
      album,
      isPlaying: parseFloat(rate) > 0
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
