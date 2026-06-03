// Server-side render entry. server.js dynamically imports this so the
// Express handlers can produce dashboard HTML without dragging React /
// JSX into Node's import graph (which would happen if we imported
// _registry.js — that pulls in every <id>.form.jsx).

import * as calendar         from './calendar.js';
import * as clock            from './clock.js';
import * as eink_battery     from './eink_battery.js';
import * as mac_battery      from './mac_battery.js';
import * as mac_nowplaying   from './mac_nowplaying.js';
import * as message          from './message.js';
import * as stocks           from './stocks.js';
import * as weather_forecast from './weather_forecast.js';
import * as weather_hero     from './weather_hero.js';

const MODULES = [
  calendar, clock, eink_battery, mac_battery, mac_nowplaying,
  message, stocks, weather_forecast, weather_hero
];

export const DEFS = Object.fromEntries(MODULES.map(m => [m.def.id, m.def]));
export const RENDERERS = Object.fromEntries(MODULES.map(m => [m.def.id, m.render]));

export function renderWidget(id, data) {
  const fn = RENDERERS[id];
  if (!fn) return '';
  try { return fn(data || {}); } catch { return ''; }
}

export {
  DEFAULT_CHROME,
  renderHeader, renderFooter,
  isHeaderOn, isFooterOn,
  headerVariant, footerVariant,
  typographyCss,
  scaleWrap,
  cellClasses
} from './_chrome.js';
