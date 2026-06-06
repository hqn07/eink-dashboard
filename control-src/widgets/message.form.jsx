import React from 'react';
import { TokenPicker } from '../components/TokenPicker';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ListEditor, TypographyFields, FormSection } = fields;
  const appendToken = (key) => (tok) => patch({ [key]: (v[key] || '') + tok });
  return (
    <>
      <FormSection title="Content">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <TextField
              label="Default headline"
              value={v.text}
              onChange={(x) => patch({ text: x })}
              placeholder="Today's message…"
              help="Markdown: **bold**, *italic*. Tokens: {{date}}, {{city}}, {{temp|unit}}. Fallback: {{temp|default:N/A}}"
            />
          </div>
          <TokenPicker onInsert={appendToken('text')} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <TextField
              label="Default subtitle"
              value={v.subtitle}
              onChange={(x) => patch({ subtitle: x })}
              placeholder="Optional second line"
            />
          </div>
          <TokenPicker onInsert={appendToken('subtitle')} />
        </div>
      </FormSection>
      <FormSection title="Data">
        <ListEditor
          label="Scheduled messages (override default in their window)"
          items={v.schedule}
          onChange={(schedule) => patch({ schedule })}
          blank={{ from: '06:00', to: '12:00', text: '', subtitle: '' }}
          addLabel="Add scheduled message"
          help="First match wins. Windows wrap midnight if `to` < `from`."
          renderRow={(it, set) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="time" value={it.from || ''} onChange={e => set({ from: e.target.value })}
                  style={{ width: 110 }} />
                <span style={{ fontSize: 11 }}>→</span>
                <input type="time" value={it.to || ''} onChange={e => set({ to: e.target.value })}
                  style={{ width: 110 }} />
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={it.text || ''} placeholder="Headline (this slot)"
                  onChange={e => set({ text: e.target.value })}
                  style={{ flex: 1 }} />
                <TokenPicker onInsert={(tok) => set({ text: (it.text || '') + tok })} />
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={it.subtitle || ''} placeholder="Subtitle (optional)"
                  onChange={e => set({ subtitle: e.target.value })}
                  style={{ flex: 1 }} />
                <TokenPicker onInsert={(tok) => set({ subtitle: (it.subtitle || '') + tok })} />
              </div>
            </div>
          )}
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
