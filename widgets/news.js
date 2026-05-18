// RSS/Atom headline fetcher. 15-min cache per feed URL.
const { XMLParser } = require('fast-xml-parser');

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
  if (hit && (Date.now() - hit.at) < CACHE_MS) return hit.data;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'eink-dashboard/1.0' } });
    if (!r.ok) return hit?.data || [];
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
    return result;
  } catch {
    return hit?.data || [];
  }
}

module.exports = { fetchNews };
