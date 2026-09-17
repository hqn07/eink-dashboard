import React from 'react';

// One form, three views. Only the selected view's controls are shown: the
// Variant picker above has already chosen what the card is, so asking again
// here — or offering a custom-quotes list on an On-this-day tile — would be
// asking about something that cannot happen.
export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ListEditor, FormSection, defaults = {} } = fields;
  const view = v.variant || 'quote';

  const BLURB = {
    quote: 'Rotates one line per day. Leave the list empty to use the built-in set.',
    word: 'A different word each day. Leave the list empty to use the built-in set.',
    onthisday: 'Events that happened on today’s date (Wikipedia). Nothing to configure.',
  };
  const PLACEHOLDER = { quote: 'QUOTE', word: 'WORD OF THE DAY', onthisday: 'ON THIS DAY' };

  // Both list views are string rows — they need `replaceRow`, or every
  // keystroke spreads the string into an object and the field cannot be
  // typed into (3289942).
  const stringList = (label, key, items, addLabel, help, placeholder) => (
    <ListEditor
      replaceRow
      label={label}
      items={Array.isArray(items) ? items : []}
      onChange={(next) => patch({ [key]: next })}
      blank=""
      addLabel={addLabel}
      help={help}
      renderRow={(it, set) => (
        <input
          type="text"
          value={typeof it === 'string' ? it : ''}
          placeholder={placeholder}
          onChange={e => set(e.target.value)}
          style={{ flex: 1 }}
        />
      )}
    />
  );

  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>{BLURB[view]}</div>

        {view === 'quote' && stringList(
          'Your quotes (text — Author)', 'quotes', v.quotes, 'Add quote',
          'Format: "Stay hungry, stay foolish — Stewart Brand".', 'Quote text — Author')}

        {view === 'word' && stringList(
          'Your words (word — definition)', 'words', v.words, 'Add word',
          'Format: "petrichor — the smell of rain on dry earth".', 'word — definition')}

        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder={PLACEHOLDER[view]}
          help="Leave blank to keep the default heading."
        />
      </FormSection>
    </>
  );
}
