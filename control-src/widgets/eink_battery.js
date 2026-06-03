// E-Ink panel battery — shows the LiPo state-of-charge for the device
// running this dashboard. The ESP32 POSTs voltage + percent to
// /api/battery at the start of every refresh cycle; the server persists
// to data/battery.json and injects it as `battery` on the render
// payload. No fetcher needed — purely a display widget.

import { escapeHtml, placeholder } from './_shared.js';

export const def = {
  id: 'eink_battery',
  label: 'E-Ink · Battery',
  requires: 'battery',
  minSize: { w: 3, h: 2 },
  sizes: {
    S: { w: 4, h: 2 },
    M: { w: 6, h: 3 },
    L: { w: 8, h: 4 }
  },
  defaultSize: 'S',
  defaults: () => ({
    title: '',
    showVoltage: true,
    showAge:     true,
    showBar:     true,
    fontScale: 1,
    padding: 14
  })
};

// Friendly relative age: "2m", "3h", "1d", "5d". Returns null when the
// battery payload has no timestamp.
function ageLabel(at) {
  if (!Number.isFinite(at)) return null;
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function render({ battery, settings }) {
  const s = settings || {};
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'E-INK BATTERY';
  if (!battery || !Number.isFinite(battery.pct)) {
    return placeholder(titleLabel.split(/\s+/)[0] || 'BATTERY', 'NO DATA', 'msg');
  }
  const pct = Math.max(0, Math.min(100, battery.pct));
  const v = Number.isFinite(battery.v) ? battery.v.toFixed(2) : null;
  const age = (s.showAge !== false) ? ageLabel(battery.at) : null;

  // Battery bar — 100 px wide, 18 px tall, single rectangle clipped by
  // an inner fill width = pct%. Threshold-safe at 1-bit; the outline
  // stays crisp because it's a solid stroke at >= 1.5 px.
  const bar = (s.showBar !== false) ? `
    <div class="eink-batt-bar">
      <div class="eink-batt-bar-fill" style="width:${pct}%"></div>
      <div class="eink-batt-bar-tip"></div>
    </div>` : '';

  // Lightning glyph appears when voltage is above the TP4056 charge
  // threshold (~4.10V). Solid black SVG for threshold + invert safety,
  // same approach as mac_battery's charging indicator.
  const charging = Number.isFinite(battery.v) && battery.v > 4.10;
  const bolt = charging
    ? '<svg class="eink-batt-bolt" viewBox="0 0 24 24" width="0.7em" height="0.7em" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="#000"/></svg>'
    : '';

  return `
    <div class="eink-batt">
      <div class="col-title">${escapeHtml(titleLabel)}</div>
      <div class="eink-batt-pct autofit" data-min-font="22">${pct}%${bolt}</div>
      ${(s.showVoltage !== false && v) ? `<div class="eink-batt-volts">${v} V</div>` : ''}
      ${bar}
      ${age ? `<div class="eink-batt-age">UPDATED ${escapeHtml(age)}</div>` : ''}
    </div>
  `;
}
