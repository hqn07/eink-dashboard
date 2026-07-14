// Transit widget — server side. NYC MTA subway real-time arrivals. MTA's
// GTFS-realtime feeds are keyless (since 2023); we fetch the protobuf feed
// for the selected line group, decode via gtfs-realtime-bindings, and return
// the next arrivals at a given stop + direction as minutes-away.
//
// Stop IDs are GTFS ids like "L06" (station) + a direction suffix N/S, e.g.
// "L06N". The user supplies the base stop id + picks a direction; we combine.

const GtfsRt = require('gtfs-realtime-bindings');
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const FEED_BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F';

// Which protobuf feed each line lives in. The numbered lines + 42 St shuttle
// (S) share one feed; letter lines split by group.
const LINE_TO_FEED = {
  '1': 'gtfs', '2': 'gtfs', '3': 'gtfs', '4': 'gtfs', '5': 'gtfs', '6': 'gtfs', '7': 'gtfs', 'S': 'gtfs',
  'A': 'gtfs-ace', 'C': 'gtfs-ace', 'E': 'gtfs-ace',
  'B': 'gtfs-bdfm', 'D': 'gtfs-bdfm', 'F': 'gtfs-bdfm', 'M': 'gtfs-bdfm',
  'G': 'gtfs-g',
  'J': 'gtfs-jz', 'Z': 'gtfs-jz',
  'L': 'gtfs-l',
  'N': 'gtfs-nqrw', 'Q': 'gtfs-nqrw', 'R': 'gtfs-nqrw', 'W': 'gtfs-nqrw',
  'SIR': 'gtfs-si'
};

const CACHE_MS = 45 * 1000; // real-time — short cache so arrivals stay fresh
const cache = new Map();     // feed → { at, feedMsg }

async function loadFeed(feedName) {
  const hit = cache.get(feedName);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('transit'); return hit.feedMsg; }
  const res = await fetchWithTimeout(FEED_BASE + feedName, {}, 6000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const feedMsg = GtfsRt.transit_realtime.FeedMessage.decode(buf);
  cache.set(feedName, { at: Date.now(), feedMsg });
  return feedMsg;
}

// settings: { line, stopId, direction: 'N'|'S'|'both', count }
// direction 'both' watches both platforms of the station on one tile;
// each arrival carries `dir` so the renderer can mark ↑/↓.
async function fetchTransit(settings) {
  const s = settings || {};
  const line = String(s.line || '').toUpperCase().trim();
  const base = String(s.stopId || '').toUpperCase().trim();
  const both = s.direction === 'both';
  const dir = s.direction === 'S' ? 'S' : 'N';
  const count = Number.isFinite(s.count) ? s.count : 5;
  const feedName = LINE_TO_FEED[line];
  if (!feedName || !base) return null;
  const pinned = base.endsWith('N') || base.endsWith('S');
  const targets = new Set(
    both && !pinned ? [base + 'N', base + 'S'] : [pinned ? base : base + dir]
  );

  const t0 = Date.now();
  try {
    const feed = await loadFeed(feedName);
    const now = Date.now();
    const arrivals = [];
    for (const e of feed.entity) {
      const tu = e.tripUpdate;
      if (!tu || !Array.isArray(tu.stopTimeUpdate)) continue;
      for (const stu of tu.stopTimeUpdate) {
        if (!targets.has(stu.stopId)) continue;
        const t = stu.arrival && stu.arrival.time ? Number(stu.arrival.time) * 1000 : null;
        if (!t) continue;
        const mins = Math.round((t - now) / 60000);
        if (mins < 0) continue;
        arrivals.push({
          line: tu.trip.routeId || line,
          minutes: mins,
          dir: stu.stopId.endsWith('S') ? 'S' : 'N'
        });
      }
    }
    arrivals.sort((a, b) => a.minutes - b.minutes);
    const data = { stop: [...targets].join('+'), both: both && !pinned, items: arrivals.slice(0, count), stale: false };
    status.record('transit', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('transit', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    return null;
  }
}

module.exports = { fetchTransit, LINE_TO_FEED };
