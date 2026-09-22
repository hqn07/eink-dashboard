import { buildForm } from './_schema.jsx';

// One list for three asset classes. The kind is inferred from the symbol, so
// the common case is typing what you'd say out loud; the help states the rules
// rather than leaving them to be discovered, and a prefix settles anything
// ambiguous (ETH is both a coin and an ETF).
export const FIELDS = [
  {
    key: 'symbols', type: 'csv', label: 'Symbols (comma-separated)',
    placeholder: 'AAPL, BTC, EUR/USD',
    help: 'Stocks, ETFs and indexes (AAPL, VOO, ^GSPC), crypto tickers (BTC, ETH) and '
      + 'currency pairs (EUR/USD) in one list, shown in the order you write them. A slash '
      + 'means a currency pair; a known coin ticker means crypto; anything else is a stock. '
      + 'Force it with stock:, crypto: or fx:. Stock quotes are ~15 min delayed.'
  },
  {
    key: 'vs', type: 'select', label: 'Priced in',
    options: [
      { value: 'usd', label: 'USD' },
      { value: 'eur', label: 'EUR' },
      { value: 'gbp', label: 'GBP' },
      { value: 'jpy', label: 'JPY' }
    ],
    help: 'Applies to crypto. Stock quotes come in their own listing currency.',
    // Only asks once the list holds something priced — a pure FX list has no
    // currency to be priced in.
    when: (v) => (Array.isArray(v.symbols) ? v.symbols : []).some(x => x && !String(x).includes('/'))
  },
  {
    key: 'heatSort', type: 'segmented', label: 'Order',
    options: [
      { value: 'change', short: 'Movers', label: 'Biggest movers first' },
      { value: 'list',   short: 'List',   label: 'The order I wrote them' }
    ],
    help: 'A symbol with no change to report sorts last either way.',
    when: (v) => v.variant === 'heat'
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: 'MARKETS'
  }
];

export const Form = buildForm(FIELDS);
