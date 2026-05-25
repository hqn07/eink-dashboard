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

// Wiktionary's RSS now ships full page CSS inside <style> blocks at the
// top of `description`. A naive tag-strip leaves the CSS rules behind
// as plain text — drop <style>/<script> contents entirely first.
function stripTags(s) {
  return String(s || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
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
    // Wiktionary RSS description = full rendered page. After stripping
    // <style>/<script>/tags we still have:
    //   "edit · refresh · view Word of the day for <Month> <Day> <WORD> <pos> (<qualifiers>) <definition>"
    // Anchor on the heading so we skip the nav prefix.
    const headingRe = /Word of the day for [A-Za-z]+ \d+\s+(.*)$/;
    const tail = (description.match(headingRe) || [, ''])[1].trim();
    const wordMatch = tail.match(/^([A-Za-zÀ-ÿ'-]+)\s+([a-z]+\.?)?\s*(\([^)]*\))?\s*(.*)$/);
    const fallbackWord = (String(title || '').split('/').pop() || '').trim();
    const word = (wordMatch && wordMatch[1]) ? wordMatch[1] : fallbackWord;
    const partOfSpeech = (wordMatch && wordMatch[2]) ? wordMatch[2].replace(/\.$/, '') : '';
    const definition = (wordMatch ? wordMatch[4] : tail).split(/[.;]/)[0];
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
