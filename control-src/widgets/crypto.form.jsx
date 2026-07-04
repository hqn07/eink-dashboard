import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  const coinsStr = Array.isArray(v.coins) ? v.coins.join(', ') : '';

  return (
    <>
      <FormSection title="Coins">
        <TextField
          label="Coins (CoinGecko ids)"
          value={coinsStr}
          onChange={(x) => patch({
            coins: x.split(',').map(c => c.trim().toLowerCase()).filter(Boolean)
          })}
          placeholder="bitcoin, ethereum, solana"
          help="Comma-separated CoinGecko ids (bitcoin, ethereum, solana, dogecoin…)."
        />
        <TextField
          label="Priced in"
          value={v.vs || ''}
          defaultValue={defaults.vs}
          onChange={(x) => patch({ vs: x.trim().toLowerCase() })}
          placeholder="usd"
          help="Fiat code: usd, eur, gbp, jpy…"
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="CRYPTO"
          help="Leave blank to keep the default heading."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
