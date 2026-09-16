// Deterministic clock for the visual-regression matrix.
//
// /widgets-matrix?demo=1 already freezes its DATA (_pool_demo), but thirteen
// render modules plus the token parser read the clock directly, so the
// snapshot still changed every day: the date line, the calendar's TODAY
// grouping, the moon phase, word-of-day, the countdowns. The baseline was
// red-by-default within a day of being taken, which is the same as having no
// guard at all.
//
// Freezing at the one choke point beats threading a `now` through thirteen
// modules: nothing new can drift, because a module added tomorrow gets the
// frozen clock for free.
//
// Safe because the SSR path (lib/ssr.js renderPage) is fully synchronous —
// no await runs between swap and restore, so no other request can observe
// the frozen Date on this single thread. Do NOT wrap anything that awaits.

// Mon 15 Jun 2026, 10:30 EDT — a weekday mid-morning, so the calendar has a
// sensible TODAY/LATER split and the clock reads as a working hour.
const DEMO_INSTANT = '2026-06-15T14:30:00.000Z';

function freezeTime(iso, fn) {
  const RealDate = global.Date;
  const fixed = RealDate.parse(iso);
  if (!Number.isFinite(fixed)) throw new Error(`freezeTime: bad instant ${iso}`);

  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  // calendar.js branches on `ev.start instanceof Date`, and a Date built
  // before the swap is not an instance of the subclass. Delegate the check
  // so the freeze is invisible to anything testing for a Date.
  Object.defineProperty(FrozenDate, Symbol.hasInstance, {
    value: (x) => x instanceof RealDate
  });

  global.Date = FrozenDate;
  try { return fn(); } finally { global.Date = RealDate; }
}

module.exports = { freezeTime, DEMO_INSTANT };
