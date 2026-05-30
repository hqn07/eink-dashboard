import { escapeHtml, placeholder } from './_shared.js';

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
  if (!macBattery) return placeholder('MAC', 'OFFLINE', 'msg');
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
