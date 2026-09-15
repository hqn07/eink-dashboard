import React from 'react';

// Curated favourites — surfaced as one-tap chips above the search box.
const FAVES = [
  ['Los Angeles', 'America/Los_Angeles'], ['New York', 'America/New_York'],
  ['London', 'Europe/London'], ['Paris', 'Europe/Paris'],
  ['Dubai', 'Asia/Dubai'], ['Mumbai', 'Asia/Kolkata'],
  ['Singapore', 'Asia/Singapore'], ['Tokyo', 'Asia/Tokyo'],
  ['Sydney', 'Australia/Sydney'], ['UTC', 'UTC']
];

// Every IANA zone the runtime knows (hundreds). Falls back to the
// favourites if Intl.supportedValuesOf is unavailable.
const ALL_ZONES = (() => {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch { /* fall through */ }
  return FAVES.map(f => f[1]);
})();

function labelFor(tz) {
  const fav = FAVES.find(f => f[1] === tz);
  if (fav) return fav[0].toUpperCase();
  return tz.split('/').pop().replace(/_/g, ' ').toUpperCase();
}

// Zone search (hooks live here, not in the pure Form — TabbedForm calls
// Form directly to introspect sections, so it must be hook-free).
function ZoneAdder({ v, patch }) {
  const zones = Array.isArray(v.zones) ? v.zones : [];
  const [query, setQuery] = React.useState('');
  const addTz = (tz) => {
    const clean = (tz || '').trim();
    if (!clean) return;
    patch({ zones: [...zones, `${labelFor(clean)}|${clean}`] });
    setQuery('');
  };
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = ALL_ZONES.find(z => z.toLowerCase() === query.toLowerCase());
    const match = exact || ALL_ZONES.find(z => z.toLowerCase().includes(query.toLowerCase()));
    if (match) addTz(match);
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="wsm-field-label">Add a zone</div>
      <input
        className="wsm-input"
        type="text"
        list="wclock-all-zones"
        value={query}
        placeholder="Search any city / region… (e.g. Berlin)"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onSearchKey}
        aria-label="Search timezone"
      />
      <datalist id="wclock-all-zones">
        {ALL_ZONES.map(tz => <option key={tz} value={tz} />)}
      </datalist>
      <div className="wsm-field-help">Pick from the list or type then press Enter. {ALL_ZONES.length} zones.</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {FAVES.map(([label, tz]) => (
          <button key={tz} type="button" className="wsm-chip" onClick={() => addTz(tz)}>+ {label}</button>
        ))}
      </div>
    </div>
  );
}

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, ListEditor, SegmentedField, ToggleField, FormSection, defaults = {} } = fields;
  const zones = Array.isArray(v.zones) ? v.zones : [];

  return (
    <>
      <FormSection title="Zones">
        <ZoneAdder v={v} patch={patch} />
        <ListEditor
          label="Zones (LABEL | IANA timezone)"
          items={zones}
          onChange={(items) => patch({ zones: items })}
          blank="CITY|UTC"
          addLabel="Add zone"
          help="Edit the label before the | and the IANA name after it. First zone is 'home' — others show +1d / −1d relative to it."
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
          onChange={(x) => patch({ title: x })} tokens
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
        <ToggleField
          label="Show weekday + UTC offset"
          value={v.showMeta !== false}
          defaultValue={defaults.showMeta}
          onChange={(x) => patch({ showMeta: x })}
          help="Hidden automatically on small tiles."
        />
      </FormSection>
    </>
  );
}
