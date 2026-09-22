import { buildForm } from './_schema.jsx';

// The key names the /api/webhook/<key> endpoint this tile listens to. The
// optional template turns the payload into custom lines; left blank, the
// widget auto-renders the payload's top-level fields.
export const FIELDS = [
  {
    key: 'key', type: 'text', label: 'Webhook key', section: 'Source',
    placeholder: 'e.g. steps',
    help: 'Letters/digits/dash/underscore. Push data with:'
  },
  {
    type: 'note', section: 'Source',
    text: '',
    code: (v) => `curl -X POST '<server>/api/webhook/${(v.key || '').trim() || '<key>'}`
      + `?token=<DEVICE_TOKEN>' -H 'Content-Type: application/json' -d '{"steps":8432}'`
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', section: 'Layout', tokens: true,
    placeholder: 'WEBHOOK',
    help: 'Leave blank to keep the default heading.'
  },
  {
    key: 'path', type: 'text', label: 'Value path', section: 'Layout',
    placeholder: 'steps  ·  sensors.0.value',
    help: 'Dot path into the posted JSON. Blank = first numeric field.',
    when: (v) => v.variant === 'number'
  },
  {
    key: 'template', type: 'textarea', label: 'Template (optional)', section: 'Layout',
    rows: 4,
    placeholder: '{{steps}} steps\nGoal: {{goal}}\n{{note}}',
    help: 'One line per row; first line renders big. {{path.to.value}} pulls from the '
      + "posted JSON (dots for nesting, numbers for arrays). Empty = automatic key/value "
      + "list of the payload's top-level fields."
  }
];

export const Form = buildForm(FIELDS);
