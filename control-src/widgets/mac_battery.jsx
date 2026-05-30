// Mac · Battery widget — reads from the host Mac when the dashboard
// server runs on macOS. No per-tile settings (data is platform-bound).

import React from 'react';
import { escapeHtml } from './_shared.js';

export const def = {
  id: 'mac_battery',
  label: 'Mac · Battery',
  requires: 'mac_battery',
  minSize: { w: 3, h: 2 },
  sizes: {
    S:  { w: 4, h: 2 },
    M:  { w: 6, h: 3 },
    L:  { w: 8, h: 3 }
  },
  defaultSize: 'S',
  defaults: () => ({ fontScale: 1, padding: 14 })
};

export function render({ macBattery }) {
  if (!macBattery) {
    return `<div class="col-title">MAC</div><div class="empty" style="border:0;padding:14px 0">OFFLINE</div>`;
  }
  const charging = /charg/i.test(macBattery.state);
  const arrow = charging ? '⚡' : '';
  return `
    <div class="mac-batt">
      <div class="col-title">MAC BATTERY</div>
      <div class="mac-batt-pct autofit" data-min-font="22">${macBattery.percent}%${arrow}</div>
      <div class="mac-batt-state">${escapeHtml(macBattery.state.toUpperCase())}</div>
    </div>
  `;
}

export function Form({ values, onChange, fields }) {
  const { TypographyFields } = fields;
  return (
    <>
      <div className="wsm-field-help" style={{ marginBottom: 6 }}>
        Reads battery from the host Mac. On Railway / cloud it shows
        "MAC OFFLINE".
      </div>
      <TypographyFields values={values || {}} onChange={onChange} />
    </>
  );
}
