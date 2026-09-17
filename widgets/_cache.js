// Bounded Map for the widget data caches.
//
// Every fetcher kept its own `new Map()` keyed by a user-controlled string —
// an iCal URL, an RSS feed, a symbol list, a transit feed name — checked the
// age on read, and NEVER deleted anything. Thirteen of them. A URL you tried
// once and abandoned held its parsed payload for the life of the process, and
// calendar is the worst case: a year of expanded recurring events per URL.
//
// The pattern to copy already existed in routes/geocode.js (a 500-entry LRU);
// it simply was not applied where the payloads are biggest.
//
// Deliberately a Map SUBCLASS rather than a new cache API. Each fetcher has
// its own TTL handling and most fall back to the last good payload (flagged
// `stale`) when an upstream is down — behaviour worth keeping, and worth not
// rewriting thirteen times to reach a bound that a two-line override gives.
// The only change at each call site is `new Map()` -> `new BoundedMap()`.
//
// LRU rather than FIFO: Map iterates in insertion order, so re-inserting on
// `set` moves a key to the young end, and the first key the iterator yields is
// always the least recently written. Reads do not promote — the TTL means a
// re-read is usually followed by a re-`set` anyway.
class BoundedMap extends Map {
  constructor(max = 64) {
    super();
    this.max = max;
  }

  set(key, value) {
    if (this.has(key)) this.delete(key);   // re-insert at the young end
    super.set(key, value);
    while (this.size > this.max) {
      super.delete(this.keys().next().value);
    }
    return this;
  }
}

module.exports = { BoundedMap };
