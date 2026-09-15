import React from 'react';

const PRESETS = [
  { id: 'default', label: 'Default — stacked HI/LO, auto precip',
    values: { hiloStyle: 'stack',  precipMode: 'auto',   showIcons: true,  showDayName: true } },
  { id: 'compact', label: 'Compact — inline, no precip, no icons',
    values: { hiloStyle: 'inline', precipMode: 'never',  showIcons: false, showDayName: true } },
  { id: 'arrows',  label: 'Arrows — ↑HI · ↓LO',
    values: { hiloStyle: 'arrows', precipMode: 'always', showIcons: true,  showDayName: true } },
  { id: 'numbers', label: 'Numbers only — no icons, no day names',
    values: { hiloStyle: 'inline', precipMode: 'never',  showIcons: false, showDayName: false } }
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { LocationFields, TextField, SelectField, SegmentedField, ToggleField, FormSection, PresetField, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Data">
        <LocationFields
          values={v}
          onChange={(loc) => onChange({ ...v, ...loc })}
        />
        <SelectField
          label="Units (this tile only)"
          value={v.unitsOverride || 'inherit'}
          defaultValue={defaults.unitsOverride}
          options={[
            { value: 'inherit', label: 'Inherit (dashboard default)' },
            { value: 'F',       label: 'Force °F' },
            { value: 'C',       label: 'Force °C' }
          ]}
          onChange={(x) => patch({ unitsOverride: x })}
          help="Overrides this tile's reading only — dashboard's main unit stays the same."
        />
      </FormSection>
      <FormSection title="Content">
        <PresetField presets={PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="N-DAY OUTLOOK"
          help="Leave blank for the default (varies with day count)."
        />
        <SelectField
          label="Days to show"
          value={Number.isFinite(v.forecastDays) ? String(v.forecastDays) : 'auto'}
          onChange={(x) => patch({ forecastDays: x === 'auto' ? null : parseInt(x, 10) })}
          options={[
            { value: 'auto', label: 'Auto (fit tile height)' },
            { value: '3', label: '3 days' },
            { value: '4', label: '4 days' },
            { value: '5', label: '5 days' },
            { value: '6', label: '6 days' },
            { value: '7', label: '7 days' },
            { value: '8', label: '8 days (with today)' }
          ]}
          help="Auto scales with the tile. 8 needs Include today on."
        />
        <ToggleField label="Include today"
          value={v.includeToday === true} defaultValue={defaults.includeToday}
          onChange={(x) => patch({ includeToday: x })} />
        <ToggleField label="Day name (MON / TUE / …)"
          value={v.showDayName !== false} defaultValue={defaults.showDayName}
          onChange={(x) => patch({ showDayName: x })} />
        <ToggleField label="Weather icons"
          value={v.showIcons   !== false} defaultValue={defaults.showIcons}
          onChange={(x) => patch({ showIcons:   x })} />
      </FormSection>
      <FormSection title="Layout">
        <SegmentedField
          label="Precipitation %"
          value={v.precipMode || 'auto'}
          defaultValue={defaults.precipMode}
          options={[
            { value: 'auto',   short: 'Auto',   label: 'Auto — wide tiles only' },
            { value: 'always', short: 'Always', label: 'Always show' },
            { value: 'never',  short: 'Hide',   label: 'Hide' }
          ]}
          onChange={(x) => patch({ precipMode: x })}
        />
        <SegmentedField
          label="High / low style"
          value={v.hiloStyle || 'stack'}
          defaultValue={defaults.hiloStyle}
          options={[
            { value: 'stack',  short: 'Stack',  label: 'Stacked (HI on top)' },
            { value: 'inline', short: 'Inline', label: 'Inline (HI / LO)' },
            { value: 'arrows', short: 'Arrows', label: 'Arrows (↑HI ↓LO)' }
          ]}
          onChange={(x) => patch({ hiloStyle: x })}
        />
      </FormSection>
    </>
  );
}
