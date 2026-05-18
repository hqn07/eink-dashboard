// Build a WIFI: payload QR code SVG. Caches per-input to avoid regen.
const QRCode = require('qrcode');

const cache = new Map(); // key: payload → svg

function escapeWifi(s) {
  return String(s || '').replace(/([\\;,"':])/g, '\\$1');
}

async function buildWifiQrSvg(wifi) {
  if (!wifi || !wifi.ssid) return null;
  const security = wifi.security || 'WPA';
  const payload = `WIFI:T:${security};S:${escapeWifi(wifi.ssid)};P:${escapeWifi(wifi.password || '')};${wifi.hidden ? 'H:true;' : ''};`;
  if (cache.has(payload)) return cache.get(payload);
  try {
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' }
    });
    // Strip XML decl + ensure responsive sizing.
    const cleaned = svg
      .replace(/<\?xml[^>]*\?>/, '')
      .replace(/<svg /, '<svg preserveAspectRatio="xMidYMid meet" ');
    cache.set(payload, cleaned);
    return cleaned;
  } catch {
    return null;
  }
}

module.exports = { buildWifiQrSvg };
