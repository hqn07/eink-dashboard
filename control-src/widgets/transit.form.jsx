import React from 'react';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { MTA_STATIONS } from './_mta_stations.js';

const BY_ID = new Map(MTA_STATIONS.map(s => [s.id, s]));
const STATION_ITEMS = MTA_STATIONS.map(s => ({
  value: s.id,
  label: s.name,
  hint: s.routes.join(' ')
}));

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, FormSection, defaults = {} } = fields;
  const station = v.stopId ? BY_ID.get(v.stopId) : null;
  const routes = station ? station.routes : [];
  const dir = (v.direction === 'S' || v.direction === 'both') ? v.direction : 'N';

  const pickStation = (id, item) => {
    const st = BY_ID.get(id);
    const patch2 = { stopId: id };
    // Set the line to the station's first route (drives the realtime feed);
    // if it serves several, the Line select below lets the user narrow.
    if (st && st.routes.length && !st.routes.includes(v.line)) patch2.line = st.routes[0];
    // Seed the tile heading with the station name if the user hasn't set one.
    if (!v.title && item) patch2.title = item.label;
    patch(patch2);
  };

  return (
    <>
      <FormSection title="Station">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Station</span>
          <SearchableSelect
            value={v.stopId || ''}
            items={STATION_ITEMS}
            onChange={pickStation}
            placeholder="Search a station…"
            ariaLabel="Subway station"
          />
        </div>
        {routes.length > 1 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            Line
            <select
              value={routes.includes(v.line) ? v.line : routes[0]}
              onChange={(e) => patch({ line: e.target.value })}
              style={{ width: 220 }}
            >
              {routes.map(r => <option key={r} value={r}>{r} train</option>)}
            </select>
          </label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Direction
          <select
            value={dir}
            onChange={(e) => patch({ direction: e.target.value })}
            style={{ width: 220 }}
          >
            <option value="N">{station && station.nl ? `${station.nl} (N)` : 'Northbound (N)'}</option>
            <option value="S">{station && station.sl ? `${station.sl} (S)` : 'Southbound (S)'}</option>
            <option value="both">Both platforms (↑/↓ per train)</option>
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
          onChange={(x) => patch({ title: x })} tokens
          placeholder="Station name"
          help="Defaults to the station you pick."
        />
      </FormSection>
    </>
  );
}
