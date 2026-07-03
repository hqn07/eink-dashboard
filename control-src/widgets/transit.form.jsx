import React from 'react';

const LINES = ['1','2','3','4','5','6','7','A','C','E','B','D','F','M','G','J','Z','L','N','Q','R','W','S','SIR'];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  return (
    <>
      <FormSection title="Station">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Line
          <select
            value={v.line || 'L'}
            onChange={(e) => patch({ line: e.target.value })}
            style={{ width: 220 }}
          >
            {LINES.map(l => <option key={l} value={l}>{l} train</option>)}
          </select>
        </label>
        <TextField
          label="Stop ID"
          value={v.stopId || ''}
          onChange={(x) => patch({ stopId: x })}
          placeholder="e.g. L06"
          help="GTFS station id (without the N/S suffix). Find it in the MTA stops.txt or at subwaytime.mta.info."
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Direction
          <select
            value={v.direction === 'S' ? 'S' : 'N'}
            onChange={(e) => patch({ direction: e.target.value })}
            style={{ width: 220 }}
          >
            <option value="N">Northbound / uptown (N)</option>
            <option value="S">Southbound / downtown (S)</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Max trains ({Number.isFinite(v.count) ? v.count : 5})
          <input
            type="range" min={2} max={8} step={1}
            value={Number.isFinite(v.count) ? v.count : 5}
            onChange={(e) => patch({ count: parseInt(e.target.value, 10) })}
            style={{ width: 220 }}
          />
        </label>
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="TRANSIT"
          help="Optional — e.g. your station name."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
