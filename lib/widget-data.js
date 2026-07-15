// Data fan-out for a dashboard render. Given a config + resolved layout, fetch
// exactly the data the on-screen widgets need — once globally, then per-tile
// for widgets carrying their own `settings`. Each widget fetcher keeps its own
// TTL cache, so duplicate identical inputs across tiles don't multiply API
// calls. Pure orchestration; holds no state of its own.
const { fetchWeather } = require('../widgets/weather');
const { fetchAqi } = require('../widgets/aqi');
const { fetchCodeActivity } = require('../widgets/codeactivity');
const { fetchOnThisDay } = require('../widgets/onthisday');
const { fetchEvents } = require('../widgets/calendar');
const { fetchAlerts } = require('../widgets/alerts');
const { resolveMessage } = require('../widgets/message');
const { fetchMacNowPlaying } = require('../widgets/macnowplaying');
const { fetchMacBattery } = require('../widgets/macbattery');
const { buildClock } = require('../widgets/clock');
const { fetchPhoto } = require('../widgets/photo');
const { fetchHeadlines } = require('../widgets/headlines');
const { fetchTasks } = require('../widgets/tasks');
const { fetchTransit } = require('../widgets/transit');
const { fetchFx } = require('../widgets/fx');
const { fetchCrypto } = require('../widgets/crypto');
const { fetchSun } = require('../widgets/sun');
const { fetchUv } = require('../widgets/uv');
const { fetchChessDaily } = require('../widgets/chess');
const { fetchStocks } = require('../widgets/stocks');
const { fetchBrief } = require('../widgets/brief');
const { renderTokens } = require('../widgets/_tokens');
const { loadWebhook } = require('./webhook-store');
const { loadBatteryState } = require('./battery-store');

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
  const wantWeather = ids.has('weather_hero') || ids.has('weather_forecast') || ids.has('brief')
    || ['temp', 'tempHi', 'tempLo', 'weather'].some(t => usedTokens.has(t));
  const wantAqi = ids.has('aqi') || usedTokens.has('aqi');
  const wantOtd = ids.has('onthisday');
  const loc = (Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon))
    ? { lat: cfg.lat, lon: cfg.lon }
    : cfg.city;

  // Merge legacy single icalUrl into icalUrls array so the calendar
  // fetcher always sees one shape.
  let icalUrls = (cfg.calendar && Array.isArray(cfg.calendar.icalUrls) && cfg.calendar.icalUrls.length)
    ? cfg.calendar.icalUrls.filter(Boolean)
    : (cfg.calendar && cfg.calendar.icalUrl ? [cfg.calendar.icalUrl] : []);
  // {{nextEvent}} needs the global events feed. If the global calendar
  // config is empty but calendar tiles carry their own feeds, borrow the
  // union of those so the token still resolves.
  const wantEvents = ids.has('calendar') || ids.has('brief') || usedTokens.has('nextEvent');
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
    wantWeather ? fetchWeather(loc, process.env.OPENWEATHER_API_KEY, units) : null,
    (wantEvents && icalUrls.length)
      ? Promise.all(icalUrls.map(u => fetchEvents(u))).then(lists => mergeEvents(lists.flat()))
      : [],
    (wantWeather && cfg.alerts !== false && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon))
      ? fetchAlerts({ lat: cfg.lat, lon: cfg.lon }) : [],
    wantAqi ? fetchAqi(loc) : null,
    wantOtd ? fetchOnThisDay() : null
  ]);

  // Context for {{token}} interpolation in user-facing text widgets.
  // Loaded once here so per-tile message rendering doesn't re-read battery
  // or duplicate Date.now() per tile.
  const battery = await loadBatteryState();
  const tokenCtx = {
    now: Date.now(),
    timezone: cfg.timezone || 'UTC',
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
  // Per-tile location resolver — used by weather overrides.
  const resolveLoc = (eff) => {
    if (Number.isFinite(eff.lat) && Number.isFinite(eff.lon)) {
      return { lat: eff.lat, lon: eff.lon };
    }
    if (eff.city && typeof eff.city === 'string') return eff.city;
    return null;
  };
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
          slot.weather = await fetchWeather(loc, process.env.OPENWEATHER_API_KEY, effUnits);
          if (slot.weather && loc && Number.isFinite(eff.lat) && Number.isFinite(eff.lon)) {
            const alerts = await fetchAlerts({ lat: eff.lat, lon: eff.lon }).catch(() => []);
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
          slot.weather = await fetchWeather(loc, process.env.OPENWEATHER_API_KEY, effUnits);
          if (slot.weather && loc && Number.isFinite(eff.lat) && Number.isFinite(eff.lon)) {
            const alerts = await fetchAlerts({ lat: eff.lat, lon: eff.lon }).catch(() => []);
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
              { timezone: cfg.timezone, message: eff },
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
        case 'mac_nowplaying':
          slot.macNowPlaying = await fetchMacNowPlaying();
          break;
        case 'mac_battery':
          slot.macBattery = await fetchMacBattery();
          break;
        case 'clock':
          slot.clockNow = buildClock(eff, cfg.timezone);
          break;
        case 'codeactivity':
          slot.codeActivity = await fetchCodeActivity(eff.username || cfg.githubUser);
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
        case 'fx':
          slot.fx = await fetchFx(eff);
          break;
        case 'crypto':
          slot.crypto = await fetchCrypto(eff);
          break;
        case 'sun':
          // Uses the dashboard's global location (like aqi), with a per-tile
          // lat/lon/city override if the tile carries one.
          slot.sun = await fetchSun(resolveLoc(eff) || loc);
          break;
        case 'uv':
          slot.uv = await fetchUv(resolveLoc(eff) || loc);
          break;
        case 'chess':
          slot.chessPuzzle = await fetchChessDaily();
          break;
        case 'stocks':
          slot.stocks = await fetchStocks(eff);
          break;
        case 'brief':
          // Brief consumes the page-level weather + events fetched above.
          slot.brief = await fetchBrief({ cfg, weather, events });
          break;
        case 'sparkline': {
          // Battery sources use the globally-injected batteryHistory; only
          // the weather-hourly sources need a per-tile weather fetch.
          if (eff.source === 'weather_temp' || eff.source === 'weather_precip') {
            const loc = resolveLoc(eff);
            const effUnits = (eff.unitsOverride === 'F' || eff.unitsOverride === 'C')
              ? eff.unitsOverride : units;
            slot.units = effUnits;
            slot.weather = await fetchWeather(loc, process.env.OPENWEATHER_API_KEY, effUnits);
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
