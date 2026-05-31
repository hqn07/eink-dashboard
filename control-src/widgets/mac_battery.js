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
  defaults: () => ({ title: '', fontScale: 1, padding: 14 })
};

export function render({ macBattery, settings }) {
  const titleLabel = (settings && typeof settings.title === 'string' && settings.title.trim())
    ? settings.title.trim()
    : 'MAC BATTERY';
  if (!macBattery) return placeholder(titleLabel.split(/\s+/)[0] || 'MAC', 'OFFLINE', 'msg');
  const charging = /charg/i.test(macBattery.state);
  const arrow = charging ? '⚡' : '';
  return `
    <div class="mac-batt">
      <div class="col-title">${escapeHtml(titleLabel)}</div>
      <div class="mac-batt-pct autofit" data-min-font="22">${macBattery.percent}%${arrow}</div>
      <div class="mac-batt-state">${escapeHtml(macBattery.state.toUpperCase())}</div>
    </div>
  `;
}
