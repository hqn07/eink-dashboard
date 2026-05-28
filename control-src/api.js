// Device-token plumbing. Server enforces auth when DEVICE_TOKEN is set
// in env; control panel attaches the token as a header on every API
// call. Token is sourced from (a) ?token=XXX in the URL on first load
// (then persisted to localStorage) or (b) localStorage from a prior
// visit. On 401 we surface a prompt so the user can paste it in.

const TOKEN_KEY = 'deviceToken';

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
  const merged = { ...opts, headers: authHeaders(opts.headers) };
  const r = await fetch(url, merged);
  if (r.status === 401) {
    // Surface a single, app-wide prompt so the user can paste a token.
    if (!window.__tokenPromptOpen) {
      window.__tokenPromptOpen = true;
      try {
        const entered = window.prompt(
          'Server requires DEVICE_TOKEN.\nPaste it here (or set ?token=… in the URL):'
        );
        if (entered) {
          setToken(entered.trim());
          window.location.reload();
          return r;
        }
      } finally {
        window.__tokenPromptOpen = false;
      }
    }
  }
  return r;
}

export async function fetchConfig() {
  const r = await authFetch('/api/config');
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}

export async function saveConfig(cfg) {
  const r = await authFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg)
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'save failed');
  return j.config;
}

export async function resetConfig() {
  const r = await authFetch('/api/config/reset', { method: 'POST' });
  if (!r.ok) throw new Error('reset failed');
  return r.json();
}

export async function fetchAlarms() {
  const r = await authFetch('/api/alarms');
  if (!r.ok) throw new Error(`alarms ${r.status}`);
  const j = await r.json();
  return Array.isArray(j.alarms) ? j.alarms : [];
}

export async function saveAlarms(alarms) {
  const r = await authFetch('/api/alarms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alarms })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'save alarms failed');
  return Array.isArray(j.alarms) ? j.alarms : [];
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

export async function weatherCheck({ city, lat, lon, units }) {
  const params = new URLSearchParams();
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    params.set('lat', lat); params.set('lon', lon);
  } else if (city) {
    params.set('city', city);
  } else {
    return { ok: false };
  }
  if (units) params.set('units', units);
  const r = await authFetch(`/api/weather-check?${params.toString()}`);
  if (!r.ok) return { ok: false };
  return r.json();
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
