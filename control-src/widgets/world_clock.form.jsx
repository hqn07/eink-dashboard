import React from 'react';

// Curated IANA zones for the "add a zone" picker. Label is a sensible
// default; the user can rename it in the row.
const ZONES = [
  ['Los Angeles', 'America/Los_Angeles'], ['Denver', 'America/Denver'],
  ['Chicago', 'America/Chicago'], ['New York', 'America/New_York'],
  ['São Paulo', 'America/Sao_Paulo'], ['London', 'Europe/London'],
  ['Paris', 'Europe/Paris'], ['Berlin', 'Europe/Berlin'],
  ['Athens', 'Europe/Athens'], ['Dubai', 'Asia/Dubai'],
  ['Mumbai', 'Asia/Kolkata'], ['Bangkok', 'Asia/Bangkok'],
  ['Singapore', 'Asia/Singapore'], ['Hong Kong', 'Asia/Hong_Kong'],
  ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney'],
  ['Auckland', 'Pacific/Auckland'], ['UTC', 'UTC']
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ListEditor, SegmentedField, TypographyFields, FormSection, defaults = {} } = fields;
  const zones = Array.isArray(v.zones) ? v.zones : [];
  const addZone = (e) => {
    const tz = e.target.value;
    if (!tz) return;
    const found = ZONES.find(z => z[1] === tz);
    const label = (found ? found[0] : tz.split('/').pop().replace(/_/g, ' ')).toUpperCase();
    patch({ zones: [...zones, `${label}|${tz}`] });
    e.target.value = '';
  };
  return (
    <>
      <FormSection title="Zones">
        <div style={{ marginBottom: 8 }}>
          <div className="wsm-field-label">Add a zone</div>
          <select className="wsm-select" defaultValue="" onChange={addZone} aria-label="Add timezone">
            <option value="">— Pick a city —</option>
            {ZONES.map(([label, tz]) => <option key={tz} value={tz}>{label}</option>)}
          </select>
        </div>
        <ListEditor
          label="Zones (LABEL | IANA timezone)"
          items={zones}
          onChange={(items) => patch({ zones: items })}
          blank="CITY|UTC"
          addLabel="Add zone"
          help="Edit the label before the | and the IANA name after it."
          renderRow={(it, set) => {
            const str = typeof it === 'string' ? it : '';
            const i = str.indexOf('|');
            const label = i < 0 ? str : str.slice(0, i);
            const tz = i < 0 ? '' : str.slice(i + 1);
            return (
              <>
                <input type="text" value={label} placeholder="LABEL"
                  onChange={e => set(`${e.target.value}|${tz}`)}
                  style={{ flex: '0 0 38%' }} />
                <input type="text" value={tz} placeholder="Region/City"
                  onChange={e => set(`${label}|${e.target.value}`)}
                  style={{ flex: 1 }} />
              </>
            );
          }}
        />
      </FormSection>
      <FormSection title="Content">
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="WORLD CLOCK"
          help="Leave blank to keep the default heading."
        />
        <SegmentedField
          label="Time format"
          value={v.format === '24h' ? '24h' : '12h'}
          defaultValue={defaults.format}
          options={[
            { value: '12h', short: '12h', label: '12-hour' },
            { value: '24h', short: '24h', label: '24-hour' }
          ]}
          onChange={(x) => patch({ format: x })}
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
