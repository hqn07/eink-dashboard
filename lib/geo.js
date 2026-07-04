// Outbound JSON fetch with a hard timeout. Node's fetch has no built-in
// timeout, so a slow upstream (Open-Meteo, Nominatim, etc.) would otherwise
// hang the request indefinitely. 10s covers normal latency with headroom.
async function jsonFetch(url, opts = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000), ...opts });
  if (!r.ok) throw new Error(`${url.split('?')[0]} → ${r.status}`);
  return r.json();
}

module.exports = { jsonFetch };
