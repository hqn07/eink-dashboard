// Mac battery — percent + charge state pushed by the mac-agent.
//
// Contract v2 (widgets-refresh W2): variants —
//   gauge   — stacked: title, percent, state (the original)
//   inline  — one row: title · percent · state; for short strip tiles
//   minimal — centered percent only
// Same family as eink_battery so the two battery tiles read as a pair.
// Gauge gates on grid rows directly (battery presets never leave the
// tiny/compact tier band): ≤2 rows shows percent only.

import { escapeHtml, placeholder, semRed } from './_shared.js';

export const def = {
  id: 'mac_battery',
  label: 'Mac Battery',
  requires: 'mac_battery',
  minSize: { w: 3, h: 2 },
  sizes: {
    S:  { w: 4, h: 2 },
    M:  { w: 6, h: 3 },
    L:  { w: 8, h: 3 }
  },
  defaultSize: 'S',
  variants: {
    trmnl:   { label: 'TRMNL — card + dithered bar' },
    gauge:   { label: 'Gauge — percent + state' },
    inline:  { label: 'Inline — one-row strip' },
    minimal: { label: 'Minimal — percent only' }
  },
  defaultVariant: 'gauge',
  degrade: {
    tiny: ['title', 'state']
  },
  defaults: () => ({
    variant: 'gauge',
    title: '',
    showState: true,
    fontScale: 1,
    padding: 14
  })
};

export function render(ctx) {
  const { macBattery, settings, cellW, cellH } = ctx;
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim()
    : 'MAC BATTERY';
  if (!macBattery) return placeholder(titleLabel.split(/\s+/)[0] || 'MAC', 'Mac offline', 'msg', { cellW, cellH }, 'offline');
  const variant = ctx.variant
    || (def.variants[s.variant] ? s.variant : 'gauge');
  const charging = /charg/i.test(macBattery.state);
  // Solid inline SVG lightning bolt instead of the U+26A1 emoji. The
  // emoji rendered as a yellow glyph in Chrome's color-emoji font
  // which (1) is gray-not-black on the threshold pass and (2) didn't
  // invert correctly on the dark theme. Solid black SVG threshold-
  // safe + invertible.
  const arrow = charging
    ? '<svg class="mac-batt-bolt" viewBox="0 0 24 24" width="0.7em" height="0.7em" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="#000"/></svg>'
    : '';
  // Semantic auto-red: low charge (<20%) and running on battery. Note
  // `charging` above matches "discharging" too (it contains "charging"),
  // so detect on-battery explicitly rather than reusing it.
  const onBattery = /dischar/i.test(macBattery.state)
    || !/charg(ing|ed)/i.test(macBattery.state);
  const low = semRed(s, Number(macBattery.percent) < 20 && onBattery);
  const pctBlock = `<div class="mac-batt-pct autofit${low}" data-min-font="22">${macBattery.percent}%${arrow}</div>`;
  const title = `<div class="col-title">${escapeHtml(titleLabel)}</div>`;
  const state = (s.showState !== false)
    ? `<div class="mac-batt-state">${escapeHtml(macBattery.state.toUpperCase())}</div>`
    : '';

  if (variant === 'trmnl') {
    const pct = Math.max(0, Math.min(100, Number(macBattery.percent) || 0));
    const fillPct = pct > 0 && pct < 3 ? 3 : pct;
    const fillTone = low ? 'face-tone-r50' : 'face-tone-g50';
    const bar = (cellH || 0) >= 3
      ? `<div class="tr-bar" style="height:22px;flex:none">
           <div class="tr-bar-fill ${fillTone}" style="width:${fillPct}%"></div>
           <div class="tr-bar-track face-tone-g15"></div>
         </div>` : '';
    return `<div class="tr-card">
      <div class="tr-titlebar"><span>Mac Battery</span><span class="tr-meta">${escapeHtml(macBattery.state.toLowerCase())}</span></div>
      <div class="tr-body" style="gap:8px;justify-content:center">
        <div class="tr-lv tr-lv-md"><div class="tr-v">${pct}<span class="tr-deg">%</span></div></div>
        ${bar}
      </div>
    </div>`;
  }

  if (variant === 'minimal') {
    return `<div class="mac-batt mac-batt-minimal">${pctBlock}</div>`;
  }

  if (variant === 'inline') {
    // Width gates: title needs ~8 grid cols, the state line ~6;
    // narrower strips keep just the percent.
    const cw = cellW || 0;
    return `
      <div class="mac-batt mac-batt-inline">
        ${cw >= 8 ? title : ''}
        ${pctBlock}
        ${cw >= 6 ? state : ''}
      </div>
    `;
  }

  // gauge — ≤2 rows keeps the percent only; 3+ adds title + state.
  const roomy = (cellH || 0) >= 3;
  return `
    <div class="mac-batt">
      ${roomy ? title : ''}
      ${pctBlock}
      ${roomy ? state : ''}
    </div>
  `;
}
