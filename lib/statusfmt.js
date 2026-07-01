// Formatting helpers for the /status ops page. Pure string/number
// utilities — relative age, coarse durations, battery drain trend, and a
// block-character sparkline. Kept out of server.js since /status is the
// only consumer and none of this touches app state.

function relAge(ms) {
  if (!Number.isFinite(ms)) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function dur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

// Drain rate + rough time-to-empty from battery history (oldest→newest).
function batteryTrend(hist) {
  if (!Array.isArray(hist) || hist.length < 2) return null;
  const recent = hist.slice(-12);
  const a = recent[0], b = recent[recent.length - 1];
  const dtH = (b.at - a.at) / 3_600_000;
  if (!(dtH > 0)) return null;
  const ratePerH = (b.pct - a.pct) / dtH; // <0 draining, >0 charging
  const etaH = ratePerH < 0 ? b.pct / -ratePerH : null;
  return { ratePerH, etaH, latest: b.pct };
}

// Tiny block-character sparkline (status page only — not the editor UI).
function sparkline(vals) {
  if (!vals || !vals.length) return '';
  const blocks = '▁▂▃▄▅▆▇█';
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  return vals.map(v => blocks[Math.round((v - min) / span * (blocks.length - 1))]).join('');
}

module.exports = { relAge, dur, batteryTrend, sparkline };
