// Shared fetch wrapper with a hard timeout. Every external HTTP call
// the widgets make must go through this so a slow upstream can't hang
// the Railway dyno's render queue.
const dns = require('dns').promises;
const net = require('net');

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
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
async function fetchPublicUrl(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  await assertPublicUrl(url);
  return fetchWithTimeout(url, options, timeoutMs);
}

module.exports = { fetchWithTimeout, fetchPublicUrl, assertPublicUrl, isPrivateIp, DEFAULT_TIMEOUT_MS };
