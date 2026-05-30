import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { CsvField, TypographyFields } = fields;
  return (
    <>
      <CsvField
        label="Symbols (comma separated)"
        value={v.symbols}
        onCommit={(arr) => patch({ symbols: arr })}
        placeholder="AAPL, BTC-USD, ETH-USD"
        help="Yahoo Finance tickers. Crypto: e.g. BTC-USD."
      />
      <TypographyFields values={v} onChange={onChange} />
    </>
  );
}
