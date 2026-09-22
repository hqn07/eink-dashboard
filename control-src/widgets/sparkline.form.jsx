import { buildForm } from './_schema.jsx';

const isWeather = (v) => v.source === 'weather_temp' || v.source === 'weather_precip';

export const FIELDS = [
  {
    key: 'source', type: 'select', label: 'Source', section: 'Data',
    options: [
      { value: 'weather_temp',   label: 'Weather — hourly temperature' },
      { value: 'weather_precip', label: 'Weather — hourly precipitation' },
      { value: 'battery_pct',    label: 'E-ink battery %' },
      { value: 'battery_v',      label: 'E-ink battery voltage' }
    ],
    help: (v) => (isWeather(v)
      ? 'Charts the coming hours from the forecast.'
      : 'Built from the readings the device pushes each refresh.')
  },
  { type: 'location', section: 'Data', when: isWeather },
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: (v) => (isWeather(v) ? 'TEMPERATURE' : 'BATTERY'),
    help: 'Leave blank to use the source name.'
  }
];

export const Form = buildForm(FIELDS);
