import React, { useEffect, useState, useRef } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { Check, Crosshair, Lock } from '@phosphor-icons/react';
import { geocode, reverseGeocode, flagEmoji, setPin as apiSetPin } from '../api.js';
import { SCREEN_PRESETS, inflatePresetLayout, widgetById, newInstanceId, GRID_COLS, GRID_ROWS } from '../widgets.js';
import { layoutFromWidgetIds } from '../autolayout.js';
import { homeValue } from '../home.js';
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

// First-time setup. Three steps:
//   1. Location + timezone
//   2. Pick a starting screen preset
//   3. Optional control-panel PIN
// Sets `cfg.firstRun = false` when finished so it doesn't reappear.
const WIZARD_STEPS = ['Location', 'Layout', 'Security'];

// What a person wants on a wall panel, phrased as things they care about
// rather than as widget names. Picking a preset means adopting someone else's
// idea of a day; picking interests builds a screen out of what YOU asked for,
// and the packer arranges it.
// A `widgets` entry is a widget id, or `{ id, variant }` when the interest
// wants a specific view of a merged widget — "Weather" means both the
// conditions now and the days ahead, which are now two views of one widget.
const INTERESTS = [
  { id: 'weather',  label: 'Weather',        widgets: [{ id: 'weather', variant: 'now' }, { id: 'weather', variant: 'forecast' }] },
  { id: 'calendar', label: "What's on",      widgets: ['calendar'] },
  { id: 'clock',    label: 'The time',       widgets: ['clock'] },
  { id: 'news',     label: 'Headlines',      widgets: ['headlines'] },
  { id: 'outdoors', label: 'Sun & air',      widgets: ['outdoors'] },
  { id: 'markets',  label: 'Markets',        widgets: ['markets'] },
  { id: 'tasks',    label: 'To-do list',     widgets: ['tasks'] },
  { id: 'daily',    label: 'Something to read', widgets: ['daily'] },
  { id: 'art',      label: 'Something to look at', widgets: ['art'] },
  { id: 'battery',  label: 'Panel battery',  widgets: ['eink_battery'] },
];
export default function SetupWizard({ cfg, onPatch, onApplyPreset, onApplyLayout, onClose }) {
  const [step, setStep] = useState('location');
  const [picked, setPicked] = useState(() => new Set(['weather', 'calendar', 'clock']));
  const [buildNote, setBuildNote] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [pick, setPick] = useState(null);
  const [tz, setTz] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || homeValue(cfg, 'timezone') || 'UTC'; }
    catch { return homeValue(cfg, 'timezone') || 'UTC'; }
  });
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [pinErr, setPinErr] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

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
    // New configs are written in the cfg.home shape (stage 2 of
    // docs/setup-architecture.md). Old ones are never rewritten — homeValue()
    // reads the legacy top-level keys, so both shapes work. `cityLabel` is
    // not carried over: it was written here and read by nothing.
    onPatch({
      home: { ...(cfg.home || {}), city: cityStr, lat: pick.lat, lon: pick.lon, timezone: tz }
    });
    setStep('preset');
  };

  // Layout chosen → apply it, then move on to the optional PIN step.
  // Build a screen from the interests, arranged by the same packer the TIDY
  // button uses. Anything that does not fit is reported rather than dropped
  // in silence.
  const buildFromInterests = () => {
    const ids = [];
    const seen = new Set();
    for (const it of INTERESTS) {
      if (!picked.has(it.id)) continue;
      for (const w of it.widgets) {
        const spec = (typeof w === 'string') ? { id: w, variant: null } : w;
        const key = `${spec.id}:${spec.variant || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ids.push(spec);
      }
    }
    if (!ids.length) { setStep('pin'); return; }
    const r = layoutFromWidgetIds(ids, widgetById, newInstanceId, { cols: GRID_COLS, rows: GRID_ROWS });
    if (onApplyLayout) onApplyLayout(r.layout);
    // If the panel could not hold everything, say which ones did not make it.
    // Asking someone what they want and then quietly dropping half of it is
    // worse than not asking.
    setBuildNote(r.dropped.length
      ? `${r.dropped.length} didn't fit and were left out — add them from the widget pool.`
      : '');
    setStep('pin');
  };

  const choosePreset = (preset) => {
    if (preset && onApplyPreset) onApplyPreset(preset);
    setStep('pin');
  };

  const finish = () => {
    onPatch({ firstRun: false });
    onClose();
  };

  const skip = () => {
    onPatch({ firstRun: false });
    onClose();
  };

  const savePin = async () => {
    setPinErr('');
    if (!/^\d{4,}$/.test(pin)) { setPinErr('PIN must be at least 4 digits.'); return; }
    setPinBusy(true);
    const ok = await apiSetPin(pin);
    setPinBusy(false);
    if (ok) finish();
    else setPinErr('Could not set PIN.');
  };

  // ---- Location step ----
  if (step === 'location') {
    return (
      <m.div className="wizard-overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <m.div className="wizard-modal"
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
          <StepIndicator currentStep={1} steps={WIZARD_STEPS} />
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
            <button className="btn" onClick={useMyLocation} disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Crosshair size={14} weight="bold" />
              {busy ? 'LOCATING...' : 'USE MY LOCATION'}
            </button>
          </div>

          <AnimatePresence>
            {results.length > 0 && (
              <m.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
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
              </m.div>
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
        </m.div>
      </m.div>
    );
  }

  // ---- Preset step ----
  if (step === 'preset') {
    return (
      <m.div className="wizard-overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <m.div className="wizard-modal preset-modal"
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
          <StepIndicator currentStep={2} steps={WIZARD_STEPS} />
          <header>
            <h2>What do you want to see?</h2>
            <div className="terminal-line">&gt; PICK WHAT MATTERS · THE LAYOUT IS BUILT FROM YOUR ANSWERS</div>
          </header>

          <div className="interest-grid">
            {INTERESTS.map(it => {
              const on = picked.has(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`interest-chip ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setPicked(prev => {
                    const next = new Set(prev);
                    if (next.has(it.id)) next.delete(it.id); else next.add(it.id);
                    return next;
                  })}
                >
                  {it.label}
                </button>
              );
            })}
          </div>

          <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={() => setStep('location')}>← BACK</button>
            <div className="btn-row" style={{ marginTop: 0, gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setStep('presets')}>USE A PRESET INSTEAD</button>
              <button className="btn btn-primary" onClick={buildFromInterests} disabled={!picked.size}>
                BUILD MY SCREEN →
              </button>
            </div>
          </div>
        </m.div>
      </m.div>
    );
  }

  // ---- Preset gallery (still reachable, no longer the default path) ----
  //
  // The presets are good; they are just somebody else's day. They stay one
  // click away for people who would rather start from a finished screen.
  if (step === 'presets') {
    return (
      <m.div className="wizard-overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <m.div className="wizard-modal preset-modal"
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
          <StepIndicator currentStep={2} steps={WIZARD_STEPS} />
          <header>
            <h2>Pick a starting layout</h2>
            <div className="terminal-line">&gt; START FROM A PRESET · YOU CAN EDIT EVERYTHING AFTER</div>
          </header>

          <div className="preset-grid">
            {SCREEN_PRESETS.map(p => (
              <PresetCard key={p.id} preset={p} onPick={() => choosePreset(p)} />
            ))}
          </div>

          <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={() => setStep('preset')}>← BACK</button>
            <button className="btn btn-ghost" onClick={() => setStep('pin')}>SKIP — KEEP CURRENT</button>
          </div>
        </m.div>
      </m.div>
    );
  }

  // ---- PIN step (optional) ----
  return (
    <m.div className="wizard-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <m.div className="wizard-modal"
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
        <StepIndicator currentStep={3} steps={WIZARD_STEPS} />
        <header>
          <h2>Protect the control panel</h2>
          <div className="terminal-line">&gt; OPTIONAL · SET A PIN TO LOCK THE EDITOR</div>
        </header>

        <label className="field">
          <span className="label">Control-panel PIN (4+ digits)</span>
          <input
            type="password" inputMode="numeric" autoFocus value={pin}
            placeholder="••••"
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') savePin(); }}
            style={{ letterSpacing: 4 }}
          />
          <div className="terminal-line" style={{ fontSize: 10, marginTop: 4 }}>
            &gt; ANYONE WITH THE URL CAN EDIT UNTIL YOU SET ONE · CHANGE IT LATER IN THE HEADER
          </div>
        </label>
        {pinErr && <div className="loc-badge" style={{ color: '#b00', marginTop: 10 }}>{pinErr}</div>}

        <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={() => setStep('preset')}>← BACK</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={skip}>SKIP — NO PIN</button>
            <button className="btn btn-primary" onClick={savePin} disabled={pinBusy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Lock size={14} weight="bold" />
              {pinBusy ? 'SAVING...' : 'SET PIN & FINISH'}
            </button>
          </div>
        </div>
      </m.div>
    </m.div>
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
