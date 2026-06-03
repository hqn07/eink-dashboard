import React from 'react';

const PRESETS = [
  { id: 'default', label: 'Default — hero + watchlist',
    values: { layout: 'hero_watch', showSpark: true,  showChange: true  } },
  { id: 'list',    label: 'List — every symbol equal',
    values: { layout: 'list_only',  showSpark: true,  showChange: true  } },
  { id: 'lead',    label: 'Lead only — single symbol focus',
    values: { layout: 'hero_only',  showSpark: true,  showChange: true  } },
  { id: 'minimal', label: 'Minimal — prices only',
    values: { layout: 'list_only',  showSpark: false, showChange: false } }
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, CsvField, SelectField, SegmentedField, ToggleField, TypographyFields, FormSection, PresetField } = fields;
  return (
    <>
      <FormSection title="Data">
        <CsvField
          label="Symbols (comma separated)"
          value={v.symbols}
          onCommit={(arr) => patch({ symbols: arr })}
          placeholder="AAPL, BTC-USD, ETH-USD"
          help="Yahoo Finance tickers. Crypto: e.g. BTC-USD."
        />
      </FormSection>
      <FormSection title="Layout">
        <PresetField presets={PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          onChange={(x) => patch({ title: x })}
          placeholder="MARKETS"
          help="Leave blank to keep the default heading."
        />
        <SelectField
          label="Layout"
          value={v.layout || 'hero_watch'}
          options={[
            { value: 'hero_watch', label: 'Hero + watchlist (default)' },
            { value: 'list_only',  label: 'List only — every symbol equal' },
            { value: 'hero_only',  label: 'Just the lead symbol' }
          ]}
          onChange={(x) => patch({ layout: x })}
        />
        <SegmentedField
          label="Sparkline style"
          value={v.sparkStyle || 'line'}
          options={[
            { value: 'line', short: 'Line', label: 'Line (default)' },
            { value: 'bars', short: 'Bars', label: 'Vertical columns' },
            { value: 'area', short: 'Area', label: 'Line + soft fill' }
          ]}
          onChange={(x) => patch({ sparkStyle: x })}
        />
      </FormSection>
      <FormSection title="Show">
        <ToggleField label="Sparkline charts"
          value={v.showSpark  !== false} onChange={(x) => patch({ showSpark:  x })} />
        <ToggleField label="Change %"
          value={v.showChange !== false} onChange={(x) => patch({ showChange: x })} />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
