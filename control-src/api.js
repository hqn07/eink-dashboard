export async function fetchConfig() {
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}

export async function saveConfig(cfg) {
  const r = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg)
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'save failed');
  return j.config;
}

export function previewUrl(cacheBust = true) {
  return '/display.png' + (cacheBust ? `?t=${Date.now()}` : '');
}

export async function fetchPreviewData(screen) {
  const r = await fetch(`/api/preview-data?screen=${screen}`);
  if (!r.ok) throw new Error(`preview-data ${r.status}`);
  return r.json();
}

export async function geocode(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return r.json();
}

export async function reverseGeocode(lat, lon) {
  const r = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
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
  const r = await fetch(`/api/weather-check?${params.toString()}`);
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
