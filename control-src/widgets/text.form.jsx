import React from 'react';
import { TokenPicker } from '../components/TokenPicker';
import TokenInput from '../components/TokenInput.jsx';
import TimeField from '../components/TimeField.jsx';

// Merged form: `bar` shows the token-strip controls (align/upper),
// `card` adds the scheduled-messages editor from the old message
// widget. The variant picker itself is modal chrome (WidgetForm renders
// it automatically from def.variants) — not this form's job.
export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { ListEditor, TypographyFields, FormSection } = fields;
  const appendToken = (key) => (tok) => patch({ [key]: (v[key] || '') + tok });
  const variant = v.variant === 'card' ? 'card' : 'bar';
  return (
    <>
      <FormSection title="Layout">
        {variant === 'bar' && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              Align
              <select
                value={v.align || 'left'}
                onChange={e => patch({ align: e.target.value })}
                style={{ width: 140 }}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={!!v.upper}
                onChange={e => patch({ upper: e.target.checked })}
              />
              UPPERCASE
            </label>
          </>
        )}
      </FormSection>
      <FormSection title="Content">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <TokenInput
              label={variant === 'card' ? 'Default headline' : 'Text'}
              value={v.text}
              onChange={(x) => patch({ text: x })}
              placeholder={variant === 'card' ? "Today's message…" : 'e.g. {{city}} · {{date|long}}'}
              help="Type {{ for token autocomplete. Markdown: **bold**, *italic*. Fallback: {{temp|default:N/A}}"
            />
          </div>
          <TokenPicker onInsert={appendToken('text')} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <TokenInput
              label={variant === 'card' ? 'Default subtitle' : 'Subtitle (second line, hidden on 1-row tiles)'}
              value={v.subtitle}
              onChange={(x) => patch({ subtitle: x })}
              placeholder="Optional second line"
            />
          </div>
          <TokenPicker onInsert={appendToken('subtitle')} />
        </div>
        {variant === 'card' && (
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
                  <TimeField value={it.from || ''} onChange={(x) => set({ from: x })} />
                  <span style={{ fontSize: 11 }}>→</span>
                  <TimeField value={it.to || ''} onChange={(x) => set({ to: x })} />
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
        )}
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
