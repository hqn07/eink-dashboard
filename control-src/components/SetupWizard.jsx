import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { geocode, reverseGeocode, flagEmoji } from '../api.js';

// First-time setup modal. Appears when the config still looks like the
// stock defaults (no lat/lon set, never marked as seen). Walks the user
// through location + timezone in one screen. Sets `cfg.firstRun = false`
// when finished so it doesn't appear again.
export default function SetupWizard({ cfg, onPatch, onClose }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [pick, setPick] = useState(null);
  const [tz, setTz] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || cfg.timezone || 'UTC'; }
    catch { return cfg.timezone || 'UTC'; }
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let id = null;
    if (search.trim().length < 2) { setResults([]); return; }
    id = setTimeout(async () => {
      const r = await geocode(search);
      setResults(r);
    }, 250);
    return () => id && clearTimeout(id);
  }, [search]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const place = await reverseGeocode(lat, lon);
      setBusy(false);
      if (place) {
        setPick({ ...place, lat, lon });
        setSearch(place.name || '');
      }
    }, () => setBusy(false));
  };

  const finish = () => {
    if (!pick) return;
    const cityStr = [pick.name, pick.state, pick.country].filter(Boolean).join(',');
    onPatch({
      city: cityStr,
      cityLabel: (pick.name || '').toUpperCase(),
      lat: pick.lat,
      lon: pick.lon,
      timezone: tz,
      firstRun: false
    });
    onClose();
  };

  const skip = () => {
    onPatch({ firstRun: false });
    onClose();
  };

  return (
    <motion.div
      className="wizard-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="wizard-modal"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
      >
        <header>
          <h2>WELCOME</h2>
          <div className="terminal-line">&gt; SET YOUR LOCATION AND TIMEZONE TO GET STARTED</div>
        </header>

        <label className="field">
          <span className="label">Find your city</span>
          <input
            type="text"
            value={search}
            placeholder="Type a city — or use your location"
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </label>

        <div className="btn-row">
          <button className="btn" onClick={useMyLocation} disabled={busy}>
            {busy ? '📍 LOCATING...' : '📍 USE MY LOCATION'}
          </button>
        </div>

        <AnimatePresence>
          {results.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="wizard-results"
            >
              {results.map((p, i) => (
                <button
                  key={i}
                  className={`autocomplete-row ${pick === p ? 'picked' : ''}`}
                  onClick={() => { setPick(p); setSearch(p.name); setResults([]); }}
                >
                  <span className="ac-flag">{flagEmoji(p.country)}</span>
                  <span className="ac-name">{p.name}</span>
                  {p.state && <span className="ac-state">{p.state}</span>}
                  <span className="ac-country">{p.country}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {pick && (
          <div className="loc-badge ok" style={{ marginTop: 12 }}>
            <span style={{ marginRight: 6 }}>{flagEmoji(pick.country)}</span>
            <strong>{(pick.name || '').toUpperCase()}</strong>
            {pick.state && <span> · {pick.state}</span>}
            {pick.country && <span> · {pick.country}</span>}
          </div>
        )}

        <label className="field" style={{ marginTop: 16 }}>
          <span className="label">Timezone</span>
          <input
            type="text"
            value={tz}
            onChange={e => setTz(e.target.value)}
          />
          <div className="terminal-line" style={{ fontSize: 10, marginTop: 4 }}>
            &gt; DETECTED FROM YOUR BROWSER · ADJUST IF WRONG
          </div>
        </label>

        <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={skip}>SKIP FOR NOW</button>
          <button
            className="btn btn-primary"
            onClick={finish}
            disabled={!pick}
          >FINISH ✓</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
