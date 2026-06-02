import React from 'react';
import { STAT_OPTIONS } from './weather_hero.js';

const DEFAULT_STATS = ['feels', 'humid', 'wind', 'cloud_or_rise'];

const PRESETS = [
  { id: 'editorial', label: 'Editorial — current default',
    values: { stats: ['feels','humid','wind','cloud_or_rise'],
              showDesc: true, showStats: true, showAlerts: true, showSunbar: true, showHourly: true } },
  { id: 'minimal',   label: 'Minimal — just the temperature',
    values: { stats: DEFAULT_STATS,
              showDesc: false, showStats: false, showAlerts: false, showSunbar: false, showHourly: false } },
  { id: 'wind',      label: 'Wind-focused — wind + gust + cloud + rise',
    values: { stats: ['wind','gust','cloud','rise'],
              showDesc: true, showStats: true, showAlerts: true, showSunbar: false, showHourly: false } },
  { id: 'sun',       label: 'Sun — sunrise / sunset + hourly',
    values: { stats: ['humid','cloud','rise','set'],
              showDesc: true, showStats: true, showAlerts: false, showSunbar: true, showHourly: true } }
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { LocationFields, SelectField, ToggleField, TypographyFields, FormSection, PresetField } = fields;
  const stats = Array.isArray(v.stats) && v.stats.length === 4 ? v.stats : DEFAULT_STATS;
  const setSlot = (idx, val) => {
    const next = stats.slice();
    next[idx] = val;
    patch({ stats: next });
  };
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
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Stats grid — pick what fills each of the four slots. Only shows
          on standard tier and up.
        </div>
        {[0, 1, 2, 3].map((i) => (
          <SelectField
            key={i}
            label={`Slot ${i + 1}`}
            value={stats[i]}
            options={STAT_OPTIONS}
            onChange={(x) => setSlot(i, x)}
          />
        ))}
      </FormSection>
      <FormSection title="Show">
        <ToggleField label="Description (OVERCAST / CLEAR / …)"
          value={v.showDesc   !== false} onChange={(x) => patch({ showDesc:   x })} />
        <ToggleField label="Stats grid"
          value={v.showStats  !== false} onChange={(x) => patch({ showStats:  x })} />
        <ToggleField label="Severe weather alert banner"
          value={v.showAlerts !== false} onChange={(x) => patch({ showAlerts: x })} />
        <ToggleField label="Sun bar (sunrise → sunset)"
          value={v.showSunbar !== false} onChange={(x) => patch({ showSunbar: x })} />
        <ToggleField label="Hourly forecast strip"
          value={v.showHourly !== false} onChange={(x) => patch({ showHourly: x })} />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
