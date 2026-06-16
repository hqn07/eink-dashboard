import { escapeHtml, pickTier, placeholder } from './_shared.js';

// Quote — a daily-rotating line. Zero fetch, zero key: rotates a
// built-in set (or the user's own list) by day-of-year, so it changes
// once a day and never depends on a flaky external API. `now` comes
// from ctx.now when present (frozen demo → deterministic) else
// Date.now().
//
// Contract v2 (widgets-refresh W2): variants —
//   serif   — big serif quote, attribution below (default)
//   mark    — oversized quote mark + quote
//   minimal — quote only, no attribution

const BUILT_IN = [
  ['The obstacle is the way.', 'MARCUS AURELIUS'],
  ['Simplicity is the ultimate sophistication.', 'LEONARDO DA VINCI'],
  ['Well done is better than well said.', 'BENJAMIN FRANKLIN'],
  ['What we think, we become.', 'BUDDHA'],
  ['The only way out is through.', 'ROBERT FROST'],
  ['Less, but better.', 'DIETER RAMS'],
  ['Whereof one cannot speak, thereof one must be silent.', 'WITTGENSTEIN'],
  ['Action is the foundational key to all success.', 'PABLO PICASSO'],
  ['He who has a why can bear almost any how.', 'NIETZSCHE'],
  ['Order and simplification are the first steps toward mastery.', 'THOMAS MANN'],
  ['The unexamined life is not worth living.', 'SOCRATES'],
  ['Make it work, make it right, make it fast.', 'KENT BECK'],
  ['Perfection is achieved when there is nothing left to take away.', 'SAINT-EXUPÉRY'],
  ['Energy and persistence conquer all things.', 'BENJAMIN FRANKLIN'],
  ['The future depends on what you do today.', 'GANDHI'],
  ['Do the hard jobs first. The easy jobs take care of themselves.', 'DALE CARNEGIE'],
  ['It always seems impossible until it is done.', 'NELSON MANDELA'],
  ['Quality is not an act, it is a habit.', 'ARISTOTLE'],
  ['Stay hungry, stay foolish.', 'STEWART BRAND'],
  ['The best way out is always through.', 'ROBERT FROST']
];

function dayOfYear(now) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
}

// Custom rows are "text — Author" (em or hyphen dash); split on the
// last dash so authors with hyphens survive.
function parseCustom(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  const m = str.match(/^(.*?)[\s]*[—-][\s]*([^—-]+)$/);
  if (m) return [m[1].trim(), m[2].trim().toUpperCase()];
  return [str.trim(), ''];
}

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const custom = (Array.isArray(s.quotes) ? s.quotes : [])
    .map(parseCustom).filter(Boolean);
  const pool = custom.length ? custom : BUILT_IN;
  if (!pool.length) {
    return placeholder('QUOTE', 'Add a quote', 'msg', { cellW, cellH });
  }
  const [text, author] = pool[dayOfYear(now) % pool.length];
  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'serif');
  const tier = pickTier(cellW || 0, cellH || 0, density);

  const quote = `<div class="quote-text autofit multiline" data-min-font="14" data-max-font="40">${escapeHtml(text)}</div>`;
  const by = (variant !== 'minimal' && tier !== 'tiny' && author)
    ? `<div class="quote-by">— ${escapeHtml(author)}</div>` : '';

  if (variant === 'mark') {
    return `
      <div class="quote quote-mark">
        <div class="quote-glyph">&ldquo;</div>
        ${quote}
        ${by}
      </div>
    `;
  }

  return `
    <div class="quote quote-serif">
      ${quote}
      ${by}
    </div>
  `;
}

export const def = {
  id: 'quote',
  label: 'Quote',
  minSize: { w: 8, h: 3 },
  sizes: {
    S: { w: 8, h: 4 },
    M: { w: 12, h: 4 },
    L: { w: 12, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    serif:   { label: 'Serif — quote + attribution' },
    mark:    { label: 'Mark — big quote mark' },
    minimal: { label: 'Minimal — quote only' }
  },
  defaultVariant: 'serif',
  degrade: {
    tiny: ['author']
  },
  defaults: () => ({
    variant: 'serif',
    quotes: [],          // empty → built-in rotation
    fontScale: 1,
    padding: 14
  })
};
