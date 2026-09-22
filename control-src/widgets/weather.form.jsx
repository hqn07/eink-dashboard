import { buildForm } from './_schema.jsx';
import { STAT_OPTIONS } from './weather.js';

// One form for both weather views.
//
// The Data section is shared — location and units are the same question
// whichever view draws. Everything below it belongs to one view and only that
// view's fields render: the two old forms had 9 and 10 fields each and were the
// worst pair in the September audit, but nobody configures both halves at once.

const DEFAULT_STATS = ['feels', 'humid', 'wind', 'cloud_or_rise'];
const isForecast = (v) => String(v.variant || 'now').startsWith('forecast');

const NOW_PRESETS = [
  { id: 'editorial', label: 'Editorial — current default',
    values: { stats: ['feels', 'humid', 'wind', 'cloud_or_rise'],
              showDesc: true, showStats: true, showAlerts: true, showSunbar: true, showHourly: true } },
  { id: 'minimal',   label: 'Minimal — just the temperature',
    values: { stats: DEFAULT_STATS,
              showDesc: false, showStats: false, showAlerts: false, showSunbar: false, showHourly: false } },
  { id: 'wind',      label: 'Wind-focused — wind + gust + cloud + rise',
    values: { stats: ['wind', 'gust', 'cloud', 'rise'],
              showDesc: true, showStats: true, showAlerts: true, showSunbar: false, showHourly: false } },
  { id: 'sun',       label: 'Sun — sunrise / sunset + hourly',
    values: { stats: ['humid', 'cloud', 'rise', 'set'],
              showDesc: true, showStats: true, showAlerts: false, showSunbar: true, showHourly: true } }
];

const FORECAST_PRESETS = [
  { id: 'default', label: 'Default — stacked HI/LO, auto precip',
    values: { hiloStyle: 'stack',  precipMode: 'auto',   showIcons: true,  showDayName: true } },
  { id: 'compact', label: 'Compact — inline, no precip, no icons',
    values: { hiloStyle: 'inline', precipMode: 'never',  showIcons: false, showDayName: true } },
  { id: 'arrows',  label: 'Arrows — ↑HI · ↓LO',
    values: { hiloStyle: 'arrows', precipMode: 'always', showIcons: true,  showDayName: true } },
  { id: 'numbers', label: 'Numbers only — no icons, no day names',
    values: { hiloStyle: 'inline', precipMode: 'never',  showIcons: false, showDayName: false } }
];

export const FIELDS = [
  // ---- shared -----------------------------------------------------------
  { type: 'location', section: 'Data' },
  {
    key: 'unitsOverride', type: 'select', label: 'Units (this tile only)', section: 'Data',
    options: [
      { value: 'inherit', label: 'Inherit (dashboard default)' },
      { value: 'F',       label: 'Force °F' },
      { value: 'C',       label: 'Force °C' }
    ],
    help: "Overrides this tile's reading only — dashboard's main unit stays the same."
  },

  // ---- forecast ---------------------------------------------------------
  { type: 'presets', presets: FORECAST_PRESETS, when: isForecast },
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: 'N-DAY OUTLOOK',
    help: 'Leave blank for the default (varies with day count).',
    when: isForecast
  },
  {
    key: 'forecastDays', type: 'select', label: 'Days to show',
    options: [
      { value: 'auto', label: 'Auto (fit tile)' },
      { value: '3', label: '3 days' }, { value: '4', label: '4 days' },
      { value: '5', label: '5 days' }, { value: '6', label: '6 days' },
      { value: '7', label: '7 days' }, { value: '8', label: '8 days (with today)' }
    ],
    // Stored as a number or null; the picker speaks strings and calls null
    // "auto". The renderer keeps reading exactly what it always read.
    toField: (x) => (Number.isFinite(x) ? String(x) : 'auto'),
    fromField: (x) => (x === 'auto' ? null : parseInt(x, 10)),
    help: 'Auto scales with the tile — height in rows, width in columns. 8 needs Include today on.',
    when: isForecast
  },
  { key: 'includeToday', type: 'toggle', label: 'Include today', when: isForecast },
  { key: 'showDayName', type: 'toggle', label: 'Day name (MON / TUE / …)', when: isForecast },
  { key: 'showIcons', type: 'toggle', label: 'Weather icons', when: isForecast },
  {
    key: 'precipMode', type: 'segmented', label: 'Precipitation %', section: 'Layout',
    options: [
      { value: 'auto',   short: 'Auto',   label: 'Auto — wide tiles only' },
      { value: 'always', short: 'Always', label: 'Always show' },
      { value: 'never',  short: 'Hide',   label: 'Hide' }
    ],
    when: isForecast
  },
  {
    key: 'hiloStyle', type: 'segmented', label: 'High / low style', section: 'Layout',
    options: [
      { value: 'stack',  short: 'Stack',  label: 'Stacked (HI on top)' },
      { value: 'inline', short: 'Inline', label: 'Inline (HI / LO)' },
      { value: 'arrows', short: 'Arrows', label: 'Arrows (↑HI ↓LO)' }
    ],
    when: isForecast
  },

  // ---- now --------------------------------------------------------------
  { type: 'presets', presets: NOW_PRESETS, when: (v) => !isForecast(v) },
  { key: 'showDesc', type: 'toggle', label: 'Description (OVERCAST / CLEAR / …)', when: (v) => !isForecast(v) },
  { key: 'showStats', type: 'toggle', label: 'Stats grid', when: (v) => !isForecast(v) },
  { key: 'showAlerts', type: 'toggle', label: 'Severe weather alert banner', when: (v) => !isForecast(v) },
  { key: 'showSunbar', type: 'toggle', label: 'Sun bar (sunrise → sunset)', when: (v) => !isForecast(v) },
  { key: 'showHourly', type: 'toggle', label: 'Hourly forecast strip', when: (v) => !isForecast(v) },
  {
    type: 'note', section: 'Layout', collapse: 'Stats grid slots', collapseScope: 'weather-now-stats',
    text: 'Pick what fills each of the four slots. Only shows on standard tier and up.',
    when: (v) => !isForecast(v)
  },
  {
    key: 'stats', type: 'slots', section: 'Layout',
    collapse: 'Stats grid slots', collapseScope: 'weather-now-stats',
    count: 4, options: STAT_OPTIONS, fallback: DEFAULT_STATS,
    when: (v) => !isForecast(v)
  }
];

export const Form = buildForm(FIELDS);
