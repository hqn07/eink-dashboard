// RSS/Atom headline fetcher. 15-min cache per feed URL.
const { XMLParser } = require('fast-xml-parser');
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: true,
  trimValues: true
});

function clean(t) {
  return String(t || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

async function fetchNews(url, maxItems = 5) {
  if (!url) return [];
  const hit = cache.get(url);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('news'); return hit.data; }
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'eink-dashboard/1.0' } });
    if (!r.ok) {
      status.record('news', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      return hit?.data || [];
    }
    const xml = await r.text();
    const j = parser.parse(xml);

    let items = [];
    if (j.rss && j.rss.channel) {
      const ch = j.rss.channel;
      const src = ch.title;
      const list = Array.isArray(ch.item) ? ch.item : (ch.item ? [ch.item] : []);
      items = list.map(it => ({
        title: clean(typeof it.title === 'object' ? it.title['#text'] : it.title),
        source: clean(typeof src === 'object' ? src['#text'] : src)
      }));
    } else if (j.feed) {
      const src = j.feed.title;
      const list = Array.isArray(j.feed.entry) ? j.feed.entry : (j.feed.entry ? [j.feed.entry] : []);
      items = list.map(it => ({
        title: clean(typeof it.title === 'object' ? it.title['#text'] : it.title),
        source: clean(typeof src === 'object' ? src['#text'] : src)
      }));
    }

    const result = items.filter(i => i.title).slice(0, maxItems);
    cache.set(url, { at: Date.now(), data: result });
    status.record('news', { ok: true, ms: Date.now() - t0 });
    return result;
  } catch (e) {
    status.record('news', { ok: false, ms: Date.now() - t0, err: e.message || String(e) });
    return hit?.data || [];
  }
}

module.exports = { fetchNews };
