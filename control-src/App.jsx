import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Star, GridFour, ArrowCounterClockwise, Wrench, Trash } from '@phosphor-icons/react';
import { fetchConfig, saveConfig, fetchPreviewData } from './api.js';
import {
  WIDGET_REGISTRY,
  GRID_COLS,
  GRID_ROWS,
  compactLayout,
  defaultsForScreen,
  migrateConfigToScreens,
  makeDefaultScreen,
  newScreenId,
  findOverlaps,
  scheduleIntervals,
  parseHHMM,
  pickActiveScreen,
  inflatePresetLayout
} from './widgets.js';
import EditorGrid from './components/EditorGrid.jsx';
import SaveBar from './components/SaveBar.jsx';
import ScreenTabs from './components/ScreenTabs.jsx';
import ScreenPresetPicker from './components/ScreenPresetPicker.jsx';
import ScreenPanel from './components/ScreenPanel.jsx';
import MacAgentBadge from './components/MacAgentBadge.jsx';
import ScheduleTimeline from './components/ScheduleTimeline.jsx';
import SetupWizard from './components/SetupWizard.jsx';
import ToolsButton from './components/ToolsButton.jsx';

const STATUS = {
  syncing: { label: 'SYNCING...', cls: 'saving' },
  synced:  { label: 'SYNCED',     cls: 'saved' },
  dirty:   { label: 'UNSAVED',    cls: 'dirty' },
  saving:  { label: 'SAVING...',  cls: 'saving' },
  saved:   { label: 'SAVED ✓',    cls: 'saved' },
  error:   { label: 'ERROR',      cls: 'error' }
};

const MAX_SCREENS = 20;

// Header sync indicator — Figma/Notion style. Persistent, quiet,
// surfaces only state + freshness. Caller passes the same `status`
// state the SaveBar reads from, plus the last successful save's
// timestamp so the pill can show "2m ago".
function relTime(then, now) {
  if (!then) return '';
  const diff = Math.max(0, now - then);
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function SyncPill({ status, lastSavedAt, statusMsg }) {
  const label = STATUS[status]?.label || 'SYNCED';
  const cls = STATUS[status]?.cls || 'saved';
  const ago = lastSavedAt ? relTime(lastSavedAt, Date.now()) : '';
  // The pill shows the verb (SAVED / SAVING / UNSAVED) and, when
  // available, when the last sync happened. On error, show the message
  // instead of an "ago" timestamp so the user knows what broke.
  return (
    <div className={`sync-pill sync-pill-${cls}`} role="status" aria-live="polite">
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-label">{label}</span>
      {ago && status !== 'error' && status !== 'dirty' && (
        <span className="sync-sep">·</span>
      )}
      {ago && status !== 'error' && status !== 'dirty' && (
        <span className="sync-ago">{ago}</span>
      )}
      {status === 'error' && statusMsg && (
        <>
          <span className="sync-sep">·</span>
          <span className="sync-ago">{statusMsg}</span>
        </>
      )}
    </div>
  );
}

function nowMinutesLocal(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    let h = 0, m = 0;
    for (const p of parts) {
      if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
      if (p.type === 'minute') m = parseInt(p.value, 10);
    }
    return h * 60 + m;
  } catch {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
}

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState('syncing');
  const [statusMsg, setStatusMsg] = useState(null);
  const [editScreenId, setEditScreenId] = useState(() => {
    try { return localStorage.getItem('ctrl.editScreenId') || null; } catch { return null; }
  });
  const [showGrid, setShowGrid] = useState(true);
  const [previewKey, setPreviewKey] = useState(Date.now());
  const [previewData, setPreviewData] = useState(null);
  const [toast, setToast] = useState(null);
  const [undoCfg, setUndoCfg] = useState(null);
  // Timestamp of the last successful sync — drives the header SyncPill's
  // "N min ago" readout. The existing 60s nowTick (further down) gives
  // us a re-render every minute so the pill ages without an explicit
  // poll here.
  const [lastSavedAt, setLastSavedAt] = useState(null);

  useEffect(() => {
    fetchConfig()
      .then(c => {
        const migrated = migrateConfigToScreens(c);
        setCfg(migrated);
        setEditScreenId(prev => {
          // Keep persisted tab if it still exists.
          if (prev && migrated.screens.some(s => s.id === prev)) return prev;
          const active = pickActiveScreen(migrated, nowMinutesLocal(migrated.timezone || 'UTC'));
          return active ? active.id : (migrated.screens[0] && migrated.screens[0].id);
        });
        setStatus('synced');
        setLastSavedAt(Date.now());
      })
      .catch(err => {
        setStatus('error');
        setStatusMsg(err.message);
      });
  }, []);

  // Persist UI prefs.
  useEffect(() => {
    try { if (editScreenId) localStorage.setItem('ctrl.editScreenId', editScreenId); } catch {}
  }, [editScreenId]);

  const screens = cfg ? (cfg.screens || []) : [];
  const editScreen = screens.find(s => s.id === editScreenId) || screens[0];

  // Ticker so the active-screen pick + the preview reload when the
  // wall clock crosses a schedule boundary. 60s is plenty — the
  // dashboard's own refresh interval is at least that long.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  // Lock preview to the scheduled screen at the current moment, unless
  // the user is actively editing (then follow their tab).
  const liveScreen = useMemo(() => {
    if (!cfg) return null;
    // Show the screen the user is editing — there is no separate "live"
    // mode anymore. The active scheduled screen is still surfaced via
    // the SCHEDULED badge in the timeline.
    return editScreen
      || pickActiveScreen(cfg, nowMinutesLocal(cfg.timezone || 'UTC'))
      || screens[0];
  }, [cfg, editScreen, screens, nowTick]);

  // Overlap validation.
  const overlaps = useMemo(() => findOverlaps(screens), [screens]);
  const overlapIds = useMemo(() => {
    const set = new Set();
    for (const o of overlaps) { set.add(o.screenAId); set.add(o.screenBId); }
    return set;
  }, [overlaps]);
  const hasDefault = screens.some(s => s.isDefault);
  const validationErrors = [];
  if (!screens.length) validationErrors.push('At least one screen is required');
  if (!hasDefault && screens.length) validationErrors.push('Mark one screen as default');
  if (overlaps.length) validationErrors.push(`${overlaps.length} schedule overlap${overlaps.length > 1 ? 's' : ''}`);
  for (const s of screens) {
    if (s.schedule && s.schedule.enabled) {
      const a = parseHHMM(s.schedule.from);
      const b = parseHHMM(s.schedule.to);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        validationErrors.push(`${s.name}: invalid HH:MM`);
        break;
      }
    }
  }
  const canSave = validationErrors.length === 0;

  // Refresh live preview data when the screen we're focused on changes,
  // or after a save.
  useEffect(() => {
    if (!cfg || !liveScreen) return;
    fetchPreviewData(liveScreen.id).then(setPreviewData).catch(() => {});
  }, [cfg, liveScreen, previewKey]);

  // Splice live cfg edits + the current screen's layout into the
  // preview data so editor tiles update instantly while typing.
  const livePreviewData = previewData
    ? { ...previewData, cfg, layout: editScreen ? editScreen.layout : [], chrome: editScreen ? editScreen.chrome : null }
    : { cfg, weather: null, events: [], units: (editScreen && editScreen.units) || 'F', layout: editScreen ? editScreen.layout : [], chrome: editScreen ? editScreen.chrome : null };


  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const markDirty = () => setStatus(s => s === 'dirty' ? s : 'dirty');

  // Wrap every cfg mutation so we can snapshot the previous state for undo.
  const mutateCfg = (fn) => {
    setCfg(prev => {
      setUndoCfg(prev);
      return fn(prev);
    });
    markDirty();
  };

  const patchCfg = (patch) => mutateCfg(prev => ({ ...prev, ...patch }));

  const patchNested = (key, patch) => mutateCfg(prev => ({
    ...prev, [key]: { ...(prev?.[key] || {}), ...patch }
  }));

  // ============ SCREENS ============
  const updateScreen = (id, patch) => mutateCfg(prev => ({
    ...prev,
    screens: prev.screens.map(s => s.id === id ? { ...s, ...patch } : s)
  }));

  const updateScreenLayout = (id, layout) => mutateCfg(prev => ({
    ...prev,
    screens: prev.screens.map(s => s.id === id ? { ...s, layout } : s)
  }));

  const [showPresetPicker, setShowPresetPicker] = useState(false);

  const addScreen = () => {
    if (cfg && cfg.screens && cfg.screens.length >= MAX_SCREENS) {
      showToast(`Max ${MAX_SCREENS} screens`);
      return;
    }
    setShowPresetPicker(true);
  };

  const addScreenWithPreset = (preset) => {
    setShowPresetPicker(false);
    mutateCfg(prev => {
      if (prev.screens.length >= MAX_SCREENS) return prev;
      const template = prev.screens[0] || {};
      const fresh = makeDefaultScreen({
        name: preset && preset.id !== 'blank' ? preset.name : `Screen ${prev.screens.length + 1}`,
        units: template.units || 'F',
        refreshMinutes: template.refreshMinutes || 30,
        layout: inflatePresetLayout(preset)
      });
      setTimeout(() => setEditScreenId(fresh.id), 0);
      return { ...prev, screens: [...prev.screens, fresh] };
    });
  };

  const deleteScreen = (id) => {
    if (screens.length <= 1) {
      showToast('Cannot delete the last screen');
      return;
    }
    const target = screens.find(s => s.id === id);
    if (!target) return;
    if (!window.confirm(`Delete screen "${target.name}"?`)) return;
    mutateCfg(prev => {
      const next = prev.screens.filter(s => s.id !== id);
      if (target.isDefault && next.length) next[0] = { ...next[0], isDefault: true };
      return { ...prev, screens: next };
    });
    if (editScreenId === id) {
      setEditScreenId(screens.find(s => s.id !== id)?.id || null);
    }
  };

  const setDefaultScreen = (id) => mutateCfg(prev => ({
    ...prev,
    screens: prev.screens.map(s => ({ ...s, isDefault: s.id === id }))
  }));

  const undo = () => {
    if (!undoCfg) {
      showToast('Nothing to undo');
      return;
    }
    setCfg(undoCfg);
    setUndoCfg(null);
    markDirty();
    showToast('Undone');
  };

  const handleSave = async () => {
    if (!cfg || !canSave) return;
    setStatus('saving');
    try {
      const saved = await saveConfig({ ...cfg, screens: cfg.screens });
      setCfg(migrateConfigToScreens(saved));
      setStatus('saved');
      setLastSavedAt(Date.now());
      setPreviewKey(Date.now());
      showToast('Saved ✓');
    } catch (err) {
      setStatus('error');
      setStatusMsg(err.message);
      showToast(`Save failed: ${err.message}`);
    }
  };

  // Save a single layout-item mutation right now, bypassing the 2s
  // autosave debounce. Used by the per-tile settings modal so the
  // Save button actually persists + refreshes preview before the
  // modal closes — no second click on the main save bar.
  const commitLayoutItemNow = async (screenId, updatedItem) => {
    if (!cfg) return;
    const nextCfg = {
      ...cfg,
      screens: cfg.screens.map(s => s.id === screenId
        ? { ...s, layout: s.layout.map(it => it.id === updatedItem.id ? { ...it, ...updatedItem } : it) }
        : s
      )
    };
    setCfg(nextCfg);
    setStatus('saving');
    try {
      const saved = await saveConfig({ ...nextCfg, screens: nextCfg.screens });
      setCfg(migrateConfigToScreens(saved));
      setStatus('saved');
      setLastSavedAt(Date.now());
      setPreviewKey(Date.now());
    } catch (err) {
      setStatus('error');
      setStatusMsg(err.message);
      showToast(`Save failed: ${err.message}`);
    }
  };

  const refreshPreview = () => setPreviewKey(Date.now());

  // Auto-save: 2s after the last edit if config is valid.
  useEffect(() => {
    if (status !== 'dirty' || !canSave) return;
    const t = setTimeout(() => { handleSave(); }, 2000);
    return () => clearTimeout(t);
  }, [status, canSave, cfg]);

  // Keyboard shortcuts:
  //   cmd+s        — save now
  //   cmd+z        — undo last change
  //   1..9         — jump to screen N
  //   [ / ]        — prev / next screen
  //   shift+a      — open the Add Screen preset picker
  useEffect(() => {
    function onKey(e) {
      const t = e.target;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canSave) handleSave();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (inField || mod) return;
      // Number key to switch screens
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const s = screens[idx];
        if (s) {
          e.preventDefault();
          setEditScreenId(s.id);
        }
        return;
      }
      // Bracket keys to nav prev/next screen
      if (e.key === '[' || e.key === ']') {
        const i = screens.findIndex(s => s.id === editScreenId);
        if (i < 0) return;
        const next = e.key === ']' ? (i + 1) % screens.length : (i - 1 + screens.length) % screens.length;
        e.preventDefault();
        setEditScreenId(screens[next].id);
        return;
      }
      // Shift+A — add screen
      if (e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        addScreen();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSave, cfg, undoCfg, status, screens, editScreenId]);

  if (!cfg) {
    return (
      <div className="shell">
        <div className="terminal-line">&gt; LOADING_CONFIG...</div>
      </div>
    );
  }

  const statusDef = STATUS[status] || STATUS.synced;
  const layout = editScreen ? editScreen.layout : [];

  return (
    <div className="shell">
      {/* SVG filter used by the 1-BIT preview toggle. feComponentTransfer
       * with discrete tableValues "0 1" thresholds each channel at 0.5,
       * which is the actual 1-bit pipeline the server runs. Applies wherever
       * `filter: url(#eink-threshold)` is set. */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="eink-threshold" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix"
            values="0.299 0.587 0.114 0 0
                    0.299 0.587 0.114 0 0
                    0.299 0.587 0.114 0 0
                    0     0     0     1 0" />
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0 1" />
            <feFuncG type="discrete" tableValues="0 1" />
            <feFuncB type="discrete" tableValues="0 1" />
          </feComponentTransfer>
        </filter>
      </svg>
      <header className="app-header">
        <div className="app-header-left">
          <h1>Dashboard Control</h1>
          <a
            className="app-header-link"
            href="/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            title="Open the live dashboard render in a new tab"
          >
            View display →
          </a>
        </div>
        <div className="app-header-center">
          <SyncPill status={status} lastSavedAt={lastSavedAt} statusMsg={statusMsg} />
        </div>
        <div className="app-header-right">
          <MacAgentBadge />
          {cfg && (
            <ToolsButton
              cfg={cfg}
              onReplaceConfig={(next) => {
                setCfg(migrateConfigToScreens(next));
                setStatus('dirty');
              }}
            />
          )}
        </div>
      </header>

      <ScreenTabs
        screens={screens}
        activeId={editScreenId}
        overlapIds={overlapIds}
        editMode={true}
        liveScreen={liveScreen}
        onSelect={setEditScreenId}
        onAdd={addScreen}
        canAdd={screens.length < MAX_SCREENS}
      />

      <ScheduleTimeline
        screens={screens}
        activeId={editScreenId}
        overlapIds={overlapIds}
        timezone={cfg.timezone || 'UTC'}
        onSelect={setEditScreenId}
        onUpdateSchedule={(id, patch) => updateScreen(id, {
          schedule: { ...(screens.find(s => s.id === id)?.schedule || { enabled: false }), ...patch, enabled: true }
        })}
      />

      <main className="layout edit-mode">
        <aside className="settings-sidebar">
          {editScreen && (
            <ScreenPanel
              screen={editScreen}
              isOverlap={overlapIds.has(editScreen.id)}
              onUpdate={(patch) => updateScreen(editScreen.id, patch)}
            />
          )}
        </aside>
        <div className="canvas-column">
          <section className="card">
            <div className="section-title">
              <span>{editScreen?.name || 'Screen'}</span>
              <div className="btn-row" style={{ marginTop: 0, gap: 6 }}>
                <span className="badge">{GRID_COLS}×{GRID_ROWS}</span>
                {editScreen && editScreen.isDefault && (
                  <span className="badge" title="Active when no schedule matches the current time">DEFAULT</span>
                )}
                {editScreen && !editScreen.isDefault && (
                  <button
                    className="btn btn-ghost btn-iconed"
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    title="Show this screen when no schedule matches"
                    onClick={() => setDefaultScreen(editScreen.id)}
                  >
                    <Star size={12} weight="bold" /> MAKE DEFAULT
                  </button>
                )}
                <button className="btn btn-iconed" onClick={() => setShowGrid(g => !g)}
                  style={{ padding: '4px 10px', fontSize: 11 }}>
                  <GridFour size={12} weight="bold" /> {showGrid ? 'HIDE GRID' : 'SHOW GRID'}
                </button>
                <button className="btn btn-ghost btn-iconed"
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={() => updateScreenLayout(editScreen.id, [])}>
                  <ArrowCounterClockwise size={12} weight="bold" /> CLEAR
                </button>
                {editScreen && screens.length > 1 && (
                  <button className="btn btn-danger btn-iconed"
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    title="Delete this screen"
                    onClick={() => deleteScreen(editScreen.id)}>
                    <Trash size={12} weight="bold" /> DELETE
                  </button>
                )}
              </div>
            </div>
            <EditorGrid
              layout={layout}
              showGrid={showGrid}
              previewData={livePreviewData}
              seedCtx={{
                city: cfg.city || '',
                lat: Number.isFinite(cfg.lat) ? cfg.lat : null,
                lon: Number.isFinite(cfg.lon) ? cfg.lon : null
              }}
              onChange={(next) => updateScreenLayout(editScreen.id, next)}
              onError={showToast}
              onCommitItemNow={(item) => commitLayoutItemNow(editScreen.id, item)}
            />
            <div className="editor-help">
              DRAG TILE TO MOVE · CORNER TO RESIZE · × OR DRAG TO TRASH · DRAG POOL CARD ONTO CANVAS
            </div>
          </section>
        </div>
      </main>

      <SaveBar
        status={canSave ? statusDef.cls : 'error'}
        label={
          canSave
            ? (statusDef.label + (statusMsg && status === 'error' ? ` · ${statusMsg}` : ''))
            : `BLOCKED · ${validationErrors[0]}`
        }
        onSave={handleSave}
        onDiscard={undoCfg ? undo : null}
        disabled={!canSave}
      />

      {toast && (
        <div className="toast">{toast}</div>
      )}

      {/* First-run setup wizard: shows until user picks a location or
       *  explicitly skips. cfg.firstRun is set to false once dismissed. */}
      {cfg.firstRun !== false && !cfg.lat && (
        <SetupWizard
          cfg={cfg}
          onPatch={patchCfg}
          onApplyPreset={(preset) => {
            // Replace the default screen's layout with the chosen preset.
            const defaultId = (screens.find(s => s.isDefault) || screens[0])?.id;
            if (!defaultId) return;
            const layout = inflatePresetLayout(preset);
            updateScreenLayout(defaultId, layout);
          }}
          onClose={() => {}}
        />
      )}

      {showPresetPicker && (
        <ScreenPresetPicker
          previewData={livePreviewData}
          onPick={addScreenWithPreset}
          onClose={() => setShowPresetPicker(false)}
        />
      )}
    </div>
  );
}
