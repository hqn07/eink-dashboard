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
