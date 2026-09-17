// Data fan-out for a dashboard render. Given a config + resolved layout, fetch
// exactly the data the on-screen widgets need — once globally, then per-tile
// for widgets carrying their own `settings`. Each widget fetcher keeps its own
// TTL cache, so duplicate identical inputs across tiles don't multiply API
// calls. Pure orchestration; holds no state of its own.
const { fetchWeather } = require('../widgets/weather');
const { fetchAqi } = require('../widgets/aqi');
const { fetchCodeActivity } = require('../widgets/codeactivity');
const { fetchAi } = require('../widgets/ai');
const { fetchOnThisDay } = require('../widgets/onthisday');
const { fetchEvents } = require('../widgets/calendar');
const { fetchAlerts } = require('../widgets/alerts');
const { resolveMessage } = require('../widgets/message');
const { buildClock } = require('../widgets/clock');
const { fetchPhoto } = require('../widgets/photo');
const { fetchHeadlines } = require('../widgets/headlines');
const { fetchTasks } = require('../widgets/tasks');
const { fetchTransit } = require('../widgets/transit');
const { fetchSun } = require('../widgets/sun');
const { fetchUv } = require('../widgets/uv');
const { fetchChessDaily } = require('../widgets/chess');
const { fetchMarkets } = require('../widgets/markets');
const { renderTokens } = require('../widgets/_tokens');
const { loadWebhook } = require('./webhook-store');
const { loadBatteryState } = require('./battery-store');
const { homeValue, homeCoords, homeLoc } = require('./home');

// Which {{token}} names appear anywhere in the layout's settings or the
// scheduled-message config. Drives data fetches for token-only screens
// (e.g. a text strip with {{temp}} but no weather widget). Scanning every
// string is safe — this only decides what to FETCH; resolution itself is
// key-whitelisted in buildTileCtx.
function scanTokenNames(layout, cfg) {
  const used = new Set();
  const scan = (val) => {
    if (typeof val === 'string') {
      for (const m of val.matchAll(/\{\{\s*(\w+)/g)) used.add(m[1]);
    } else if (Array.isArray(val)) {
      val.forEach(scan);
    } else if (val && typeof val === 'object') {
      Object.values(val).forEach(scan);
    }
  };
  for (const it of layout || []) scan(it && it.settings);
  scan(cfg && cfg.message);
  return used;
}

async function buildWidgetData(cfg, units, layout) {
  const ids = new Set((layout || []).map(it => it.widgetId || it.id));
  const usedTokens = scanTokenNames(layout, cfg);
  // `ai` is included because a briefing with no weather is a poor briefing,
  // and both feeds are cached — an ai tile shouldn't pay for a fetch the
  // dashboard would usually have made anyway.
  const wantWeather = ids.has('weather_hero') || ids.has('weather_forecast') || ids.has('ai')
    || ['temp', 'tempHi', 'tempLo', 'weather'].some(t => usedTokens.has(t));
  // The aqi WIDGET is gone (folded into `outdoors`, which fetches per tile),
  // but the {{aqi}} token still resolves from the global fetch.
  const wantAqi = usedTokens.has('aqi');
  // `daily` fetches On-this-day only when that is the view it draws.
  const wantOtd = (layout || []).some(it => (it.widgetId || it.id) === 'daily'
    && ((it.settings && it.settings.variant) || 'quote') === 'onthisday');
  const loc = homeLoc(cfg);

  // Merge legacy single icalUrl into icalUrls array so the calendar
  // fetcher always sees one shape.
  let icalUrls = (homeValue(cfg, 'icalUrls') || []).filter(Boolean);
  if (!icalUrls.length) {
    icalUrls = (cfg.calendar && Array.isArray(cfg.calendar.icalUrls) && cfg.calendar.icalUrls.length)
      ? cfg.calendar.icalUrls.filter(Boolean)
      : (cfg.calendar && cfg.calendar.icalUrl ? [cfg.calendar.icalUrl] : []);
  }
  // {{nextEvent}} needs the global events feed. If the global calendar
  // config is empty but calendar tiles carry their own feeds, borrow the
  // union of those so the token still resolves.
  const wantEvents = ids.has('calendar') || ids.has('ai') || usedTokens.has('nextEvent');
  if (usedTokens.has('nextEvent') && !icalUrls.length) {
    const seen = new Set();
    for (const it of layout || []) {
      if ((it.widgetId || it.id) !== 'calendar') continue;
      const s = it.settings || {};
      const disabled = new Set(Array.isArray(s.disabledFeeds) ? s.disabledFeeds : []);
      for (const u of (Array.isArray(s.icalUrls) ? s.icalUrls : [])) {
        if (u && !disabled.has(u)) seen.add(u);
      }
    }
    icalUrls = [...seen];
  }

  const [
    weather, events, alerts, aqi, onThisDay
  ] = await Promise.all([
    wantWeather ? fetchWeather(loc, units) : null,
    (wantEvents && icalUrls.length)
      ? Promise.all(icalUrls.map(u => fetchEvents(u))).then(lists => mergeEvents(lists.flat()))
      : [],
    (wantWeather && cfg.alerts !== false && homeCoords(cfg))
      ? fetchAlerts(homeCoords(cfg)) : [],
    wantAqi ? fetchAqi(loc) : null,
    wantOtd ? fetchOnThisDay() : null
  ]);

  // Context for {{token}} interpolation in user-facing text widgets.
  // Loaded once here so per-tile message rendering doesn't re-read battery
  // or duplicate Date.now() per tile.
  const battery = await loadBatteryState();
  const tokenCtx = {
    now: Date.now(),
    timezone: homeValue(cfg, 'timezone') || 'UTC',
    cfg, weather, battery, units, events, aqi,
    lastRefresh: Date.now(),
  };

  const resolvedMessage = ids.has('text') ? resolveMessage(cfg, tokenCtx) : null;

  // Attach alerts onto weather so the renderer can show a banner without
  // a separate top-level lookup.
  if (weather && alerts && alerts.length) weather.alerts = alerts;

  // Per-instance widget data. Items with `item.settings` get fetched
  // separately and rendered with their own slot, overriding the global
  // one. Widget-level caches already dedup repeated identical inputs.
  const perItem = {};
  // Per-tile location resolver. A tile that carries its own coordinates or
  // city wins; otherwise it inherits Setup (cfg.home) — stage 3 of
  // docs/setup-architecture.md. Before that, a weather tile with no location
  // of its own rendered NO DATA forever, so every weather tile had to be
  // told where it was even though the dashboard already knew.
  //
  // This does not weaken the self-contained-settings contract: the tile still
  // gets its OWN fetch and its own slot. What it inherits is where to look,
  // not another tile's data.
  const resolveLoc = (eff) => {
    if (Number.isFinite(eff.lat) && Number.isFinite(eff.lon)) {
      return { lat: eff.lat, lon: eff.lon };
    }
    if (eff.city && typeof eff.city === 'string') return eff.city;
    return homeLoc(cfg) || null;
  };
  // Alerts need real coordinates, so a city-only tile has none to give.
  const resolveCoords = (eff) => (
    (Number.isFinite(eff.lat) && Number.isFinite(eff.lon))
      ? { lat: eff.lat, lon: eff.lon }
      : (eff.city ? null : homeCoords(cfg))
  );
  await Promise.all((layout || []).map(async (item) => {
    if (!item) return;
    const wid = item.widgetId || item.id;
    // Every kept widget is on the self-contained-settings contract:
    // always populate the per-item slot from `item.settings`, falling
    // back to {} so the renderer never silently inherits global cfg.
    const eff = item.settings || {};
    const slot = {};
    try {
      switch (wid) {
        // --- Data-fetched widgets ---
        case 'calendar': {
          // New contract: always set slot.events. Empty URL list resolves
          // to [] so the renderer never reaches the global cfg.calendar.
          // disabledFeeds (per-tile) filters URLs without removing them
          // from the configured list so the user can flip a feed off
          // temporarily.
          const allUrls = Array.isArray(eff.icalUrls) ? eff.icalUrls.filter(Boolean) : [];
          const disabled = new Set(Array.isArray(eff.disabledFeeds) ? eff.disabledFeeds : []);
          const urls = allUrls.filter(u => !disabled.has(u));
          // Quick events (settings.localEvents) are expanded at render
          // time by the shared calendar module, so the editor's modal
          // preview shows them live while typing — the slot carries feed
          // events only.
          if (urls.length) {
            const lists = await Promise.all(urls.map(u => fetchEvents(u)));
            slot.events = mergeEvents(lists.flat());
          } else {
            slot.events = [];
          }
          break;
        }

        // --- Push-fed widgets ---
        case 'webhook': {
          // Latest payload POSTed to /api/webhook/<key>, or null when the
          // key is unset/never pushed — the renderer shows its setup /
          // waiting state instead of inheriting anything global.
          const key = (typeof eff.key === 'string' && eff.key.trim()) ? eff.key.trim() : '';
          slot.webhook = key ? await loadWebhook(key) : null;
          break;
        }

        // --- Location-derived widgets ---
        case 'weather_hero': {
          // New contract: always populate slot.weather. Empty location
          // resolves to a "NO DATA" stub so the renderer can't fall back
          // to global cfg.weather for this tile.
          const loc = resolveLoc(eff);
          const effUnits = (eff.unitsOverride === 'F' || eff.unitsOverride === 'C')
            ? eff.unitsOverride : units;
          slot.units = effUnits;
          slot.weather = await fetchWeather(loc, effUnits);
          const alertLoc = resolveCoords(eff);
          if (slot.weather && loc && alertLoc) {
            const alerts = await fetchAlerts(alertLoc).catch(() => []);
            if (alerts && alerts.length) slot.weather.alerts = alerts;
          }
          break;
        }
        case 'weather_forecast': {
          // New contract: same as weather_hero — always populate slot
          // even if the tile has no configured location.
          const loc = resolveLoc(eff);
          const effUnits = (eff.unitsOverride === 'F' || eff.unitsOverride === 'C')
            ? eff.unitsOverride : units;
          slot.units = effUnits;
          slot.weather = await fetchWeather(loc, effUnits);
          const alertLoc = resolveCoords(eff);
          if (slot.weather && loc && alertLoc) {
            const alerts = await fetchAlerts(alertLoc).catch(() => []);
            if (alerts && alerts.length) slot.weather.alerts = alerts;
          }
          // Per-item forecast-day override travels with the slot so the
          // renderer doesn't read cfg.weather.forecastDays for this tile.
          if (Number.isFinite(eff.forecastDays) && slot.weather) {
            slot.weather.forecastDays = eff.forecastDays;
          }
          break;
        }

        // --- Pre-resolved synthesized slots ---
        case 'text': {
          // Merged text widget. Tokens / schedule windows resolve here
          // so the SSR render fn stays a pure string template.
          if ((eff.variant || 'bar') === 'card') {
            slot.resolvedMessage = resolveMessage(
              { timezone: homeValue(cfg, 'timezone'), message: eff },
              tokenCtx
            );
          } else {
            slot.resolvedText = {
              text:     renderTokens(eff.text || '',     tokenCtx),
              subtitle: renderTokens(eff.subtitle || '', tokenCtx),
            };
          }
          break;
        }

        // --- Mac-only widgets — return null off-mac, renderer shows
        // "MAC OFFLINE" placeholder. ---
        case 'clock':
          // The zones views render from settings.zones in the browser; only
          // the local view needs a server-built clock.
          if (((eff && eff.variant) || 'big') === 'big') {
            slot.clockNow = buildClock(eff, homeValue(cfg, 'timezone'));
          }
          break;
        case 'codeactivity':
          slot.codeActivity = await fetchCodeActivity(eff.username || homeValue(cfg, 'githubUser'));
          break;
        case 'photo':
          slot.photo = await fetchPhoto(eff, item);
          break;
        case 'headlines':
          slot.headlines = await fetchHeadlines(eff);
          break;
        case 'tasks':
          slot.tasks = await fetchTasks(eff);
          break;
        case 'transit':
          slot.transit = await fetchTransit(eff);
          break;
        case 'outdoors': {
          // One widget, three views; fetch only what the chosen view draws.
          // Location is the dashboard's, with a per-tile override if the tile
          // carries one — same rule the three separate widgets used.
          const where = resolveLoc(eff) || loc;
          const view = eff.variant || 'sun';
          if (view === 'uv') slot.uv = await fetchUv(where);
          else if (view === 'air') slot.aqi = await fetchAqi(where);
          else slot.sun = await fetchSun(where);
          break;
        }
        case 'chess':
          slot.chessPuzzle = await fetchChessDaily();
          break;
        case 'markets':
          slot.markets = await fetchMarkets(eff);
          break;
        case 'sparkline': {
          // Battery sources use the globally-injected batteryHistory; only
          // the weather-hourly sources need a per-tile weather fetch.
          if (eff.source === 'weather_temp' || eff.source === 'weather_precip') {
            const loc = resolveLoc(eff);
            const effUnits = (eff.unitsOverride === 'F' || eff.unitsOverride === 'C')
              ? eff.unitsOverride : units;
            slot.units = effUnits;
            slot.weather = await fetchWeather(loc, effUnits);
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.warn(`per-item fetch failed (${wid}/${item.id}):`, err.message);
    }
    if (Object.keys(slot).length) perItem[item.id] = slot;
  }));

  // AI runs last and on its own, because it is the only widget whose input is
  // the other widgets' output. Running it inside the loop above would race
  // whichever tiles hadn't resolved yet; here weather/events are settled and
  // perItem holds what each tile fetched (headlines feeds, tasks, now
  // playing), so the prompt sees the same dashboard the panel will show.
  const aiItems = (layout || []).filter(it => (it.widgetId || it.id) === 'ai');
  if (aiItems.length) {
    // Human-readable list of the other tiles sharing this screen, so the
    // prompt can tell the model what the reader can already see.
    const LABELS = {
      weather_hero: 'current weather', weather_forecast: 'multi-day forecast',
      clock: 'the time', world_clock: 'other timezones', calendar: 'calendar events',
      headlines: 'news headlines', tasks: 'task list', aqi: 'air quality',
      uv: 'UV index', sun: 'sunrise/sunset', moon: 'moon phase',
      eink_battery: 'panel battery',
      markets: 'market prices',
      fx: 'exchange rates', countdown: 'a countdown', progress: 'progress bars',
    };
    const otherWidgets = [...new Set((layout || [])
      .map(it => it.widgetId || it.id)
      .filter(id => id !== 'ai')
      .map(id => LABELS[id])
      .filter(Boolean))];

    // Headlines, on the same reasoning as weather and calendar above: asking
    // an ai tile for anything about the news is a reasonable thing to do, and
    // it should not depend on whether a headlines TILE happens to share the
    // screen. Only fetched when no headlines tile already supplied them, and
    // the fetcher caches, so this is at most one feed read per cycle.
    let aiHeadlines = null;
    for (const slot of Object.values(perItem)) {
      if (slot.headlines) { aiHeadlines = slot.headlines; break; }
    }
    if (!aiHeadlines) {
      try {
        const src = (cfg.savedFeeds && cfg.savedFeeds[0]) || {};
        aiHeadlines = await fetchHeadlines({
          source: src.source || 'news',
          newsSource: src.newsSource || 'bbc',
          feedUrl: src.feedUrl,
          count: 8,
        });
      } catch (err) {
        console.warn('ai: headlines fetch failed:', err.message);
      }
    }
    const merged = { weather, events, aqi, units, city: homeValue(cfg, 'city') || '', home: cfg.home,
      headlines: aiHeadlines, otherWidgets, now: Date.now() };
    for (const slot of Object.values(perItem)) {
      // First tile to supply a feed wins — these are display context, not
      // authoritative data, so a second headlines tile adding nothing is fine.
      for (const k of ['tasks']) {
        if (merged[k] == null && slot[k] != null) merged[k] = slot[k];
      }
    }
    await Promise.all(aiItems.map(async (item) => {
      const eff = { ...(item.settings || {}) };
      try {
        // A tile's own feeds REPLACE the shared default for that tile: if you
        // went to the trouble of naming a source, that is the one you want
        // read, not it plus BBC. fetchHeadlines runs user-supplied URLs
        // through the SSRF guard, which is why this reuses it rather than
        // fetching the URL directly.
        let ctx = merged;
        const feeds = Array.isArray(eff.feedUrls)
          ? eff.feedUrls.map(u => String(u || '').trim()).filter(Boolean)
          : [];
        if (feeds.length) {
          try {
            const own = await fetchHeadlines({ source: 'rss', feedUrl: feeds[0],
              feedUrls: feeds.slice(1), count: 8 });
            if (own) ctx = { ...merged, headlines: own };
          } catch (err) {
            console.warn(`ai: tile feed fetch failed (${item.id}):`, err.message);
          }
        }
        const ai = await fetchAi(eff, ctx, item.id);
        if (ai) perItem[item.id] = { ...(perItem[item.id] || {}), ai };
      } catch (err) {
        // fetchAi already degrades to last-good internally; this only catches
        // a programming error, which must not take the whole render down.
        console.warn(`ai fetch failed (${item.id}):`, err.message);
      }
    }));
  }

  return {
    weather, events, aqi, onThisDay,
    resolvedMessage,
    perItem
  };
}

// Sort + dedupe merged calendar events. Keys by title+startISO so the same
// event coming from two feeds doesn't double-render.
function mergeEvents(list) {
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const k = `${e.title}|${e.startISO || e.startLabel || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => {
    const ka = a.startISO || '';
    const kb = b.startISO || '';
    return ka.localeCompare(kb);
  });
}

module.exports = { buildWidgetData, mergeEvents };
