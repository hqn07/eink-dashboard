import { buildForm } from './_schema.jsx';

// One form, three views. Only the selected view's controls appear: the Variant
// picker already chose what the card is, so offering a custom-quotes list on an
// On-this-day tile would be asking about something that cannot happen.
const BLURB = {
  quote: 'Rotates one line per day. Leave the list empty to use the built-in set.',
  word: 'A different word each day. Leave the list empty to use the built-in set.',
  onthisday: 'Events that happened on today’s date (Wikipedia). Nothing to configure.'
};
const PLACEHOLDER = { quote: 'QUOTE', word: 'WORD OF THE DAY', onthisday: 'ON THIS DAY' };

export const FIELDS = [
  { type: 'note', text: (v) => BLURB[v.variant || 'quote'] },
  {
    key: 'quotes', type: 'list', label: 'Your quotes (text — Author)',
    addLabel: 'Add quote', rowPlaceholder: 'Quote text — Author',
    help: 'Format: "Stay hungry, stay foolish — Stewart Brand".',
    when: (v) => (v.variant || 'quote') === 'quote'
  },
  {
    key: 'words', type: 'list', label: 'Your words (word — definition)',
    addLabel: 'Add word', rowPlaceholder: 'word — definition',
    help: 'Format: "petrichor — the smell of rain on dry earth".',
    when: (v) => v.variant === 'word'
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: (v) => PLACEHOLDER[v.variant || 'quote'],
    help: 'Leave blank to keep the default heading.'
  }
];

export const Form = buildForm(FIELDS);
