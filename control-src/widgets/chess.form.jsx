import { buildForm } from './_schema.jsx';

export const FIELDS = [
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: 'DAILY PUZZLE'
  },
  { key: 'showMeta', type: 'toggle', label: 'Rating + themes footer' }
];

export const Form = buildForm(FIELDS);
