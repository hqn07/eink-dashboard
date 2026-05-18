import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
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
import Settings from './components/Settings.jsx';
import SaveBar from './components/SaveBar.jsx';
import ScreenTabs from './components/ScreenTabs.jsx';
import ScreenPresetPicker from './components/ScreenPresetPicker.jsx';
import ScreenPanel from './components/ScreenPanel.jsx';
import ChromePanel from './components/ChromePanel.jsx';
import ScheduleTimeline from './components/ScheduleTimeline.jsx';
import SetupWizard from './components/SetupWizard.jsx';

const STATUS = {
  syncing: { label: 'SYNCING...', cls: 'saving' },
  synced:  { label: 'SYNCED',     cls: 'saved' },
  dirty:   { label: 'UNSAVED',    cls: 'dirty' },
  saving:  { label: 'SAVING...',  cls: 'saving' },
  saved:   { label: 'SAVED ✓',    cls: 'saved' },
  error:   { label: 'ERROR',      cls: 'error' }
};

const MAX_SCREENS = 20;

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
  const [focusedWidgetId, setFocusedWidgetId] = useState(null);

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
      setPreviewKey(Date.now());
      showToast('Saved ✓');
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

  // Keyboard shortcuts: cmd+s save, cmd+z undo.
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
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSave, cfg, undoCfg, status]);

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
      <header className="app-header">
        <div>
          <h1>Dashboard Control</h1>
          <div className="tagline">E-Ink · 800 × 480 · Editorial</div>
        </div>
        <div className="actions">
          <span className="terminal-line" style={{ fontSize: 10 }}>
            &gt; LIVE EDIT · AUTO-SAVE
          </span>
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
        <div className="settings">
          <section className="card">
            <div className="section-title">
              <span>{editScreen?.name || 'Screen'}</span>
              <div className="btn-row" style={{ marginTop: 0, gap: 6 }}>
                <span className="badge">{GRID_COLS}×{GRID_ROWS}</span>
                <button className="btn" onClick={() => setShowGrid(g => !g)}
                  style={{ padding: '4px 10px', fontSize: 11 }}>
                  {showGrid ? '◧ HIDE GRID' : '◧ SHOW GRID'}
                </button>
                <button className="btn btn-ghost"
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={() => updateScreenLayout(editScreen.id, [])}>
                  ↻ CLEAR
                </button>
              </div>
            </div>
            <EditorGrid
              layout={layout}
              showGrid={showGrid}
              previewData={livePreviewData}
              onChange={(next) => updateScreenLayout(editScreen.id, next)}
              onError={showToast}
              onJumpToSettings={(widgetId) => {
                setFocusedWidgetId(widgetId);
              }}
            />
            <div className="editor-help">
              DRAG TILE TO MOVE · CORNER TO RESIZE · × OR DRAG TO TRASH · DRAG POOL CARD ONTO CANVAS
            </div>
            {editScreen && (
              <ChromePanel
                screen={editScreen}
                onUpdate={(patch) => updateScreen(editScreen.id, patch)}
              />
            )}
          </section>

          {editScreen && (
            <ScreenPanel
              screen={editScreen}
              isOverlap={overlapIds.has(editScreen.id)}
              onUpdate={(patch) => updateScreen(editScreen.id, patch)}
              onSetDefault={() => setDefaultScreen(editScreen.id)}
              onDelete={() => deleteScreen(editScreen.id)}
              canDelete={screens.length > 1}
            />
          )}
          <Settings
            cfg={cfg}
            layout={layout}
            onPatch={patchCfg}
            onPatchNested={patchNested}
            focusedWidgetId={focusedWidgetId}
            onFocusHandled={() => setFocusedWidgetId(null)}
            onReplaceConfig={(next) => {
              setCfg(migrateConfigToScreens(next));
              setStatus('dirty');
            }}
          />
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
