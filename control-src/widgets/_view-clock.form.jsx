import { buildForm } from './_schema.jsx';

// Layout (big / thin / banner) lives in the auto-rendered variant picker
// (contract v2) — no hand-rolled style field here.
const PRESETS = [
  { id: 'big',  label: 'Big chunky with date',
    values: { variant: 'big',  showDate: true,  format: '12h' } },
  { id: 'thin', label: 'Thin clean with date',
    values: { variant: 'thin', showDate: true,  format: '12h' } },
  { id: 'time_only', label: 'Time only (no date)',
    values: { variant: 'big',  showDate: false, format: '12h' } },
  { id: '24h', label: '24-hour minimal',
    values: { variant: 'thin', showDate: true,  format: '24h' } }
];

export const FIELDS = [
  { type: 'presets', presets: PRESETS },
  {
    key: 'format', type: 'segmented', label: 'Format',
    options: [
      { value: '12h', short: '12h', label: '12-hour (3:34 PM)' },
      { value: '24h', short: '24h', label: '24-hour (15:34)' }
    ]
  },
  { key: 'showDate', type: 'toggle', label: 'Show date below time' }
];

export const Form = buildForm(FIELDS);
