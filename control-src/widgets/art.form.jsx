import { buildForm } from './_schema.jsx';

// The pattern family comes from the shared variant picker (def.variants);
// these are the knobs under it.
export const FIELDS = [
  {
    key: 'density', type: 'slider', label: 'Cell size', section: 'Pattern',
    min: 12, max: 48, step: 2, format: (x) => `${x}px`,
    help: 'Smaller cells = finer weave.'
  },
  {
    key: 'seed', type: 'slider', label: 'Seed offset', section: 'Pattern',
    min: 0, max: 9, step: 1,
    help: 'The pattern reseeds daily; bump this so two tiles differ on the same day.'
  },
  { key: 'showDate', type: 'toggle', label: 'Date stamp', section: 'Pattern' }
];

export const Form = buildForm(FIELDS);
