// Small pure string / encoding helpers shared by the SSR pipeline and the
// binary-slice routes. No shared state; safe to require anywhere.
const crypto = require('crypto');

// Escape a value for use inside a double-quoted HTML attribute.
function htmlAttr(s) {
  return String(s == null ? '' : s).replace(/"/g, '&quot;');
}

// Full HTML-text escape (used for SSR text nodes).
function escapeHtmlServer(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Strong ETag — bytes-exact match. Quotes per RFC 7232.
function strongEtag(buf) {
  return `"${crypto.createHash('sha1').update(buf).digest('hex')}"`;
}

// Decode a base64-encoded JSON settings blob from a query param.
// Returns the parsed object, or null on any failure.
function decodeSettingsParam(raw) {
  if (!raw) return null;
  try {
    const json = Buffer.from(String(raw), 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { htmlAttr, escapeHtmlServer, strongEtag, decodeSettingsParam };
