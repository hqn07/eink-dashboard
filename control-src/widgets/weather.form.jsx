import React from 'react';
import { STAT_OPTIONS } from './weather.js';

// One form for both weather views.
//
// The Data section is shared — location and units are the same question
// whichever view draws. Everything below it is the view's own, and only the
// active view's fields render: the two old forms had 9 and 10 fields each and
// were the worst offenders in the September audit, but a user is never
// configuring both halves at once.

const DEFAULT_STATS = ['feels', 'humid', 'wind', 'cloud_or_rise'];

const NOW_PRESETS = [
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

const FORECAST_PRESETS = [
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
  const {
    LocationFields, TextField, SelectField, SegmentedField, ToggleField,
    FormSection, PresetField, Collapsible, defaults = {}
  } = fields;
  const isForecast = String(v.variant || 'now').startsWith('forecast');
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
          // Pass onChange straight through: LocationFields emits the COMPLETE
          // next settings object, and a `{...v, ...loc}` merge here would
          // silently undo "Use Setup instead", which works by deleting keys.
          // Same merge-where-a-replace-is-needed bug as ListEditor's
          // replaceRow (3289942).
          onChange={onChange}
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

      {isForecast ? (
        <>
          <FormSection title="Content">
            <PresetField presets={FORECAST_PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
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
                { value: 'auto', label: 'Auto (fit tile)' },
                { value: '3', label: '3 days' },
                { value: '4', label: '4 days' },
                { value: '5', label: '5 days' },
                { value: '6', label: '6 days' },
                { value: '7', label: '7 days' },
                { value: '8', label: '8 days (with today)' }
              ]}
              help="Auto scales with the tile — height in rows, width in columns. 8 needs Include today on."
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
      ) : (
        <>
          <FormSection title="Content">
            <PresetField presets={NOW_PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
            <ToggleField label="Description (OVERCAST / CLEAR / …)"
              value={v.showDesc   !== false} defaultValue={defaults.showDesc}
              onChange={(x) => patch({ showDesc:   x })} />
            <ToggleField label="Stats grid"
              value={v.showStats  !== false} defaultValue={defaults.showStats}
              onChange={(x) => patch({ showStats:  x })} />
            <ToggleField label="Severe weather alert banner"
              value={v.showAlerts !== false} defaultValue={defaults.showAlerts}
              onChange={(x) => patch({ showAlerts: x })} />
            <ToggleField label="Sun bar (sunrise → sunset)"
              value={v.showSunbar !== false} defaultValue={defaults.showSunbar}
              onChange={(x) => patch({ showSunbar: x })} />
            <ToggleField label="Hourly forecast strip"
              value={v.showHourly !== false} defaultValue={defaults.showHourly}
              onChange={(x) => patch({ showHourly: x })} />
          </FormSection>
          <FormSection title="Layout">
            <Collapsible title="Stats grid slots" storageScope="weather-now-stats" defaultOpen={false}>
              <div className="wsm-field-help" style={{ marginBottom: 6 }}>
                Pick what fills each of the four slots. Only shows on
                standard tier and up.
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
            </Collapsible>
          </FormSection>
        </>
      )}
    </>
  );
}
