import React from 'react';

// One list for three asset classes. The kind is inferred from the symbol so
// the common case is just typing what you'd say out loud; the help text
// states the rules rather than leaving them to be discovered, and a prefix
// settles anything ambiguous (ETH is both a coin and an ETF).
export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, CsvField, SelectField, FormSection, defaults = {} } = fields;
  const symbols = Array.isArray(v.symbols) ? v.symbols.filter(Boolean) : [];
  const hasPriced = symbols.some(x => !String(x).includes('/'));
  return (
    <>
      <FormSection title="Content">
        <CsvField
          label="Symbols (comma-separated)"
          value={v.symbols || []}
          defaultValue={defaults.symbols}
          onCommit={(arr) => patch({ symbols: arr })}
          placeholder="AAPL, BTC, EUR/USD"
          help={
            <>
              Stocks, ETFs and indexes (<code>AAPL</code>, <code>VOO</code>,{' '}
              <code>^GSPC</code>), crypto tickers (<code>BTC</code>,{' '}
              <code>ETH</code>) and currency pairs (<code>EUR/USD</code>) in one
              list, shown in the order you write them. A slash means a currency
              pair; a known coin ticker means crypto; anything else is a stock.
              Force it with <code>stock:</code>, <code>crypto:</code> or{' '}
              <code>fx:</code>. Stock quotes are ~15 min delayed.
            </>
          }
        />
        {hasPriced && (
          <SelectField
            label="Priced in"
            value={v.vs || 'usd'}
            defaultValue={defaults.vs}
            options={[
              { value: 'usd', label: 'USD' },
              { value: 'eur', label: 'EUR' },
              { value: 'gbp', label: 'GBP' },
              { value: 'jpy', label: 'JPY' },
            ]}
            onChange={(x) => patch({ vs: x })}
            help="Applies to crypto. Stock quotes come in their own listing currency."
          />
        )}
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="MARKETS"
        />
      </FormSection>
    </>
  );
}
