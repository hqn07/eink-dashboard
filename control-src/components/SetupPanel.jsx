import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, GithubLogo, Clock, CalendarBlank } from '@phosphor-icons/react';
import { geocode, flagEmoji } from '../api.js';
import { homeValue, homeCoords } from '../home.js';
import SearchableSelect from './SearchableSelect.jsx';
import UrlBadge from './UrlBadge.jsx';

// The single editor for shared facts — stage 2 of docs/setup-architecture.md.
//
// Where you live, what time it is there and who you are on GitHub used to be
// folklore: written once by the setup wizard, read by six fetchers, visible
// nowhere and declared in no schema. Everything here answers a question a
// widget would otherwise have to ask per tile.
//
// Reads go through homeValue(), so a config still carrying the legacy
// top-level keys shows its real values rather than blanks. Writes always land
// in cfg.home — editing a field is what migrates it, and nothing rewrites a
// config behind the user's back.
//
// Edits ride the app's normal dirty/save flow through onReplaceConfig, so
// this behaves like every other config change: one Save button, one undo.

function listTimezones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch { /* older engine — fall through */ }
  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Paris',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo',
    'Asia/Ho_Chi_Minh', 'Australia/Sydney', 'Pacific/Auckland'];
}

function timeIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true
    }).format(new Date());
  } catch { return '—'; }
}

export default function SetupPanel({ cfg, onReplaceConfig }) {
  const home = (cfg && cfg.home) || {};
  const setHome = (patch) => onReplaceConfig({ ...cfg, home: { ...home, ...patch } });

  const city = homeValue(cfg, 'city') || '';
  const coords = homeCoords(cfg);
  const tz = homeValue(cfg, 'timezone') || 'UTC';
  const githubUser = homeValue(cfg, 'githubUser') || '';
  const about = typeof home.about === 'string' ? home.about : '';
  const icalUrls = homeValue(cfg, 'icalUrls') || [];

  // Deliberately NOT the shared ListEditor: it lives inside WidgetForm.jsx
  // and is not exported, and pulling that module in here would drag the
  // whole widget-form bundle into the main chunk for four text rows.
  // Rows are replaced whole by index — a row editor that merges into the
  // old value instead of replacing it is how the widget forms ended up
  // with fields that could not be typed into (`3289942`).
  const setUrl = (idx, url) => setHome({ icalUrls: icalUrls.map((u, i) => (i === idx ? url : u)) });
  const removeUrl = (idx) => setHome({ icalUrls: icalUrls.filter((_, i) => i !== idx) });
  const addUrl = () => setHome({ icalUrls: [...icalUrls, ''] });

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [now, setNow] = useState(() => timeIn(tz));

  // Debounced city lookup. Clearing the box clears the list rather than
  // leaving a stale set of places to click by accident.
  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const id = setTimeout(async () => {
      try { setResults(await geocode(search)); } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setNow(timeIn(tz));
    const id = setInterval(() => setNow(timeIn(tz)), 15000);
    return () => clearInterval(id);
  }, [tz]);

  const tzItems = useMemo(
    () => listTimezones().map(z => ({ value: z, label: z.replace(/_/g, ' ') })), []
  );

  const pickPlace = (p) => {
    setHome({
      city: [p.name, p.state, p.country].filter(Boolean).join(','),
      lat: p.lat, lon: p.lon
    });
    setSearch('');
    setResults([]);
  };

  return (
    <div className="setup-panel">
      <label className="wsm-field">
        <span className="wsm-field-label">
          <MapPin size={12} weight="bold" /> Location
        </span>
        {city ? (
          <div className="loc-badge ok">
            <strong>{city.split(',')[0].toUpperCase()}</strong>
            {coords && <span> · {coords.lat.toFixed(2)}, {coords.lon.toFixed(2)}</span>}
          </div>
        ) : (
          <div className="loc-badge idle">NOT SET — weather and daylight need this</div>
        )}
        <input
          type="text"
          value={search}
          placeholder={city ? 'Search to change city…' : 'Type a city…'}
          onChange={(e) => setSearch(e.target.value)}
        />
        {results.length > 0 && (
          <div className="wizard-results">
            {results.map((p, i) => (
              <button type="button" key={i} className="autocomplete-row" onClick={() => pickPlace(p)}>
                <span className="ac-flag">{flagEmoji(p.country)}</span>
                <span className="ac-name">{p.name}</span>
                {p.state && <span className="ac-state">{p.state}</span>}
                <span className="ac-country">{p.country}</span>
              </button>
            ))}
          </div>
        )}
        <span className="wsm-field-help">
          Used by weather, forecast, alerts, air quality, sun and moon.
        </span>
      </label>

      <label className="wsm-field">
        <span className="wsm-field-label">
          <Clock size={12} weight="bold" /> Timezone
        </span>
        <SearchableSelect
          value={tz}
          items={tzItems}
          ariaLabel="Timezone"
          onChange={(z) => setHome({ timezone: z })}
        />
        <span className="wsm-field-help">It is {now} there right now.</span>
      </label>

      <label className="wsm-field">
        <span className="wsm-field-label">
          <GithubLogo size={12} weight="bold" /> GitHub username
        </span>
        <input
          type="text"
          value={githubUser}
          placeholder="e.g. hqn07"
          onChange={(e) => setHome({ githubUser: e.target.value })}
        />
        <span className="wsm-field-help">
          Fills the Code Activity widget unless a tile overrides it.
        </span>
      </label>

      <div className="wsm-field">
        <span className="wsm-field-label">
          <CalendarBlank size={12} weight="bold" /> Calendar feeds
        </span>
        <div className="wsm-list">
          {icalUrls.map((u, idx) => (
            <div className="wsm-list-row" key={idx}>
              <input
                type="url"
                value={typeof u === 'string' ? u : ''}
                placeholder="https://calendar.google.com/calendar/ical/..."
                onChange={(e) => setUrl(idx, e.target.value)}
                style={{ flex: 1 }}
              />
              <UrlBadge url={typeof u === 'string' ? u : ''} />
              <button type="button" className="btn btn-danger wsm-list-remove"
                onClick={() => removeUrl(idx)}>×</button>
            </div>
          ))}
          {!icalUrls.length && <div className="wsm-field-help">No feeds yet.</div>}
        </div>
        <button type="button" className="btn wsm-list-add" onClick={addUrl}>+ Add feed</button>
        <span className="wsm-field-help">
          Feeds the AI briefing and the <code>{'{{nextEvent}}'}</code> token.
          Calendar tiles still use their own feeds — by contract an empty tile
          resolves to no events rather than falling back here; tiles inherit in
          stage 3. A secret iCal address grants read access to that calendar,
          and Backup &gt; EXPORT writes it to a plain JSON file — treat an
          exported backup as you would the URLs themselves.
        </span>
      </div>

      <label className="wsm-field">
        <span className="wsm-field-label">About you</span>
        <textarea
          className="wsm-textarea"
          rows={5}
          value={about}
          placeholder={'e.g. I work from home. Gym Tuesday and Thursday.\nDeadlines matter more to me than weather.'}
          onChange={(e) => setHome({ about: e.target.value })}
        />
        <span className="wsm-field-help">
          Sent to your AI provider with every generation, along with the
          dashboard&apos;s current data. Keep it to what actually changes the
          answer — routines, priorities, what you want flagged.
        </span>
      </label>
    </div>
  );
}
