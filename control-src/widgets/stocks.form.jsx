import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { CsvField, SelectField, TypographyFields, FormSection } = fields;
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
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
