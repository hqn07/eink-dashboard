// Client-side mirror of dashboard.html's widget render functions.
// Both the React editor and the pool render real widget HTML by
// calling these — the result is dropped into the DOM via
// `dangerouslySetInnerHTML` and styled via /static/dashboard.css.

import { pickTier } from './widgets.js';
import { MIGRATED_RENDERERS } from './widgets/_registry.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Map the semantic font-family keys we expose in the WidgetSettings
// modal to actual CSS stacks. Keep this in lockstep with the mirror
// table in public/dashboard.html.
const FONT_STACKS = {
  serif:  "'DM Serif Display', Georgia, 'Iowan Old Style', serif",
  sans:   "'Oswald', 'Arial Narrow', sans-serif",
  mono:   "'JetBrains Mono', ui-monospace, monospace",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif"
};

// Build a style fragment for a widget's outer wrapper from per-tile
// typography settings. Only emits the relevant declarations when the
// user actually picked them — an unset fontFamily preserves the
// per-widget default look (the mixed serif/sans/mono baked into each
// widget's CSS). When set, --w-font is emitted so the .cell-level
// override rule in dashboard.css can force every child to inherit.
export function typographyCss(s) {
  if (!s) return '';
  let css = '';
  const fam = FONT_STACKS[s.fontFamily];
  if (fam) {
    css += `--w-font:${fam};font-family:${fam};`;
  }
  if (Number.isFinite(s.padding)) {
    css += `padding:${s.padding}px;`;
  }
  return css;
}

// All widget renderers have moved to control-src/widgets/<id>.jsx —
// see the registry at control-src/widgets/_registry.js. The empty
// RENDERERS map stays here so renderWidget() can still fall back if
// a non-migrated widget id ever appears.
const RENDERERS = {};

export function renderWidget(id, data) {
  // Prefer the per-widget module (Phase A migrations) over the legacy
  // RENDERERS map. Either way the contract is the same — a pure
  // function from ctx to HTML string.
  const fn = MIGRATED_RENDERERS[id] || RENDERERS[id];
  if (!fn) return '';
  try { return fn(data || {}); } catch { return ''; }
}

// Default chrome — used when the screen's chrome is missing.
const DEFAULT_CHROME = {
  header: { enabled: true, left: '{city}', leftSub: '{date}', right: '{time}', rightSub: 'EDITION No. {edition}' },
  footer: { enabled: true, text: 'UPDATED {time} · REFRESH {refresh}MIN · THE DAILY {city}' }
};

function chromeTokens(data) {
  const cfg = (data && data.cfg) || {};
  const w = data && data.weather;
  // Always use the live wall clock — same fix as dashboard.html.
  const tz = cfg.timezone || 'UTC';
  const now = new Date();
  let timeStr = '', dateStr = '';
  try {
    timeStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
    }).format(now).toUpperCase();
    dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    }).format(now).toUpperCase();
  } catch {
    timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    dateStr = now.toDateString().toUpperCase();
  }
  const battery = (data && data.battery) || null;
  const battPct = battery && Number.isFinite(battery.pct) ? battery.pct : null;
  const battV   = battery && Number.isFinite(battery.v)   ? battery.v   : null;
  const battAgeMin = battery && Number.isFinite(battery.at)
    ? Math.max(0, Math.round((Date.now() - battery.at) / 60000))
    : null;
  const battAgeLabel = battAgeMin == null ? '—'
    : battAgeMin < 60 ? `${battAgeMin}m`
    : `${Math.round(battAgeMin / 60)}h`;
  return {
    '{city}': (cfg.cityLabel || cfg.city || '').toString(),
    '{time}': timeStr,
    '{date}': dateStr,
    '{refresh}': String(cfg.refreshMinutes || 30),
    '{edition}': String(Math.floor(Date.now() / 3600000) % 9999),
    '{battery}': battPct != null ? `${battPct}%` : '—',
    '{battpct}': battPct != null ? String(battPct) : '—',
    '{battv}':   battV   != null ? `${battV.toFixed(2)}V` : '—',
    '{battage}': battAgeLabel
  };
}

function tplString(s, tokens) {
  let out = String(s || '');
  for (const k in tokens) out = out.split(k).join(tokens[k]);
  return out;
}

// Header/footer chrome the dashboard wraps around the body grid. The
// editor renders these in fixed top/bottom strips so the body area
// exactly matches the dashboard's body grid pixel-for-pixel.
export function renderHeader(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  const h = chrome.header || {};
  if (h.enabled === false) return '';
  const tokens = chromeTokens(data);
  return `
    <div class="hdr-left">
      <div class="hdr-city">${escapeHtml(tplString(h.left, tokens))}</div>
      ${h.leftSub ? `<div class="hdr-date">${escapeHtml(tplString(h.leftSub, tokens))}</div>` : ''}
    </div>
    <div class="hdr-right">
      <div class="hdr-time">${escapeHtml(tplString(h.right, tokens))}</div>
      ${h.rightSub ? `<div class="hdr-meta">${escapeHtml(tplString(h.rightSub, tokens))}</div>` : ''}
    </div>
  `;
}

export function renderFooter(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  const f = chrome.footer || {};
  if (f.enabled === false) return '';
  const tokens = chromeTokens(data);
  const battBadge = f.showBattery
    ? `<span class="ftr-battery">BAT ${escapeHtml(tokens['{battery}'])}${tokens['{battage}'] !== '—' ? ` · ${escapeHtml(tokens['{battage}'])}` : ''}</span>`
    : '';
  return `<span class="ftr-bullet">●</span> ${escapeHtml(tplString(f.text, tokens))}${battBadge}`;
}

export function isHeaderOn(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  return (chrome.header || {}).enabled !== false;
}
export function isFooterOn(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  return (chrome.footer || {}).enabled !== false;
}
export function headerVariant(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  return ((chrome.header || {}).variant || 'masthead').toLowerCase();
}
export function footerVariant(data) {
  const chrome = (data && data.chrome) || DEFAULT_CHROME;
  return ((chrome.footer || {}).variant || 'editorial').toLowerCase();
}
