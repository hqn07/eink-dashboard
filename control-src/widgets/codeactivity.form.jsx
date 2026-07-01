import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          GitHub contribution heatmap (last year). Public contributions only,
          no token needed.
        </div>
        <TextField
          label="GitHub username"
          value={v.username || ''}
          defaultValue={defaults.username}
          onChange={(x) => patch({ username: x })}
          placeholder="octocat"
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="CODE ACTIVITY"
          help="Leave blank to keep the default heading."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
