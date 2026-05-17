import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  geocode,
  reverseGeocode,
  weatherCheck,
  flagEmoji
} from '../api.js';

// Build OpenWeather's preferred city query format from a place pick.
function cityFromPlace(p) {
  if (!p) return '';
  return [p.name, p.state, p.country].filter(Boolean).join(',');
}

function titleUpper(s) {
  return (s || '').toString().toUpperCase();
}

// Lazy-build the timezone list — `Intl.supportedValuesOf` is the
// modern way; we fall back to a small static set otherwise.
function listTimezones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {}
  return [
    'UTC',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'America/Honolulu', 'America/Phoenix',
    'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
    'America/Sao_Paulo', 'America/Buenos_Aires',
    'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Moscow',
    'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Bangkok',
    'Australia/Sydney', 'Australia/Perth',
    'Pacific/Auckland', 'Pacific/Honolulu'
  ];
}

function currentTimeIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
    }).format(new Date());
  } catch {
    return '—';
  }
}

export default function LocationPanel({ cfg, onPatch }) {
  const [searchQ, setSearchQ] = useState(cfg.city || '');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [tzOpen, setTzOpen] = useState(false);
  const [tzQuery, setTzQuery] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [check, setCheck] = useState({ status: 'idle' });
  const [now, setNow] = useState(currentTimeIn(cfg.timezone || 'UTC'));
  const searchRef = useRef(null);
  const tzRef = useRef(null);
  const debounceRef = useRef(null);

  // Tick current local time every 15s for the timezone hint.
  useEffect(() => {
    setNow(currentTimeIn(cfg.timezone || 'UTC'));
    const id = setInterval(() => setNow(currentTimeIn(cfg.timezone || 'UTC')), 15000);
    return () => clearInterval(id);
  }, [cfg.timezone]);

  // Keep search field in sync with cfg.city.
  useEffect(() => { setSearchQ(cfg.city || ''); }, [cfg.city]);

  // Debounced autocomplete: each keystroke fires after 250ms idle.
  useEffect(() => {
    if (!showResults) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const r = await geocode(searchQ);
      setResults(r);
    }, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [searchQ, showResults]);

  // Close dropdowns on outside click.
  useEffect(() => {
    const h = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowResults(false);
      if (tzRef.current    && !tzRef.current.contains(e.target))    setTzOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Test the configured location every time it changes (debounced via
  // weather widget's own 10-min cache server-side; here we just hit
  // /api/weather-check which has its own caching upstream).
  useEffect(() => {
    let cancelled = false;
    setCheck({ status: 'loading' });
    const run = async () => {
      const r = await weatherCheck({
        city: cfg.city,
        lat: cfg.lat,
        lon: cfg.lon,
        units: 'F'
      });
      if (cancelled) return;
      setCheck(r.ok ? { status: 'ok', temp: r.temp, desc: r.desc, country: r.country }
                    : { status: 'err', error: r.error });
    };
    const id = setTimeout(run, 400);
    return () => { cancelled = true; clearTimeout(id); };
  }, [cfg.city, cfg.lat, cfg.lon]);

  // Apply a geocoding result: fills city, label, lat/lon, and tries
  // to infer the IANA timezone via the browser when the picked place
  // is local-ish.
  const applyPlace = (p) => {
    const cityStr = cityFromPlace(p);
    const recent = (cfg.recentCities || []).filter(c =>
      !(c.name === p.name && c.country === p.country && c.state === p.state)
    );
    const nextRecent = [{
      name: p.name, state: p.state, country: p.country,
      lat: p.lat, lon: p.lon, label: titleUpper(p.name)
    }, ...recent].slice(0, 6);

    onPatch({
      city: cityStr,
      cityLabel: titleUpper(p.name),
      lat: p.lat,
      lon: p.lon,
      recentCities: nextRecent
    });
    setSearchQ(cityStr);
    setShowResults(false);
  };

  const onUseMyLocation = () => {
    if (!navigator.geolocation) { alert('Geolocation not supported by browser'); return; }
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const place = await reverseGeocode(lat, lon);
      if (!place) {
        onPatch({ lat, lon, city: '', cityLabel: '' });
        return;
      }
      applyPlace({ ...place, lat, lon });
    }, err => alert('Could not get location: ' + err.message));
  };

  const timezones = useMemo(() => listTimezones(), []);
  const tzFiltered = useMemo(() => {
    const q = tzQuery.trim().toLowerCase();
    if (!q) return timezones.slice(0, 80);
    return timezones.filter(z => z.toLowerCase().includes(q)).slice(0, 80);
  }, [tzQuery, timezones]);

  return (
    <section className="card location-panel">
      <div className="section-title">
        <span>Location (shared)</span>
        <div className="btn-row" style={{ marginTop: 0, gap: 6 }}>
          <button
            className="btn"
            onClick={onUseMyLocation}
            title="Use browser geolocation"
          >📍 USE MY LOCATION</button>
          <button
            className="btn btn-ghost"
            onClick={() => setAdvanced(a => !a)}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >{advanced ? 'HIDE LAT/LON' : 'ADVANCED'}</button>
        </div>
      </div>

      {/* CITY SEARCH */}
      <label className="field" ref={searchRef} style={{ position: 'relative' }}>
        <span className="label">City</span>
        <input
          type="text"
          value={searchQ}
          placeholder="Type a city — e.g. Gainesville"
          onChange={e => { setSearchQ(e.target.value); setShowResults(true); }}
          onFocus={() => setShowResults(true)}
        />
        <AnimatePresence>
          {showResults && results && results.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="autocomplete"
            >
              {results.map((p, i) => (
                <button
                  key={`${p.name}-${p.state}-${p.country}-${i}`}
                  className="autocomplete-row"
                  onClick={() => applyPlace(p)}
                >
                  <span className="ac-flag">{flagEmoji(p.country)}</span>
                  <span className="ac-name">{p.name}</span>
                  {p.state && <span className="ac-state">{p.state}</span>}
                  <span className="ac-country">{p.country || ''}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </label>

      {/* CITY LABEL */}
      <label className="field">
        <span className="label">City label (shown on display)</span>
        <input
          type="text"
          value={cfg.cityLabel || ''}
          onChange={e => onPatch({ cityLabel: e.target.value })}
          placeholder={titleUpper(cfg.city?.split(',')[0] || 'GAINESVILLE')}
        />
      </label>

      {/* WEATHER VALIDATION BADGE */}
      <div className={`loc-badge ${check.status}`}>
        {check.status === 'loading' && <>&gt; CHECKING WEATHER...</>}
        {check.status === 'ok' && (
          <>
            <span style={{ marginRight: 6 }}>{flagEmoji(check.country)}</span>
            <strong>{cfg.cityLabel || titleUpper(cfg.city?.split(',')[0])}</strong>
            <span> · {check.temp}°F · {check.desc}</span>
          </>
        )}
        {check.status === 'err' && <>&gt; CITY NOT FOUND — {check.error || ''}</>}
        {check.status === 'idle' && <>&gt; ENTER A CITY ABOVE</>}
      </div>

      {/* RECENT CITIES */}
      {(cfg.recentCities && cfg.recentCities.length > 0) && (
        <div className="recent-cities">
          <div className="recent-label">RECENT</div>
          <div className="btn-row" style={{ marginTop: 4 }}>
            {cfg.recentCities.map((c, i) => (
              <button
                key={i}
                className="btn"
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => applyPlace(c)}
              >
                {flagEmoji(c.country)} {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TIMEZONE */}
      <label className="field" ref={tzRef} style={{ position: 'relative' }}>
        <span className="label">Timezone</span>
        <input
          type="text"
          value={tzOpen ? tzQuery : (cfg.timezone || 'America/New_York')}
          onClick={() => { setTzOpen(true); setTzQuery(''); }}
          onChange={e => { setTzOpen(true); setTzQuery(e.target.value); }}
          placeholder="Search zones..."
        />
        <AnimatePresence>
          {tzOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="autocomplete"
            >
              {tzFiltered.map(z => (
                <button
                  key={z}
                  className="autocomplete-row"
                  onClick={() => { onPatch({ timezone: z }); setTzOpen(false); }}
                >
                  <span className="ac-name">{z}</span>
                  <span className="ac-state">{currentTimeIn(z)}</span>
                </button>
              ))}
              {!tzFiltered.length && (
                <div className="autocomplete-row" style={{ color: 'var(--mute)' }}>No match</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="terminal-line" style={{ fontSize: 10, marginTop: 4 }}>
          &gt; CURRENTLY {now} IN {cfg.timezone || 'UTC'}
        </div>
      </label>

      {/* ADVANCED: explicit lat/lon */}
      {advanced && (
        <div className="sched-group">
          <label className="field">
            <span className="label">Latitude</span>
            <input
              type="text"
              value={cfg.lat ?? ''}
              onChange={e => {
                const v = e.target.value.trim();
                const n = parseFloat(v);
                onPatch({ lat: Number.isFinite(n) ? n : null });
              }}
              placeholder="29.65"
            />
          </label>
          <label className="field">
            <span className="label">Longitude</span>
            <input
              type="text"
              value={cfg.lon ?? ''}
              onChange={e => {
                const v = e.target.value.trim();
                const n = parseFloat(v);
                onPatch({ lon: Number.isFinite(n) ? n : null });
              }}
              placeholder="-82.32"
            />
          </label>
          <div className="terminal-line" style={{ fontSize: 10 }}>
            &gt; LAT/LON OVERRIDES CITY FOR WEATHER FETCH WHEN SET
          </div>
        </div>
      )}
    </section>
  );
}
