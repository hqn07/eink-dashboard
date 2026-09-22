import { buildForm } from './_schema.jsx';

// One form, three views. Each view's controls appear only when that view is
// selected — the Variant picker already chose what the tile shows, so asking
// again here would be asking twice.
const BLURB = {
  sun: 'Sunrise, sunset and daylight length for your dashboard location. No API key needed.',
  uv:  'UV index and WHO band for your dashboard location. No API key needed (Open-Meteo).',
  air: 'Air quality (US AQI) for your dashboard location. No API key needed.'
};
const PLACEHOLDER = { sun: 'SUN', uv: 'UV INDEX', air: 'AIR QUALITY' };

export const FIELDS = [
  {
    type: 'note',
    text: (v) => `${BLURB[v.variant || 'sun']} Set the place in Settings > Tools > You & your place.`
  },
  { key: 'hour24', type: 'toggle', label: '24-hour clock', when: (v) => (v.variant || 'sun') === 'sun' },
  {
    key: 'showDaylight', type: 'toggle', label: 'Show daylight length',
    when: (v) => (v.variant || 'sun') === 'sun'
  },
  {
    key: 'showPollutants', type: 'toggle', label: 'Pollutant line (PM2.5 · PM10)',
    when: (v) => v.variant === 'air'
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: (v) => PLACEHOLDER[v.variant || 'sun'],
    help: 'Leave blank to keep the default heading.'
  }
];

export const Form = buildForm(FIELDS);
