import React from 'react';
import { buildForm } from './_schema.jsx';
import { TokenPicker } from '../components/TokenPicker';
import TokenInput from '../components/TokenInput.jsx';
import TimeField from '../components/TimeField.jsx';

// `bar` shows the token-strip controls; `card` adds the scheduled-messages
// editor from the old message widget. The variant picker itself is modal
// chrome (WidgetForm renders it from def.variants) — not this form's job.

const isCard = (v) => v.variant === 'card';

// A token field is an input plus its picker popover, side by side. Custom
// because the pair is one control: the picker appends into the field it sits
// next to, so they cannot be separate schema entries.
function TokenField({ label, k, placeholder, help, values, patch }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
      <div style={{ flex: 1 }}>
        <TokenInput
          label={label}
          value={values[k]}
          onChange={(x) => patch({ [k]: x })}
          placeholder={placeholder}
          help={help}
        />
      </div>
      <TokenPicker onInsert={(tok) => patch({ [k]: (values[k] || '') + tok })} />
    </div>
  );
}

// Scheduled messages: a time window plus two token-able lines per row. Rich
// enough that a generic row renderer would be a worse description than this.
function ScheduleEditor({ ctx }) {
  const { ListEditor } = ctx.fields;
  return (
    <ListEditor
      label="Scheduled messages (override default in their window)"
      items={ctx.values.schedule}
      onChange={(schedule) => ctx.patch({ schedule })}
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
              onChange={e => set({ text: e.target.value })} style={{ flex: 1 }} />
            <TokenPicker onInsert={(tok) => set({ text: (it.text || '') + tok })} />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="text" value={it.subtitle || ''} placeholder="Subtitle (optional)"
              onChange={e => set({ subtitle: e.target.value })} style={{ flex: 1 }} />
            <TokenPicker onInsert={(tok) => set({ subtitle: (it.subtitle || '') + tok })} />
          </div>
        </div>
      )}
    />
  );
}

export const FIELDS = [
  {
    key: 'align', type: 'select', label: 'Align', section: 'Layout',
    options: [
      { value: 'left',   label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right',  label: 'Right' }
    ],
    when: (v) => !isCard(v)
  },
  { key: 'upper', type: 'toggle', label: 'UPPERCASE', section: 'Layout', when: (v) => !isCard(v) },
  {
    type: 'custom', section: 'Content', owns: ['text'],
    render: (ctx) => (
      <TokenField
        k="text"
        label={isCard(ctx.values) ? 'Default headline' : 'Text'}
        placeholder={isCard(ctx.values) ? "Today's message…" : 'e.g. {{city}} · {{date|long}}'}
        help="Type {{ for token autocomplete. Markdown: **bold**, *italic*. Fallback: {{temp|default:N/A}}"
        values={ctx.values}
        patch={ctx.patch}
      />
    )
  },
  {
    type: 'custom', section: 'Content', owns: ['subtitle'],
    render: (ctx) => (
      <TokenField
        k="subtitle"
        label={isCard(ctx.values)
          ? 'Default subtitle'
          : 'Subtitle (second line, hidden on 1-row tiles)'}
        placeholder="Optional second line"
        values={ctx.values}
        patch={ctx.patch}
      />
    )
  },
  {
    type: 'custom', section: 'Content', owns: ['schedule'],
    when: isCard,
    render: (ctx) => <ScheduleEditor ctx={ctx} />
  }
];

export const Form = buildForm(FIELDS);
