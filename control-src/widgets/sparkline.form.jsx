import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, SelectField, LocationFields, TypographyFields, FormSection, defaults = {} } = fields;
  const isWeather = v.source === 'weather_temp' || v.source === 'weather_precip';
  return (
    <>
      <FormSection title="Data">
        <SelectField
          label="Source"
          value={v.source || 'battery_pct'}
          defaultValue={defaults.source}
          options={[
            { value: 'weather_temp',   label: 'Weather — hourly temperature' },
            { value: 'weather_precip', label: 'Weather — hourly precipitation' },
            { value: 'battery_pct',    label: 'E-ink battery %' },
            { value: 'battery_v',      label: 'E-ink battery voltage' }
          ]}
          onChange={(x) => patch({ source: x })}
          help={isWeather
            ? 'Charts the coming hours from the forecast.'
            : 'Built from the readings the device pushes each refresh.'}
        />
        {isWeather && (
          <LocationFields
            values={v}
            onChange={(loc) => onChange({ ...v, ...loc })}
          />
        )}
      </FormSection>
      <FormSection title="Content">
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder={isWeather ? 'TEMPERATURE' : 'BATTERY'}
          help="Leave blank to use the source name."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
