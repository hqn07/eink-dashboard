// Build a plain-URL QR code SVG. Mirrors wifi.js but for arbitrary
// URLs (or any text payload).
const QRCode = require('qrcode');

const cache = new Map(); // payload → svg

async function buildLinkQrSvg(linkQr) {
  if (!linkQr || !linkQr.url) return null;
  const payload = String(linkQr.url);
  if (cache.has(payload)) return cache.get(payload);
  try {
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' }
    });
    const cleaned = svg
      .replace(/<\?xml[^>]*\?>/, '')
      .replace(/<svg /, '<svg preserveAspectRatio="xMidYMid meet" ');
    if (cache.size > 16) cache.clear();
    cache.set(payload, cleaned);
    return cleaned;
  } catch {
    return null;
  }
}

module.exports = { buildLinkQrSvg };
