// Pick the active message based on cfg.message.schedule, with simple
// inline markdown (bold + italic) for the rendered text.
function nowMinsTZ(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC', hour12: false, hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    let h = 0, m = 0;
    for (const p of parts) {
      if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
      if (p.type === 'minute') m = parseInt(p.value, 10);
    }
    return h * 60 + m;
  } catch { return new Date().getHours() * 60 + new Date().getMinutes(); }
}
function parseHHMM(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function inWindow(slot, nowM) {
  const a = parseHHMM(slot.from), b = parseHHMM(slot.to);
  if (a == null || b == null) return false;
  if (a === b) return true;
  if (a < b) return nowM >= a && nowM < b;
  return nowM >= a || nowM < b;
}

function resolveMessage(cfg) {
  const m = (cfg && cfg.message) || {};
  const schedule = Array.isArray(m.schedule) ? m.schedule : [];
  if (schedule.length) {
    const nowM = nowMinsTZ(cfg.timezone || 'UTC');
    const active = schedule.find(slot => inWindow(slot, nowM));
    if (active) return { text: active.text || '', subtitle: active.subtitle || '' };
  }
  return { text: m.text || '', subtitle: m.subtitle || '' };
}

// Minimal inline markdown: **bold**, *italic*, `code`. Returns HTML.
// Caller is responsible for escaping any non-markdown characters in
// the input first.
function renderInlineMarkdown(text) {
  if (!text) return '';
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

module.exports = { resolveMessage, renderInlineMarkdown };
