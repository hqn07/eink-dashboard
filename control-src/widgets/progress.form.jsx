import { buildForm } from './_schema.jsx';

export const FIELDS = [
  {
    key: 'spans', type: 'multi', label: 'Show', section: 'Spans',
    options: [
      { value: 'day',   label: 'Day' },
      { value: 'week',  label: 'Week' },
      { value: 'month', label: 'Month' },
      { value: 'year',  label: 'Year' }
    ],
    help: 'At least one — a tile with no spans has nothing to draw.'
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', section: 'Spans', tokens: true,
    placeholder: 'PROGRESS',
    help: 'Leave blank to keep the default heading.'
  }
];

export const Form = buildForm(FIELDS);
