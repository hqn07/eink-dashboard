import React from 'react';
import { TokenPicker } from '../components/TokenPicker';
import TokenInput from '../components/TokenInput.jsx';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TypographyFields, FormSection } = fields;
  const appendToken = (key) => (tok) => patch({ [key]: (v[key] || '') + tok });
  return (
    <>
      <FormSection title="Content">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <TokenInput
              label="Text"
              value={v.text}
              onChange={(x) => patch({ text: x })}
              placeholder="e.g. {{city}} · {{date|long}}"
              help="Type {{ for token autocomplete. Markdown: **bold**, *italic*."
            />
          </div>
          <TokenPicker onInsert={appendToken('text')} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <TokenInput
              label="Subtitle (second line, hidden on 1-row tiles)"
              value={v.subtitle}
              onChange={(x) => patch({ subtitle: x })}
              placeholder="e.g. refreshed {{lastRefresh|relative}}"
            />
          </div>
          <TokenPicker onInsert={appendToken('subtitle')} />
        </div>
      </FormSection>
      <FormSection title="Layout">
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
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
