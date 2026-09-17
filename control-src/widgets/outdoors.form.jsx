import React from 'react';

// One form for three views. Each view's own controls appear only when that
// view is selected — the Variant picker above already chose what the tile
// shows, so repeating "which view?" here would be asking twice, and showing
// the sun's clock format on an air-quality tile would be asking about
// something that cannot happen.
export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ToggleField, FormSection, defaults = {} } = fields;
  const view = v.variant || 'sun';

  const BLURB = {
    sun: 'Sunrise, sunset and daylight length for your dashboard location. No API key needed.',
    uv:  'UV index and WHO band for your dashboard location. No API key needed (Open-Meteo).',
    air: 'Air quality (US AQI) for your dashboard location. No API key needed.',
  };
  const PLACEHOLDER = { sun: 'SUN', uv: 'UV INDEX', air: 'AIR QUALITY' };

  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          {BLURB[view]} Set the place in Settings &gt; Tools &gt; You &amp; your place.
        </div>

        {view === 'sun' && (
          <>
            <ToggleField
              label="24-hour clock"
              value={v.hour24 === true}
              defaultValue={defaults.hour24}
              onChange={(x) => patch({ hour24: x })}
            />
            <ToggleField
              label="Show daylight length"
              value={v.showDaylight !== false}
              defaultValue={defaults.showDaylight}
              onChange={(x) => patch({ showDaylight: x })}
            />
          </>
        )}

        {view === 'air' && (
          <ToggleField
            label="Pollutant line (PM2.5 · PM10)"
            value={v.showPollutants !== false}
            defaultValue={defaults.showPollutants}
            onChange={(x) => patch({ showPollutants: x })}
          />
        )}

        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder={PLACEHOLDER[view]}
          help="Leave blank to keep the default heading."
        />
      </FormSection>
    </>
  );
}
