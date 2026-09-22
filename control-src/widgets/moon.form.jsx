import { buildForm } from './_schema.jsx';

export const FIELDS = [
  {
    type: 'note',
    text: 'Current moon phase + illumination, computed from the date. No location or '
      + 'API key needed.'
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: 'MOON',
    help: 'Leave blank to keep the default heading.'
  }
];

export const Form = buildForm(FIELDS);
