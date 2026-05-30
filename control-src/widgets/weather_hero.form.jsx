import React from 'react';
import { STAT_OPTIONS } from './weather_hero.js';

const DEFAULT_STATS = ['feels', 'humid', 'wind', 'cloud_or_rise'];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { LocationFields, SelectField, TypographyFields } = fields;
  const stats = Array.isArray(v.stats) && v.stats.length === 4 ? v.stats : DEFAULT_STATS;
  const setSlot = (idx, val) => {
    const next = stats.slice();
    next[idx] = val;
    patch({ stats: next });
  };
  return (
    <>
      <LocationFields
        values={v}
        onChange={(loc) => onChange({ ...v, ...loc })}
      />
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
      <TypographyFields values={v} onChange={onChange} />
    </>
  );
}
