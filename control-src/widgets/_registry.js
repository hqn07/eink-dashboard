// Per-widget registry. Each widget lives in two sibling files:
//   <id>.js        — def + render (pure JS string templates, no React)
//   <id>.form.jsx  — React Form component for the WidgetSettings modal
//
// def + render are the server-importable half (server.js dynamically
// imports the .js files for SSR); Form is React-only and only the
// client bundle pulls it in.

import * as calendar         from './calendar.js';
import * as clock            from './clock.js';
import * as eink_battery     from './eink_battery.js';
import * as mac_battery      from './mac_battery.js';
import * as mac_nowplaying   from './mac_nowplaying.js';
import * as message          from './message.js';
import * as text_bar         from './text_bar.js';
import * as weather_forecast from './weather_forecast.js';
import * as weather_hero     from './weather_hero.js';

import { Form as calendarForm }        from './calendar.form.jsx';
import { Form as clockForm }           from './clock.form.jsx';
import { Form as einkBatteryForm }     from './eink_battery.form.jsx';
import { Form as macBatteryForm }      from './mac_battery.form.jsx';
import { Form as macNowPlayingForm }   from './mac_nowplaying.form.jsx';
import { Form as messageForm }         from './message.form.jsx';
import { Form as textBarForm }         from './text_bar.form.jsx';
import { Form as weatherForecastForm } from './weather_forecast.form.jsx';
import { Form as weatherHeroForm }     from './weather_hero.form.jsx';

const MODULES = [
  calendar, clock, eink_battery, mac_battery, mac_nowplaying,
  message, text_bar, weather_forecast, weather_hero
];

const FORMS = {
  calendar:         calendarForm,
  clock:            clockForm,
  eink_battery:     einkBatteryForm,
  mac_battery:      macBatteryForm,
  mac_nowplaying:   macNowPlayingForm,
  message:          messageForm,
  text_bar:         textBarForm,
  weather_forecast: weatherForecastForm,
  weather_hero:     weatherHeroForm
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
