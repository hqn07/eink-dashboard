// Device-token plumbing. Server enforces auth when DEVICE_TOKEN is set
// in env; control panel attaches the token as a header on every API
// call. Token is sourced from (a) ?token=XXX in the URL on first load
// (then persisted to localStorage) or (b) localStorage from a prior
// visit. On 401 we surface a prompt so the user can paste it in.

const TOKEN_KEY = 'deviceToken';

// Registered by the app so it can flip into read-only mode when the server
// rejects us (401) and we have no working credential. Without this the
// editor stays interactive client-side even though nothing can be saved.
let _onUnauthorized = null;
export function onUnauthorized(fn) { _onUnauthorized = fn; }

function readUrlToken() {
  try {
    const u = new URL(window.location.href);
    const t = u.searchParams.get('token');
    if (t) {
      localStorage.setItem(TOKEN_KEY, t);
      // Strip ?token from the URL so it doesn't linger in history.
      u.searchParams.delete('token');
      window.history.replaceState({}, '', u.toString());
      return t;
    }
  } catch (_) {}
  return null;
}

function getToken() {
  const fromUrl = readUrlToken();
  if (fromUrl) return fromUrl;
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
}

export function setToken(tok) {
  try {
    if (tok) localStorage.setItem(TOKEN_KEY, tok);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
}

function authHeaders(extra) {
  const tok = getToken();
  const h = { ...(extra || {}) };
  if (tok) h['X-Device-Token'] = tok;
  return h;
}

async function authFetch(url, opts = {}) {
  // Hard timeout so a hung/unreachable server surfaces an error instead of
  // spinning the UI forever. Callers may pass their own signal/timeoutMs.
  const merged = {
    ...opts,
    headers: authHeaders(opts.headers),
    signal: opts.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(opts.timeoutMs || 15000) : undefined)
  };
  let r;
  try {
    r = await fetch(url, merged);
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error('Request timed out — server not responding');
    }
    throw new Error('Network error — can’t reach the server');
  }
  if (r.status === 401) {
    // Surface a single, app-wide prompt so the user can paste a token —
    // but only when we don't already have one (a present-yet-rejected token
    // means prompting again won't help).
    if (!getToken() && !window.__tokenPromptOpen) {
      window.__tokenPromptOpen = true;
      try {
        const entered = window.prompt(
          'Server requires a device token to edit.\nPaste it here (or open the editor with ?token=… in the URL):'
        );
        if (entered && entered.trim()) {
          setToken(entered.trim());
          window.location.reload();
          return r;
        }
      } finally {
        window.__tokenPromptOpen = false;
      }
    }
    // Still unauthorized (no token, prompt cancelled, or token rejected):
    // tell the app so it can lock the editor read-only.
    if (_onUnauthorized) _onUnauthorized();
  }
  return r;
}

export async function fetchConfig() {
  const r = await authFetch('/api/config');
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}

// Retry a request fn on transient failures (rate-limit, 5xx, network/timeout)
// with a short backoff, so an editing burst that trips the limiter or a
// momentary blip recovers on its own instead of failing the save.
async function withRetry(fn, { tries = 3, baseMs = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const transient = (e && e.retryable) || /network|timed out/i.test(e && e.message || '');
      if (!transient || i === tries - 1) throw e;
      await new Promise(res => setTimeout(res, baseMs * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function friendlySaveError(status, raw) {
  if (status === 429 || /rate_limited/i.test(raw)) return 'Too many requests — please wait a moment';
  if (status >= 500) return 'Server error — try again';
  if (status === 401 || status === 403) return 'Not authorized to save';
  return raw || `Save failed (${status})`;
}

export async function saveConfig(cfg) {
  return withRetry(async () => {
    const r = await authFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    if (r.status === 429 || r.status >= 500) {
      const e = new Error(friendlySaveError(r.status, ''));
      e.retryable = true;
      e.status = r.status;
      throw e;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(friendlySaveError(r.status, j.error));
    return j.config;
  });
}

export async function resetConfig() {
  const r = await authFetch('/api/config/reset', { method: 'POST' });
  if (!r.ok) throw new Error('reset failed');
  return r.json();
}


export function previewUrl(cacheBust = true) {
  const t = getToken();
  const parts = [];
  if (cacheBust) parts.push(`t=${Date.now()}`);
  if (t) parts.push(`token=${encodeURIComponent(t)}`);
  return '/display.png' + (parts.length ? `?${parts.join('&')}` : '');
}

export async function fetchPreviewData(screen) {
  const r = await authFetch(`/api/preview-data?screen=${screen}`);
  if (!r.ok) throw new Error(`preview-data ${r.status}`);
  return r.json();
}

export async function fetchBattery() {
  const r = await authFetch('/api/battery');
  if (!r.ok) throw new Error(`battery ${r.status}`);
  return r.json();
}

// Enrolled devices + last-seen telemetry — { devices: [{ friendly_id,
// fw_version, board, screen, last_seen_at, ... }] }.
export async function fetchDevices() {
  const r = await authFetch('/api/devices');
  if (!r.ok) throw new Error(`devices ${r.status}`);
  return r.json();
}

// URL for the human /status page with the device token attached (it's a
// full navigation, so the X-Device-Token header path doesn't apply).
// PIN-cookie sessions work with the bare path.
export function statusPageUrl() {
  const tok = getToken();
  return tok ? `/status?token=${encodeURIComponent(tok)}` : '/status';
}

// Beam a takeover message to the panel. Returns { ok, beam, fastUntil,
// maxLatency info } from the server.
export async function sendBeam(text, minutes) {
  const r = await authFetch('/api/beam', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, minutes })
  });
  if (!r.ok) throw new Error(`beam ${r.status}`);
  return r.json();
}

export async function clearBeam() {
  const r = await authFetch('/api/beam', { method: 'DELETE' });
  if (!r.ok) throw new Error(`beam clear ${r.status}`);
  return r.json();
}

// Direct-src URL for an externalized photo upload (img/canvas loads can't
// send the auth header, so the token rides the query string).
export function uploadPhotoUrl(ref) {
  const tok = getToken();
  return `/api/upload/photo/${encodeURIComponent(ref)}${tok ? `?token=${encodeURIComponent(tok)}` : ''}`;
}

// Single-widget PNG render — used by the settings modal preview to
// show the bit-identical e-ink output of the current draft settings
// after a debounce. Returns a Blob or throws on non-200.
export async function fetchPreviewPng(body) {
  const r = await authFetch('/api/preview-render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`preview-render ${r.status}`);
  return r.blob();
}

export async function geocode(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const r = await authFetch(`/api/geocode?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return r.json();
}

export async function reverseGeocode(lat, lon) {
  const r = await authFetch(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
  if (!r.ok) return null;
  return r.json();
}

// Control-panel PIN. status → { configured, authed }. setPin sets/changes
// the PIN (first run is open; later requires the active session, which the
// editor has). Returns true on success.
export async function authStatus() {
  const r = await authFetch('/api/auth/status');
  if (!r.ok) return { configured: false, authed: false };
  return r.json();
}
export async function setPin(pin) {
  const r = await authFetch('/api/auth/set-pin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  return r.ok;
}

// Unicode flag from 2-letter ISO country code. Falls back to globe.
export function flagEmoji(cc) {
  if (!cc || typeof cc !== 'string' || cc.length !== 2) return '🌍';
  const A = 0x1F1E6;
  const a = cc.toUpperCase().charCodeAt(0) - 65;
  const b = cc.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return '🌍';
  return String.fromCodePoint(A + a, A + b);
}
