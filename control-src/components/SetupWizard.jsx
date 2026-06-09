import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from '@phosphor-icons/react';
import { geocode, reverseGeocode, flagEmoji } from '../api.js';
import { SCREEN_PRESETS, inflatePresetLayout } from '../widgets.js';
import LiveDashboard from './LiveDashboard.jsx';

// Step indicator strip — Stripe / Vercel onboarding idiom: numbered
// circles connected by lines, current highlighted, completed steps
// get a check mark. Caller passes 1-based currentStep + the list of
// human-readable step labels.
function StepIndicator({ currentStep, steps }) {
  return (
    <div className="wizard-stepper" aria-label={`Step ${currentStep} of ${steps.length}`}>
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const done = stepNum < currentStep;
        const current = stepNum === currentStep;
        const cls = done ? 'is-done' : current ? 'is-current' : 'is-pending';
        return (
          <React.Fragment key={label}>
            <div className={`wizard-step ${cls}`}>
              <div className="wizard-step-dot">
                {done ? <Check size={11} weight="bold" /> : stepNum}
              </div>
              <span className="wizard-step-label">{label}</span>
            </div>
            {i < steps.length - 1 && <div className="wizard-step-line" aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// First-time setup. Two steps:
//   1. Location + timezone
//   2. Pick a starting screen preset
// Sets `cfg.firstRun = false` when finished so it doesn't reappear.
export default function SetupWizard({ cfg, onPatch, onApplyPreset, onClose }) {
  const [step, setStep] = useState('location');
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

  const commitLocation = () => {
    if (!pick) return;
    const cityStr = [pick.name, pick.state, pick.country].filter(Boolean).join(',');
    onPatch({
      city: cityStr,
      cityLabel: (pick.name || '').toUpperCase(),
      lat: pick.lat,
      lon: pick.lon,
      timezone: tz
    });
    setStep('preset');
  };

  const finish = (preset) => {
    if (preset && onApplyPreset) onApplyPreset(preset);
    onPatch({ firstRun: false });
    onClose();
  };

  const skip = () => {
    onPatch({ firstRun: false });
    onClose();
  };

  // ---- Location step ----
  if (step === 'location') {
    return (
      <motion.div className="wizard-overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className="wizard-modal"
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
          <StepIndicator currentStep={1} steps={['Location', 'Layout']} />
          <header>
            <h2>Welcome — let's pick your spot</h2>
            <div className="terminal-line">&gt; SET YOUR LOCATION AND TIMEZONE TO GET STARTED</div>
          </header>

          <label className="field">
            <span className="label">Find your city</span>
            <input type="text" value={search}
              placeholder="Type a city — or use your location"
              onChange={e => setSearch(e.target.value)} autoFocus />
          </label>

          <div className="btn-row">
            <button className="btn" onClick={useMyLocation} disabled={busy}>
              {busy ? '📍 LOCATING...' : '📍 USE MY LOCATION'}
            </button>
          </div>

          <AnimatePresence>
            {results.length > 0 && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="wizard-results">
                {results.map((p, i) => (
                  <button key={i}
                    className={`autocomplete-row ${pick === p ? 'picked' : ''}`}
                    onClick={() => { setPick(p); setSearch(p.name); setResults([]); }}>
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
            <input type="text" value={tz} onChange={e => setTz(e.target.value)} />
            <div className="terminal-line" style={{ fontSize: 10, marginTop: 4 }}>
              &gt; DETECTED FROM YOUR BROWSER · ADJUST IF WRONG
            </div>
          </label>

          <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={skip}>SKIP FOR NOW</button>
            <button className="btn btn-primary" onClick={commitLocation} disabled={!pick}>
              NEXT →
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // ---- Preset step ----
  return (
    <motion.div className="wizard-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="wizard-modal preset-modal"
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
        <StepIndicator currentStep={2} steps={['Location', 'Layout']} />
        <header>
          <h2>Pick a starting layout</h2>
          <div className="terminal-line">&gt; START FROM A PRESET · YOU CAN EDIT EVERYTHING AFTER</div>
        </header>

        <div className="preset-grid">
          {SCREEN_PRESETS.map(p => (
            <PresetCard key={p.id} preset={p} onPick={() => finish(p)} />
          ))}
        </div>

        <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={() => setStep('location')}>← BACK</button>
          <button className="btn btn-ghost" onClick={skip}>SKIP — CONFIGURE LATER</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function PresetCard({ preset, onPick }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (w > 0) setScale(w / 800);
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const layout = inflatePresetLayout(preset);
  return (
    <button className="preset-card" onClick={onPick}>
      <div className="preset-thumb" ref={wrapRef}>
        <div className="preset-thumb-scale"
          style={{ width: 800, height: 480, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
          <LiveDashboard data={{ layout }} />
        </div>
      </div>
      <div className="preset-meta">
        <div className="preset-name">{preset.name}</div>
        <div className="preset-desc">{preset.description}</div>
      </div>
    </button>
  );
}
