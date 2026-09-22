import { buildForm } from './_schema.jsx';

export const FIELDS = [
  {
    key: 'source', type: 'select', label: 'Provider', section: 'Source',
    options: [
      { value: 'todoist', label: 'Todoist' },
      { value: 'ical',    label: 'iCal / Reminders feed (VTODO)' },
      { value: 'both',    label: 'Both — merge by due date' }
    ]
  },
  {
    key: 'token', type: 'text', label: 'Todoist API token', section: 'Source', secret: true,
    placeholder: 'paste token',
    help: 'Todoist → Settings → Integrations → Developer → API token.',
    when: (v) => (v.source || 'todoist') !== 'ical'
  },
  {
    key: 'icalUrl', type: 'text', label: 'VTODO feed URL', section: 'Source',
    placeholder: 'https://…/reminders.ics',
    help: 'A published iCal feed that contains VTODO items.',
    when: (v) => v.source === 'ical' || v.source === 'both'
  },
  {
    key: 'count', type: 'slider', label: 'Max tasks', section: 'Source',
    min: 2, max: 12, step: 1
  },
  { key: 'showDue', type: 'toggle', label: 'Show due dates', section: 'Source' },
  {
    key: 'title', type: 'text', label: 'Tile heading', section: 'Source', tokens: true,
    placeholder: 'TASKS',
    help: 'Optional title-bar override.'
  }
];

export const Form = buildForm(FIELDS);
