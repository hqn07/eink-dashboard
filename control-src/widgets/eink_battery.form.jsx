import { buildForm } from './_schema.jsx';

export const FIELDS = [
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: 'E-INK BATTERY',
    help: 'Leave blank to keep the default heading.'
  },
  { key: 'showVoltage', type: 'toggle', label: 'Voltage readout (e.g. 4.03 V)' },
  { key: 'showBar', type: 'toggle', label: 'Battery bar (visual fill)' },
  { key: 'showAge', type: 'toggle', label: '"Updated N ago" timestamp' },
  {
    type: 'note', section: 'Style',
    text: "Reads from the panel's last POST to /api/battery (server stores it in "
      + 'data/battery.json). Updates every refresh cycle.'
  }
];

export const Form = buildForm(FIELDS);
