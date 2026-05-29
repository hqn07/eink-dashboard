// Clock widget — first migration under the per-widget module pattern.
//
// Owns its grid def, HTML render, and modal form fields in one file.
// Aggregated by control-src/widgets/_registry.js so the rest of the
// app keeps consuming a single registry.

import React from 'react';
import { escapeHtml } from './_shared.js';

export const def = {
  id: 'clock',
  label: 'Clock',
  requires: 'clock',
  minSize: { w: 4, h: 2 },
  sizes: {
    S:  { w: 6, h: 3 },
    M:  { w: 8, h: 4 },
    L:  { w: 12, h: 6 },
    XL: { w: 24, h: 6 }
  },
  defaultSize: 'M',
  defaults: () => ({
    format: '12h', showDate: true, style: 'big',
    fontScale: 1,
    padding: 14
  })
};

export function render({ clockNow }) {
  if (!clockNow) {
    return `<div class="empty" style="border:0;padding:14px 0">NO TIME</div>`;
  }
  const c = clockNow;
  const cls = c.style === 'thin' ? 'clock-thin' : 'clock-big';
  const ampm = c.ampm ? `<span class="clock-ampm">${c.ampm}</span>` : '';
  const date = c.dateLine
    ? `<div class="clock-date">${escapeHtml(c.dateLine)}</div>`
    : '';
  return `
    <div class="clock ${cls}">
      <div class="clock-time autofit" data-min-font="22">${c.timeStr}${ampm}</div>
      ${date}
    </div>
  `;
}

// React form fragment for the WidgetSettings modal. Receives the
// shared field primitives (SelectField / ToggleField / TypographyFields)
// from the parent so it doesn't have to re-import them.
export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { SelectField, ToggleField, TypographyFields } = fields;
  const fmt = v.format === '24h' ? '24h' : '12h';
  const style = v.style === 'thin' ? 'thin' : 'big';
  const showDate = v.showDate !== false;
  return (
    <>
      <SelectField
        label="Format"
        value={fmt}
        options={[
          { value: '12h', label: '12-hour (3:34 PM)' },
          { value: '24h', label: '24-hour (15:34)' }
        ]}
        onChange={(x) => patch({ format: x })}
      />
      <SelectField
        label="Style"
        value={style}
        options={[
          { value: 'big',  label: 'Big chunky' },
          { value: 'thin', label: 'Thin' }
        ]}
        onChange={(x) => patch({ style: x })}
      />
      <ToggleField
        label="Show date below time"
        value={showDate}
        onChange={(x) => patch({ showDate: x })}
      />
      <TypographyFields values={v} onChange={onChange} />
    </>
  );
}
