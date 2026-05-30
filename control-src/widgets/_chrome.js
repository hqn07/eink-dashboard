// Header / footer / typography chrome — used by both the SSR pipeline
// in server.js and the React editor (via widget-render.js, which
// re-exports these). No widget-render dependency so this module is safe
// to load from the Node side without dragging .jsx files in.

import { escapeHtml, FONT_STACKS } from './_shared.js';

export const DEFAULT_CHROME = {
  header: {
    enabled: true,
    left: '{city}',
    leftSub: '{date}',
    right: '{time}',
    rightSub: 'EDITION No. {edition}'
  },
  footer: {
    enabled: true,
    text: 'UPDATED {time} · REFRESH {refresh}MIN · THE DAILY {city}'
  }
};

// Sevesalm battery glyph picker. Buckets match what the firmware
// reports so the icon agrees with the percentage label.
export function batteryGlyph(pct) {
  if (!Number.isFinite(pct))   return 'battery_full';
  if (pct < 12) return 'battery_empty';
  if (pct < 37) return 'battery_25';
  if (pct < 62) return 'battery_50';
  if (pct < 87) return 'battery_75';
  return 'battery_full';
}

// Build the substitution table that {city}/{time}/{date}/{refresh}/etc.
// in chrome template strings resolve through.
export function chromeTokens(data) {
  const cfg = (data && data.cfg) || {};
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
    '{battage}': battAgeLabel,
    _battPct: battPct,
    _battAgeMin: battAgeMin,
    _battAgeLabel: battAgeLabel
  };
}

function tplString(s, tokens) {
  let out = String(s || '');
  for (const k in tokens) {
    if (k.startsWith('_')) continue; // private hints, not substitution keys
    out = out.split(k).join(tokens[k]);
  }
  return out;
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
    ? `<span class="ftr-battery"><img class="batt-icon" src="/static/icons/sevesalm/${batteryGlyph(tokens._battPct)}.svg" width="20" height="20" alt="" /><span class="batt-pct">${tokens['{battery}']}</span>${tokens._battAgeMin != null ? ` · ${escapeHtml(tokens._battAgeLabel)}` : ''}</span>`
    : '';
  return `<span class="ftr-bullet">●</span> ${escapeHtml(tplString(f.text, tokens))}${battBadge}`;
}

// Per-tile typography → `style` attribute fragment for the .cell wrapper.
// Empty string when the user hasn't picked anything so the per-widget
// defaults still win.
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
