// Headlines widget — server side. Fetches an RSS/Atom feed (or Hacker News
// via hnrss.org) and returns a normalized list of recent items for the
// render fn. Parsing uses fast-xml-parser (already a dep). Cached per feed
// URL so multiple tiles / refreshes don't re-hit the source.

const { XMLParser } = require('fast-xml-parser');
const { fetchWithTimeout, fetchPublicUrl } = require('./_fetch');
const status = require('./_status');
const { BoundedMap } = require('./_cache');

const CACHE_MS = 10 * 60 * 1000;
const cache = new BoundedMap(32); // url → { at, data }

const HN_FEEDS = {
  top:  'https://hnrss.org/frontpage',
  best: 'https://hnrss.org/best',
  new:  'https://hnrss.org/newest'
};

// Curated news sources so the user picks an outlet instead of hunting for an
// RSS URL. All public, long-stable feeds. Keep in sync with NEWS_LABELS and
// the picker in control-src/widgets/headlines.form.jsx.
const NEWS_FEEDS = {
  bbc:       'https://feeds.bbci.co.uk/news/rss.xml',
  bbc_world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  nyt:       'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
  guardian:  'https://www.theguardian.com/international/rss',
  npr:       'https://feeds.npr.org/1001/rss.xml',
  aljazeera: 'https://www.aljazeera.com/xml/rss/all.xml'
};
// Friendlier labels than some feeds' raw channel titles (e.g. NYT's
// "NYT > Top Stories"). Falls back to the parsed feed title when unmapped.
const NEWS_LABELS = {
  bbc: 'BBC News', bbc_world: 'BBC World', nyt: 'New York Times',
  guardian: 'The Guardian', npr: 'NPR News', aljazeera: 'Al Jazeera'
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// Coerce a possibly-array / possibly-object XML node into an array.
function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

// Pull plain text out of an RSS/Atom title node (string, or { '#text' } for
// CDATA / attributed nodes).
function nodeText(n) {
  if (n == null) return '';
  if (typeof n === 'string') return n;
  if (typeof n === 'object' && n['#text'] != null) return String(n['#text']);
  return String(n);
}

// Relative age label from an RSS/Atom date string. Returns '' when unparseable.
function ageLabel(dateStr) {
  const t = Date.parse(dateStr || '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function parseFeed(xml) {
  const doc = parser.parse(xml);
  let source = '';
  let items = [];
  if (doc && doc.rss && doc.rss.channel) {
    // RSS 2.0
    const ch = doc.rss.channel;
    source = nodeText(ch.title);
    items = asArray(ch.item).map(it => ({
      title: nodeText(it.title).trim(),
      age: ageLabel(it.pubDate)
    }));
  } else if (doc && doc.feed) {
    // Atom
    const f = doc.feed;
    source = nodeText(f.title);
    items = asArray(f.entry).map(e => ({
      title: nodeText(e.title).trim(),
      age: ageLabel(e.updated || e.published)
    }));
  } else if (doc && doc['rdf:RDF']) {
    // RSS 1.0 (RDF)
    const r = doc['rdf:RDF'];
    source = nodeText(r.channel && r.channel.title);
    items = asArray(r.item).map(it => ({
      title: nodeText(it.title).trim(),
      age: ageLabel(it['dc:date'])
    }));
  }
  return { source: source.trim(), items: items.filter(i => i.title) };
}

// One feed URL → { source, items, stale } with per-URL cache. `isHn`
// skips the SSRF guard (hnrss.org is first-party); user URLs go through
// fetchPublicUrl.
async function fetchOneFeed(url, isHn, labelOverride) {
  const hit = cache.get(url);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('headlines'); return hit.data; }
  const t0 = Date.now();
  try {
    const doFetch = isHn ? fetchWithTimeout : fetchPublicUrl;
    const res = await doFetch(url, { headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' } }, 6000);
    if (!res.ok) {
      status.record('headlines', { ok: false, ms: Date.now() - t0, err: `HTTP ${res.status}` });
      if (hit) return { ...hit.data, stale: true };
      return null;
    }
    const xml = await res.text();
    const parsed = parseFeed(xml);
    if (labelOverride) parsed.source = labelOverride;
    const data = { ...parsed, stale: false };
    cache.set(url, { at: Date.now(), data });
    status.record('headlines', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('headlines', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    if (hit) return { ...hit.data, stale: true };
    return null;
  }
}

// settings: { source: 'news'|'rss'|'hn', newsSource, feedUrl, feedUrls, hnFeed }
// `feedUrls` (extra RSS URLs) merge with the primary source round-robin,
// so one tile can interleave e.g. BBC + a personal blog + HN.
async function fetchHeadlines(settings) {
  const s = settings || {};
  let url, isHn = false, label = null;
  if (s.source === 'hn') {
    url = HN_FEEDS[s.hnFeed] || HN_FEEDS.top;
    isHn = true;
    label = 'Hacker News';
  } else if (s.source === 'news') {
    url = NEWS_FEEDS[s.newsSource] || NEWS_FEEDS.bbc;
    label = NEWS_LABELS[s.newsSource] || null;
  } else {
    url = typeof s.feedUrl === 'string' ? s.feedUrl.trim() : '';
    if (!/^https?:\/\//i.test(url)) url = '';
  }
  const extras = Array.isArray(s.feedUrls)
    ? s.feedUrls.map(u => String(u || '').trim()).filter(u => /^https?:\/\//i.test(u) && u !== url)
    : [];
  if (!url && !extras.length) return null;

  const feeds = (await Promise.all([
    url ? fetchOneFeed(url, isHn, label) : null,
    ...extras.map(u => fetchOneFeed(u, false, null))
  ])).filter(f => f && Array.isArray(f.items) && f.items.length);
  if (!feeds.length) return null;
  if (feeds.length === 1) return feeds[0];

  // Round-robin interleave keeps sources balanced regardless of feed size.
  const items = [];
  for (let i = 0; items.length < 24; i++) {
    let added = false;
    for (const f of feeds) {
      if (f.items[i]) { items.push(f.items[i]); added = true; }
    }
    if (!added) break;
  }
  return {
    source: `${feeds[0].source || 'feeds'} +${feeds.length - 1}`,
    items,
    stale: feeds.some(f => f.stale)
  };
}

module.exports = { fetchHeadlines };
