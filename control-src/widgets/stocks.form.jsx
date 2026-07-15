import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, CsvField, TypographyFields, FormSection, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Content">
        <CsvField
          label="Tickers (comma-separated)"
          value={v.symbols || []}
          defaultValue={defaults.symbols}
          onCommit={(arr) => patch({ symbols: arr })}
          placeholder="AAPL, VOO, ^GSPC"
          help="Yahoo symbols — stocks, ETFs, indexes (^GSPC). Quotes are ~15 min delayed."
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="MARKETS"
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
