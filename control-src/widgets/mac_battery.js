import { escapeHtml, pickTier, placeholder } from './_shared.js';

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

export function render({ macBattery, settings, cellW, cellH, density }) {
  const titleLabel = (settings && typeof settings.title === 'string' && settings.title.trim())
    ? settings.title.trim()
    : 'MAC BATTERY';
  if (!macBattery) return placeholder(titleLabel.split(/\s+/)[0] || 'MAC', 'OFFLINE', 'msg', { cellW, cellH });
  const charging = /charg/i.test(macBattery.state);
  // Solid inline SVG lightning bolt instead of the U+26A1 emoji. The
  // emoji rendered as a yellow glyph in Chrome's color-emoji font
  // which (1) is gray-not-black on the threshold pass and (2) didn't
  // invert correctly on the dark theme. Solid black SVG threshold-
  // safe + invertible.
  const arrow = charging
    ? '<svg class="mac-batt-bolt" viewBox="0 0 24 24" width="0.7em" height="0.7em" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="#000"/></svg>'
    : '';
  // Tier picks font + label visibility — a 3×2 tile and an 8×3 tile no
  // longer render the same. Title hides on tiny since "MAC BATTERY"
  // crowds out the percent.
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const showTitle = tier !== 'tiny';
  const showState = tier !== 'tiny';
  return `
    <div class="mac-batt mac-batt-tier-${tier}">
      ${showTitle ? `<div class="col-title">${escapeHtml(titleLabel)}</div>` : ''}
      <div class="mac-batt-pct autofit" data-min-font="22">${macBattery.percent}%${arrow}</div>
      ${showState ? `<div class="mac-batt-state">${escapeHtml(macBattery.state.toUpperCase())}</div>` : ''}
    </div>
  `;
}
