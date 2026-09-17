import { def as quoteDef,  render as renderQuote } from './_view-quote.js';
import { def as wordDef,   render as renderWord }  from './_view-wordofday.js';
import { def as otdDef,    render as renderOtd }   from './_view-onthisday.js';

// Daily — one card that changes with the day: a quote, a word, or what
// happened on this date.
//
// Three palette entries for one job: fill a wide, short tile with a piece of
// writing that is different tomorrow. They shared a shape and, after the
// 2026-09-15 variant cut, had one variant each — so the only choice being
// made was which of the three, which is a view.
//
// As with `outdoors`, the renderers are not reimplemented: each view keeps
// its module (underscore-prefixed so the palette ignores it) and this file
// picks one.
export const def = {
  id: 'daily',
  label: 'Daily',
  requires: [],
  // The union of the three ladders. onthisday wanted the widest floor (10)
  // because dated rows need the room; the others start at 8.
  minSize: { w: 8, h: 3 },
  sizes: {
    S: { w: 10, h: 4 },
    M: { w: 12, h: 5 },
    L: { w: 12, h: 8 }
  },
  defaultSize: 'M',
  variants: {
    quote:     { label: 'Quote — line + attribution' },
    word:      { label: 'Word — term + definition' },
    onthisday: { label: 'On this day — dated events' }
  },
  defaultVariant: 'quote',
  defaults: () => ({ variant: 'quote', title: '' })
};

const VIEWS = {
  quote:     { render: renderQuote, def: quoteDef },
  word:      { render: renderWord,  def: wordDef },
  onthisday: { render: renderOtd,   def: otdDef },
};

export function render(ctx) {
  const s = (ctx && ctx.settings) || {};
  const view = VIEWS[ctx && ctx.variant] || VIEWS[s.variant] || VIEWS.quote;
  // Each inner renderer resolves `ctx.variant || …` against its OWN variant
  // table, so it has to be handed its own name, not this widget's.
  return view.render({ ...ctx, variant: view.def.defaultVariant });
}
