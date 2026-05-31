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
  const { LocationFields, TextField, SelectField, ToggleField, TypographyFields, FormSection, PresetField } = fields;
  return (
    <>
      <FormSection title="Data">
        <LocationFields
          values={v}
          onChange={(loc) => onChange({ ...v, ...loc })}
        />
      </FormSection>
      <FormSection title="Content">
        <PresetField presets={PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
        <TextField
          label="Days to show (1–7 · blank = auto by tile height)"
          type="number"
          value={v.forecastDays ?? ''}
          onChange={(x) => patch({
            forecastDays: Number.isFinite(x) ? Math.max(1, Math.min(7, x)) : null
          })}
          help="Open-Meteo returns up to 7 days; larger tiles fit more."
        />
      </FormSection>
      <FormSection title="Layout">
        <SelectField
          label="Precipitation %"
          value={v.precipMode || 'auto'}
          options={[
            { value: 'auto',   label: 'Auto — only on wider tiles' },
            { value: 'always', label: 'Always show' },
            { value: 'never',  label: 'Hide' }
          ]}
          onChange={(x) => patch({ precipMode: x })}
        />
        <SelectField
          label="High / low style"
          value={v.hiloStyle || 'stack'}
          options={[
            { value: 'stack',  label: 'Stacked (HI on top)' },
            { value: 'inline', label: 'Inline (HI / LO)' },
            { value: 'arrows', label: 'Arrows (↑HI · ↓LO)' }
          ]}
          onChange={(x) => patch({ hiloStyle: x })}
        />
      </FormSection>
      <FormSection title="Show">
        <ToggleField label="Day name (MON / TUE / …)"
          value={v.showDayName !== false} onChange={(x) => patch({ showDayName: x })} />
        <ToggleField label="Weather icons"
          value={v.showIcons   !== false} onChange={(x) => patch({ showIcons:   x })} />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
