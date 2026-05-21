// Word of the day. Pulls Wiktionary's RSS feed and surfaces the
// headline word + a short definition. 6-hour cache.
const { XMLParser } = require('fast-xml-parser');
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 6 * 60 * 60 * 1000;
let cache = null; // { at, data }

const DEFAULT_URL = 'https://en.wiktionary.org/w/api.php?action=featuredfeed&feed=wotd&feedformat=rss';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: true,
  trimValues: true
});

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchWordOfDay(feedUrl) {
  const url = feedUrl || DEFAULT_URL;
  if (cache && cache.url === url && (Date.now() - cache.at) < CACHE_MS) {
    status.cacheHit('wod');
    return cache.data;
  }
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'eink-dashboard/1.0' } });
    if (!r.ok) {
      status.record('wod', { ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` });
      return cache ? cache.data : null;
    }
    const xml = await r.text();
    const j = parser.parse(xml);
    const ch = j.rss && j.rss.channel;
    if (!ch) {
      status.record('wod', { ok: false, ms: Date.now() - t0, err: 'no channel' });
      return cache ? cache.data : null;
    }
    const items = Array.isArray(ch.item) ? ch.item : (ch.item ? [ch.item] : []);
    const latest = items[items.length - 1] || items[0];
    if (!latest) {
      status.record('wod', { ok: false, ms: Date.now() - t0, err: 'no items' });
      return cache ? cache.data : null;
    }
    const title = typeof latest.title === 'object' ? latest.title['#text'] : latest.title;
    const description = stripTags(typeof latest.description === 'object' ? latest.description['#text'] : latest.description);
    // Wiktionary wraps the word in a <p><b>WORD</b></p> followed by part of
    // speech and definition. The headline word is the first all-caps-able
    // token in the title (e.g. "Wiktionary:Word of the day/May 21" → use
    // description instead).
    const wordMatch = description.match(/^([A-Za-zÀ-ÿ'-]+)\s*(\([^)]*\))?\s*(.*)$/);
    const word = wordMatch ? wordMatch[1] : (String(title || '').split('/').pop() || '').trim();
    const partOfSpeech = (wordMatch && wordMatch[2]) ? wordMatch[2].replace(/[()]/g, '') : '';
    const definition = (wordMatch ? wordMatch[3] : description).split('.')[0];
    const data = {
      word: (word || '').toString(),
      partOfSpeech: (partOfSpeech || '').toString(),
      definition: (definition || description || '').toString().trim()
    };
    cache = { at: Date.now(), url, data };
    status.record('wod', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (e) {
    status.record('wod', { ok: false, ms: Date.now() - t0, err: e.message || String(e) });
    return cache ? cache.data : null;
  }
}

module.exports = { fetchWordOfDay };
