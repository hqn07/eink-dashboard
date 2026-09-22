import { buildForm } from './_schema.jsx';

export const FIELDS = [
  {
    key: 'target', type: 'text', label: 'Target date',
    placeholder: '2026-12-25',
    help: 'YYYY-MM-DD (or YYYY-MM-DDTHH:MM for a specific time).'
  },
  {
    key: 'repeat', type: 'select', label: 'Repeats',
    options: [
      { value: 'none',    label: 'Never — one-shot date' },
      { value: 'weekly',  label: 'Weekly' },
      { value: 'monthly', label: 'Monthly' },
      { value: 'yearly',  label: 'Yearly (birthdays)' }
    ],
    help: 'After the date passes, count to the next occurrence instead of going negative.'
  },
  {
    key: 'label', type: 'text', label: 'Label', tokens: true,
    placeholder: 'until launch',
    help: 'Shown under the number. Optional.'
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: 'COUNTDOWN',
    help: 'Leave blank to keep the default heading.'
  }
];

export const Form = buildForm(FIELDS);
