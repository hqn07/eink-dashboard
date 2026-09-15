import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { ListEditor, FormSection } = fields;
  const quotes = Array.isArray(v.quotes) ? v.quotes : [];
  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Rotates one line per day. Leave empty to use the built-in set,
          or add your own below.
        </div>
        <ListEditor
          label="Your quotes (text — Author)"
          items={quotes}
          onChange={(items) => patch({ quotes: items })}
          blank=""
          addLabel="Add quote"
          help='Format: "Stay hungry, stay foolish — Stewart Brand".'
          renderRow={(it, set) => (
            <input
              type="text"
              value={typeof it === 'string' ? it : ''}
              placeholder="Quote text — Author"
              onChange={e => set(e.target.value)}
              style={{ flex: 1 }}
            />
          )}
        />
      </FormSection>
    </>
  );
}
