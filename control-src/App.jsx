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
  pickActiveScreen
} from './widgets.js';
import EditorGrid from './components/EditorGrid.jsx';
import Settings from './components/Settings.jsx';
import Preview from './components/Preview.jsx';
import SaveBar from './components/SaveBar.jsx';
import ScreenTabs from './components/ScreenTabs.jsx';
import ScreenPanel from './components/ScreenPanel.jsx';

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
  const [editSnapshot, setEditSnapshot] = useState(null);
  const [status, setStatus] = useState('syncing');
  const [statusMsg, setStatusMsg] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editScreenId, setEditScreenId] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [previewKey, setPreviewKey] = useState(Date.now());
  const [previewData, setPreviewData] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchConfig()
      .then(c => {
        const migrated = migrateConfigToScreens(c);
        setCfg(migrated);
        // Default to the screen the dashboard would render right now.
        const active = pickActiveScreen(migrated, nowMinutesLocal(migrated.timezone || 'UTC'));
        setEditScreenId(active ? active.id : (migrated.screens[0] && migrated.screens[0].id));
        setStatus('synced');
      })
      .catch(err => {
        setStatus('error');
        setStatusMsg(err.message);
      });
  }, []);

  const screens = cfg ? (cfg.screens || []) : [];
  const editScreen = screens.find(s => s.id === editScreenId) || screens[0];

  // Lock preview to the scheduled screen at the current moment, unless
  // the user is actively editing (then follow their tab).
  const liveScreen = useMemo(() => {
    if (!cfg) return null;
    if (editMode) return editScreen;
    return pickActiveScreen(cfg, nowMinutesLocal(cfg.timezone || 'UTC'))
      || editScreen
      || screens[0];
  }, [cfg, editMode, editScreen, screens]);

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
    ? { ...previewData, cfg, layout: editScreen ? editScreen.layout : [] }
    : { cfg, weather: null, events: [], units: (editScreen && editScreen.units) || 'F', layout: editScreen ? editScreen.layout : [] };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const markDirty = () => setStatus(s => s === 'dirty' ? s : 'dirty');

  const patchCfg = (patch) => {
    setCfg(prev => ({ ...prev, ...patch }));
    markDirty();
  };

  const patchNested = (key, patch) => {
    setCfg(prev => ({ ...prev, [key]: { ...(prev?.[key] || {}), ...patch } }));
    markDirty();
  };

  // ============ SCREENS ============
  const updateScreen = (id, patch) => {
    setCfg(prev => ({
      ...prev,
      screens: prev.screens.map(s => s.id === id ? { ...s, ...patch } : s)
    }));
    markDirty();
  };

  const updateScreenLayout = (id, layout) => {
    setCfg(prev => ({
      ...prev,
      screens: prev.screens.map(s => s.id === id ? { ...s, layout } : s)
    }));
    markDirty();
  };

  const addScreen = () => {
    setCfg(prev => {
      if (prev.screens.length >= MAX_SCREENS) return prev;
      const template = prev.screens[0] || {};
      const fresh = makeDefaultScreen({
        name: `Screen ${prev.screens.length + 1}`,
        units: template.units || 'F',
        refreshMinutes: template.refreshMinutes || 30
      });
      return { ...prev, screens: [...prev.screens, fresh] };
    });
    markDirty();
  };

  const deleteScreen = (id) => {
    if (screens.length <= 1) {
      showToast('Cannot delete the last screen');
      return;
    }
    const target = screens.find(s => s.id === id);
    if (!target) return;
    if (!window.confirm(`Delete screen "${target.name}"?`)) return;
    setCfg(prev => {
      const next = prev.screens.filter(s => s.id !== id);
      // If we deleted the default, promote the first remaining one.
      if (target.isDefault && next.length) next[0] = { ...next[0], isDefault: true };
      return { ...prev, screens: next };
    });
    if (editScreenId === id) {
      setEditScreenId(screens.find(s => s.id !== id)?.id || null);
    }
    markDirty();
  };

  const setDefaultScreen = (id) => {
    setCfg(prev => ({
      ...prev,
      screens: prev.screens.map(s => ({ ...s, isDefault: s.id === id }))
    }));
    markDirty();
  };

  const handleSave = async () => {
    if (!cfg || !canSave) return;
    setStatus('saving');
    try {
      const saved = await saveConfig({ ...cfg, screens: cfg.screens });
      setCfg(migrateConfigToScreens(saved));
      setStatus('saved');
      setPreviewKey(Date.now());
    } catch (err) {
      setStatus('error');
      setStatusMsg(err.message);
    }
  };

  const refreshPreview = () => setPreviewKey(Date.now());

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
          <motion.button
            whileTap={{ scale: 0.96 }}
            className={`btn ${editMode ? 'btn-primary' : ''}`}
            onClick={() => {
              if (editMode) {
                if (status === 'dirty' && editSnapshot) {
                  const discard = window.confirm(
                    'Discard unsaved layout changes?\n\nOK = revert. Cancel = keep editing.'
                  );
                  if (!discard) return;
                  setCfg(editSnapshot.cfg);
                  setStatus('synced');
                }
                setEditSnapshot(null);
                setEditMode(false);
              } else {
                setEditSnapshot({ cfg: JSON.parse(JSON.stringify(cfg)) });
                setEditMode(true);
              }
            }}
          >
            {editMode ? 'EXIT EDIT' : '✎ EDIT LAYOUT'}
          </motion.button>
        </div>
      </header>

      <ScreenTabs
        screens={screens}
        activeId={editScreenId}
        overlapIds={overlapIds}
        editMode={editMode}
        liveScreen={liveScreen}
        onSelect={setEditScreenId}
        onAdd={addScreen}
        canAdd={screens.length < MAX_SCREENS}
      />

      <main className={`layout ${editMode ? 'edit-mode' : ''}`}>
        {!editMode && (
          <div className="preview-stage">
            <Preview
              screen={liveScreen ? liveScreen.id : ''}
              cacheKey={previewKey}
              onRefresh={refreshPreview}
            />
            {liveScreen && pickActiveScreen(cfg, nowMinutesLocal(cfg.timezone || 'UTC'))?.id === liveScreen.id && liveScreen.schedule?.enabled && (
              <div className="schedule-lock-badge">
                SCHEDULED · {liveScreen.name} · {liveScreen.schedule.from}–{liveScreen.schedule.to}
              </div>
            )}
          </div>
        )}

        <div className="settings">
          {editMode ? (
            <section className="card">
              <div className="section-title">
                <span>Edit Layout — {editScreen?.name || ''}</span>
                <span className="badge">{GRID_COLS}×{GRID_ROWS}</span>
              </div>
              <div className="editor-toolbar">
                <div className="btn-row" style={{ marginTop: 0 }}>
                  <button className="btn" onClick={() => setShowGrid(g => !g)}>
                    {showGrid ? '◧ HIDE GRID' : '◧ SHOW GRID'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => {
                    updateScreenLayout(editScreen.id, []);
                  }}>
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
              />
              <div className="editor-help">
                DRAG TILE TO MOVE · CORNER TO RESIZE · × OR DRAG TO TRASH · DRAG POOL CARD ONTO CANVAS
              </div>
            </section>
          ) : (
            <>
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
              />
            </>
          )}
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
    </div>
  );
}
