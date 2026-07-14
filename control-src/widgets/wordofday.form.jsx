import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { ListEditor, TextField, TypographyFields, FormSection, defaults = {} } = fields;
  const words = Array.isArray(v.words) ? v.words : [];
  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Rotates one word per day. Leave empty for the built-in set, or
          add your own below.
        </div>
        <ListEditor
          label="Your words (word — definition)"
          items={words}
          onChange={(items) => patch({ words: items })}
          blank=""
          addLabel="Add word"
          help='Format: "petrichor (n.) — the scent of rain on dry earth".'
          renderRow={(it, set) => (
            <input
              type="text"
              value={typeof it === 'string' ? it : ''}
              placeholder="word (part) — definition"
              onChange={e => set(e.target.value)}
              style={{ flex: 1 }}
            />
          )}
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="WORD OF THE DAY"
          help="Leave blank to keep the default heading."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
