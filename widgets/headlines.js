// Headlines widget — server side. Fetches an RSS/Atom feed (or Hacker News
// via hnrss.org) and returns a normalized list of recent items for the
// render fn. Parsing uses fast-xml-parser (already a dep). Cached per feed
// URL so multiple tiles / refreshes don't re-hit the source.

const { XMLParser } = require('fast-xml-parser');
const { fetchWithTimeout, fetchPublicUrl } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // url → { at, data }

const HN_FEEDS = {
  top:  'https://hnrss.org/frontpage',
  best: 'https://hnrss.org/best',
  new:  'https://hnrss.org/newest'
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

// settings: { source: 'rss'|'hn', feedUrl, hnFeed: 'top'|'best'|'new' }
async function fetchHeadlines(settings) {
  const s = settings || {};
  let url;
  if (s.source === 'hn') {
    url = HN_FEEDS[s.hnFeed] || HN_FEEDS.top;
  } else {
    url = typeof s.feedUrl === 'string' ? s.feedUrl.trim() : '';
    if (!/^https?:\/\//i.test(url)) return null;
  }

  const hit = cache.get(url);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('headlines'); return hit.data; }

  const t0 = Date.now();
  try {
    // hnrss.org (HN) is first-party/public; a custom RSS URL is user input →
    // guard it against private/loopback/metadata targets.
    const doFetch = s.source === 'hn' ? fetchWithTimeout : fetchPublicUrl;
    const res = await doFetch(url, { headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' } }, 6000);
    if (!res.ok) {
      status.record('headlines', { ok: false, ms: Date.now() - t0, err: `HTTP ${res.status}` });
      if (hit) return { ...hit.data, stale: true };
      return null;
    }
    const xml = await res.text();
    const parsed = parseFeed(xml);
    // Hacker News source label is friendlier than the raw feed title.
    if (s.source === 'hn') parsed.source = 'Hacker News';
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

module.exports = { fetchHeadlines };
