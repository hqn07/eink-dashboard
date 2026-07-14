import React from 'react';

// Webhook widget settings. The key names the /api/webhook/<key> endpoint
// this tile listens to; the optional template turns the payload into
// custom lines ({{path.to.value}} per line, first line = hero). Left
// blank, the widget auto-renders the payload's top-level fields.
export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  const key = (v.key || '').trim();

  return (
    <>
      <FormSection title="Source">
        <TextField
          label="Webhook key"
          value={v.key || ''}
          defaultValue={defaults.key}
          onChange={(x) => patch({ key: x.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) })}
          placeholder="e.g. steps"
          help="Letters/digits/dash/underscore. Push data with:"
        />
        <code style={{
          display: 'block', fontSize: 11, background: '#f4f2ec', padding: '6px 8px',
          borderRadius: 4, wordBreak: 'break-all', userSelect: 'all'
        }}>
          {`curl -X POST '<server>/api/webhook/${key || '<key>'}?token=<DEVICE_TOKEN>' -H 'Content-Type: application/json' -d '{"steps":8432}'`}
        </code>
      </FormSection>
      <FormSection title="Layout">
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="WEBHOOK"
          help="Leave blank to keep the default heading."
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Template (optional)
          <textarea
            value={v.template || ''}
            onChange={(e) => patch({ template: e.target.value })}
            rows={4}
            placeholder={'{{steps}} steps\nGoal: {{goal}}\n{{note}}'}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, resize: 'vertical' }}
          />
        </label>
        <div style={{ fontSize: 11, opacity: 0.75 }}>
          One line per row; first line renders big. <code>{'{{path.to.value}}'}</code> pulls
          from the posted JSON (dots for nesting, numbers for arrays). Empty = automatic
          key/value list of the payload's top-level fields.
        </div>
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
