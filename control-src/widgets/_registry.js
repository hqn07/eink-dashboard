// Per-widget registry. Each widget lives in two sibling files:
//   <id>.js        — def + render (pure JS string templates, no React)
//   <id>.form.jsx  — React Form component for the WidgetSettings modal
//
// Contract v2 (widgets-refresh W1) — def fields:
//   id, label, requires, minSize, sizes, defaultSize, defaults()
//   variants?       { <name>: { label } } — named layout variants; the
//                   settings modal auto-renders a visual picker and the
//                   chosen name rides on ctx.variant via buildTileCtx.
//   defaultVariant? name used when the tile hasn't picked one.
//   degrade?        { <tier>: [elements dropped] } — advisory map of
//                   what the render drops at small tiers; W2 widget
//                   passes fill these in as each widget is rebuilt.
//
// def + render are the server-importable half (server.js dynamically
// imports the .js files for SSR); Form is React-only and only the
// client bundle pulls it in.

import * as aqi              from './aqi.js';
import * as calendar         from './calendar.js';
import * as codeactivity     from './codeactivity.js';
import * as clock            from './clock.js';
import * as countdown        from './countdown.js';
import * as eink_battery     from './eink_battery.js';
import * as mac_battery      from './mac_battery.js';
import * as mac_nowplaying   from './mac_nowplaying.js';
import * as moon             from './moon.js';
import * as onthisday        from './onthisday.js';
import * as qr               from './qr.js';
import * as quote            from './quote.js';
import * as sparkline        from './sparkline.js';
import * as text             from './text.js';
import * as weather_forecast from './weather_forecast.js';
import * as weather_hero     from './weather_hero.js';
import * as world_clock      from './world_clock.js';

import { Form as aqiForm }             from './aqi.form.jsx';
import { Form as calendarForm }        from './calendar.form.jsx';
import { Form as codeActivityForm }    from './codeactivity.form.jsx';
import { Form as clockForm }           from './clock.form.jsx';
import { Form as countdownForm }       from './countdown.form.jsx';
import { Form as einkBatteryForm }     from './eink_battery.form.jsx';
import { Form as macBatteryForm }      from './mac_battery.form.jsx';
import { Form as macNowPlayingForm }   from './mac_nowplaying.form.jsx';
import { Form as moonForm }            from './moon.form.jsx';
import { Form as onThisDayForm }       from './onthisday.form.jsx';
import { Form as qrForm }              from './qr.form.jsx';
import { Form as quoteForm }           from './quote.form.jsx';
import { Form as sparklineForm }       from './sparkline.form.jsx';
import { Form as textForm }            from './text.form.jsx';
import { Form as weatherForecastForm } from './weather_forecast.form.jsx';
import { Form as weatherHeroForm }     from './weather_hero.form.jsx';
import { Form as worldClockForm }      from './world_clock.form.jsx';

const MODULES = [
  aqi, calendar, codeactivity, clock, countdown, eink_battery, mac_battery, mac_nowplaying,
  moon, onthisday, qr, quote, sparkline, text, weather_forecast, weather_hero, world_clock
];

const FORMS = {
  aqi:              aqiForm,
  calendar:         calendarForm,
  codeactivity:     codeActivityForm,
  clock:            clockForm,
  countdown:        countdownForm,
  eink_battery:     einkBatteryForm,
  mac_battery:      macBatteryForm,
  mac_nowplaying:   macNowPlayingForm,
  moon:             moonForm,
  onthisday:        onThisDayForm,
  qr:               qrForm,
  quote:            quoteForm,
  sparkline:        sparklineForm,
  text:             textForm,
  weather_forecast: weatherForecastForm,
  weather_hero:     weatherHeroForm,
  world_clock:      worldClockForm
};

export const MIGRATED_DEFS = Object.fromEntries(
  MODULES.map(m => [m.def.id, m.def])
);

export const MIGRATED_RENDERERS = Object.fromEntries(
  MODULES.map(m => [m.def.id, m.render])
);

export const MIGRATED_FORMS = FORMS;

// Server-side entry point. server.js imports this so it can build the
// dashboard HTML without pulling React/JSX into the Node import graph.
export const WIDGET_IDS = MODULES.map(m => m.def.id);
