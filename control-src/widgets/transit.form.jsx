import React from 'react';
import { buildForm } from './_schema.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { MTA_STATIONS } from './_mta_stations.js';

const BY_ID = new Map(MTA_STATIONS.map(s => [s.id, s]));
const STATION_ITEMS = MTA_STATIONS.map(s => ({
  value: s.id, label: s.name, hint: s.routes.join(' ')
}));
const stationOf = (v) => (v.stopId ? BY_ID.get(v.stopId) : null);
const routesOf = (v) => { const st = stationOf(v); return st ? st.routes : []; };

// Picking a station writes three things at once, which is why it is a custom
// control rather than a select: the stop id, the line (the realtime feed keys
// off it, so it must be one the station actually serves), and the heading —
// seeded with the station name, since typing it again is work the editor can
// do for you.
function StationPicker({ values, patch }) {
  const v = values;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12 }}>Station</span>
      <SearchableSelect
        value={v.stopId || ''}
        items={STATION_ITEMS}
        onChange={(id, item) => {
          const st = BY_ID.get(id);
          const next = { stopId: id };
          if (st && st.routes.length && !st.routes.includes(v.line)) next.line = st.routes[0];
          if (!v.title && item) next.title = item.label;
          patch(next);
        }}
        placeholder="Search a station…"
        ariaLabel="Subway station"
      />
    </div>
  );
}

export const FIELDS = [
  {
    type: 'custom', section: 'Station',
    // Declares the keys it writes without naming one of them as ITS key —
    // check-widgets reads this so a custom control still has to account for
    // the defaults it covers.
    owns: ['stopId', 'line', 'title'],
    render: (ctx) => <StationPicker values={ctx.values} patch={ctx.patch} />
  },
  {
    key: 'line', type: 'select', label: 'Line', section: 'Station',
    // Only the routes this station serves, and only worth asking when it
    // serves more than one.
    options: (v) => routesOf(v).map(r => ({ value: r, label: `${r} train` })),
    toField: (x, v) => (routesOf(v).includes(x) ? x : routesOf(v)[0]),
    when: (v) => routesOf(v).length > 1
  },
  {
    key: 'direction', type: 'select', label: 'Direction', section: 'Station',
    // The platform labels are the station's own ("Uptown", "To Manhattan"),
    // which is what the signs say — compass letters are the fallback.
    options: (v) => {
      const st = stationOf(v);
      return [
        { value: 'N', label: st && st.nl ? `${st.nl} (N)` : 'Northbound (N)' },
        { value: 'S', label: st && st.sl ? `${st.sl} (S)` : 'Southbound (S)' },
        { value: 'both', label: 'Both platforms (↑/↓ per train)' }
      ];
    }
  },
  {
    key: 'count', type: 'slider', label: 'Max trains', section: 'Station',
    min: 2, max: 8, step: 1
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', section: 'Station', tokens: true,
    placeholder: 'Station name',
    help: 'Defaults to the station you pick.'
  }
];

export const Form = buildForm(FIELDS);
