// Shared fetch wrapper with a hard timeout AND a hard size cap. Every
// external HTTP call the widgets make must go through this so a slow
// upstream can't hang the Railway dyno's render queue, and a large one
// can't exhaust its memory.
const dns = require('dns').promises;
const net = require('net');

const DEFAULT_TIMEOUT_MS = 8000;
// Generous for a feed or a JSON API; callers handling images raise it.
// An iCal feed with a decade of recurring events is well under 2 MB.
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// Read a response body with a running byte count, and present the result
// through the same three accessors every caller already uses.
//
// Why not just trust content-length: it is advisory, absent on chunked
// responses, and trivially wrong on a hostile one. So it is checked first as
// a cheap early out, then the actual bytes are counted as they arrive and the
// stream is cancelled the moment the cap is passed — the point is to never
// hold more than `maxBytes` in memory, not to detect it afterwards.
function capBody(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  let cached = null;

  const read = async () => {
    if (Number.isFinite(declared) && declared > maxBytes) {
      try { await res.body?.cancel(); } catch { /* already gone */ }
      throw new Error(`response too large: ${declared} B > ${maxBytes} B`);
    }
    const reader = res.body && typeof res.body.getReader === 'function'
      ? res.body.getReader() : null;
    // No stream (empty body, or a runtime without one) — arrayBuffer is
    // bounded by the content-length check above.
    if (!reader) return Buffer.from(await res.arrayBuffer());

    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* already gone */ }
        throw new Error(`response too large: exceeded ${maxBytes} B`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  };

  const body = () => (cached || (cached = read()));

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    url: res.url,
    // Discard an unread body so the socket is released rather than parked
    // until GC — matters on the redirect path, which reads nothing.
    async cancel() { try { await res.body?.cancel(); } catch { /* already gone */ } },
    async arrayBuffer() {
      const b = await body();
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
    async text() { return (await body()).toString('utf8'); },
    async json() { return JSON.parse((await body()).toString('utf8')); },
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS,
                                maxBytes = DEFAULT_MAX_BYTES) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return capBody(await fetch(url, { ...options, signal: ctrl.signal }), maxBytes);
  } finally {
    clearTimeout(id);
  }
}

// ---------- SSRF guard for user-supplied URLs ----------
// Feeds/images whose URL comes from tile settings (photo, headlines, tasks)
// could point at the loopback interface, a private LAN host, or the cloud
// metadata endpoint (169.254.169.254) to exfiltrate credentials. Block those.
// The server runs in the cloud (Railway), so no legitimate feed lives on a
// private/loopback address anyway. Not needed for fixed first-party URLs
// (Todoist, hnrss, MTA).

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;                          // 10.0.0.0/8
    if (p[0] === 127) return true;                         // loopback
    if (p[0] === 169 && p[1] === 254) return true;         // link-local + metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true;         // 192.168/16
    if (p[0] === 0 || p[0] >= 224) return true;            // this-host / multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;            // loopback / unspecified
    if (l.startsWith('fe80')) return true;                 // link-local
    if (l.startsWith('fc') || l.startsWith('fd')) return true; // unique-local
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7)); // v4-mapped
    return false;
  }
  return true; // unparseable → treat as unsafe
}

// Throws when the URL isn't a public http(s) endpoint. Resolves the host so a
// domain that points at an internal IP is caught, not just literal-IP URLs.
async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('bad url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('unsupported protocol');
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (/^localhost$/i.test(host) || /\.local$/i.test(host)) throw new Error('blocked host');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('blocked address');
    return;
  }
  const results = await dns.lookup(host, { all: true });
  if (!results.length || results.some(r => isPrivateIp(r.address))) throw new Error('blocked address');
}

// Convenience: guard + fetch. Use for any URL that originates from user input.
//
// Redirects are followed BY HAND, one hop at a time, because the guard has to
// run on every hop. `fetch` defaults to redirect:'follow', which validated the
// first URL and then followed a 302 to anywhere — a public host redirecting to
// 169.254.169.254 or 127.0.0.1 walked straight through assertPublicUrl.
//
// Still not a complete defence: assertPublicUrl resolves the hostname and then
// fetch resolves it again, so a hostile resolver can answer public once and
// private once (DNS rebinding). Closing that needs the connection pinned to
// the resolved IP via a custom undici dispatcher. Worth doing before anything
// multi-tenant ships; not worth it while the only person who can set a URL
// here is the panel's owner.
// `guard` is a seam, and it exists for one reason: a test server can only bind
// to loopback, which assertPublicUrl blocks at hop 0 — so with the real guard
// hard-wired the hop loop is untestable, and a test that "passes" is only
// re-proving that localhost is blocked. Production callers never pass it.
async function fetchPublicUrl(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS,
                              maxBytes = DEFAULT_MAX_BYTES, guard = assertPublicUrl) {
  let current = String(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await guard(current);
    const res = await fetchWithTimeout(
      current, { ...options, redirect: 'manual' }, timeoutMs, maxBytes);
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get('location');
    if (!loc) return res;            // 3xx with no Location: hand it back as-is
    await res.cancel();              // release the socket; we never read a redirect body
    current = new URL(loc, current).toString();   // resolves relative Locations
  }
  throw new Error('too many redirects');
}

module.exports = {
  fetchWithTimeout, fetchPublicUrl, assertPublicUrl, isPrivateIp,
  DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES, MAX_REDIRECTS,
};
