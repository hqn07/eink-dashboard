// Server-side render entry. server.js dynamically imports this so the
// Express handlers can produce dashboard HTML without dragging React /
// JSX into Node's import graph (which would happen if we imported
// _registry.js — that pulls in every <id>.form.jsx).

import * as aqi              from './aqi.js';
import * as calendar         from './calendar.js';
import * as codeactivity     from './codeactivity.js';
import * as clock            from './clock.js';
import * as countdown        from './countdown.js';
import * as crypto           from './crypto.js';
import * as eink_battery     from './eink_battery.js';
import * as fx               from './fx.js';
import * as headlines        from './headlines.js';
import * as mac_battery      from './mac_battery.js';
import * as mac_nowplaying   from './mac_nowplaying.js';
import * as moon             from './moon.js';
import * as onthisday        from './onthisday.js';
import * as photo            from './photo.js';
import * as progress         from './progress.js';
import * as qr               from './qr.js';
import * as quote            from './quote.js';
import * as sparkline        from './sparkline.js';
import * as sun              from './sun.js';
import * as tasks            from './tasks.js';
import * as text             from './text.js';
import * as transit          from './transit.js';
import * as webhook          from './webhook.js';
import * as weather_forecast from './weather_forecast.js';
import * as weather_hero     from './weather_hero.js';
import * as world_clock      from './world_clock.js';
import * as wordofday        from './wordofday.js';

const MODULES = [
  aqi, calendar, codeactivity, clock, countdown, eink_battery, mac_battery, mac_nowplaying,
  headlines, moon, onthisday, photo, progress, qr, fx, crypto, quote, sparkline, sun, tasks, text, transit, webhook, weather_forecast, weather_hero, world_clock, wordofday
];

export const DEFS = Object.fromEntries(MODULES.map(m => [m.def.id, m.def]));
export const RENDERERS = Object.fromEntries(MODULES.map(m => [m.def.id, m.render]));

export function renderWidget(id, data) {
  const fn = RENDERERS[id];
  if (!fn) return '';
  try { return fn(data || {}); } catch { return ''; }
}

export {
  typographyCss,
  scaleWrap,
  cellClasses,
  buildTileCtx,
  tileCellClasses
} from './_chrome.js';

// Frozen demo data — /widgets-matrix uses it to fill slots that have
// no live data (clock, batteries, now-playing) so the matrix shows
// real layouts instead of SETUP NEEDED placeholders.
export { demoCtxForWidget } from './_pool_demo.js';
