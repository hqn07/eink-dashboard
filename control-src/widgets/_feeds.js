// Curated feed presets — one place, so a URL is never typed twice.
//
// These are quick-add options for the `ai` tile's Sources list. They are URLs
// rather than keys on purpose: whatever is added ends up in `settings.feedUrls`
// as a plain URL the server fetches, so a preset and a hand-typed feed are the
// same thing downstream and nothing has to resolve a key.
//
// The first six mirror widgets/headlines.js NEWS_FEEDS. That file is CommonJS
// and server-side, so the client cannot import it — if you change a URL there,
// change it here too. (Same hand-mirroring the token registry lives with; see
// CLAUDE.md. The urls are stable enough that a check script would cost more
// than it saves.)
//
// Anything here is fetched server-side through the SSRF guard, exactly like a
// hand-typed feed — being on this list buys convenience, not trust.
export const FEED_PRESETS = [
  { label: 'Google News',    url: 'https://news.google.com/rss' },
  { label: 'BBC News',       url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { label: 'BBC World',      url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { label: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
  { label: 'The Guardian',   url: 'https://www.theguardian.com/international/rss' },
  { label: 'NPR',            url: 'https://feeds.npr.org/1001/rss.xml' },
  { label: 'Al Jazeera',     url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { label: 'Reuters world',  url: 'https://www.reutersagency.com/feed/?best-topics=world' },
  { label: 'AP top news',    url: 'https://rsshub.app/apnews/topics/apf-topnews' },
  { label: 'Hacker News',    url: 'https://hnrss.org/frontpage' },
  { label: 'Ars Technica',   url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { label: 'The Verge',      url: 'https://www.theverge.com/rss/index.xml' },
  { label: 'NASA',           url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss' },
  { label: 'Nature news',    url: 'https://www.nature.com/nature.rss' },
];
