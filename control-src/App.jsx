import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { fetchConfig, saveConfig, fetchPreviewData } from './api.js';
import {
  WIDGET_REGISTRY,
  GRID_COLS,
  GRID_ROWS,
  SCREENS,
  getScreenLayout,
  compactLayout,
  defaultsForScreen
} from './widgets.js';
import EditorGrid from './components/EditorGrid.jsx';
import Settings from './components/Settings.jsx';
import Preview from './components/Preview.jsx';
import SaveBar from './components/SaveBar.jsx';

const STATUS = {
  syncing: { label: 'SYNCING...', cls: 'saving' },
  synced:  { label: 'SYNCED',     cls: 'saved' },
  dirty:   { label: 'UNSAVED',    cls: 'dirty' },
  saving:  { label: 'SAVING...',  cls: 'saving' },
  saved:   { label: 'SAVED ✓',    cls: 'saved' },
  error:   { label: 'ERROR',      cls: 'error' }
};

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [layouts, setLayouts] = useState({ 1: [], 2: [] });
  const [editSnapshot, setEditSnapshot] = useState(null);
  const [status, setStatus] = useState('syncing');
  const [statusMsg, setStatusMsg] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editScreen, setEditScreen] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [previewKey, setPreviewKey] = useState(Date.now());
  const [previewData, setPreviewData] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchConfig()
      .then(c => {
        setCfg(c);
        setLayouts({
          1: getScreenLayout(c, 1),
          2: getScreenLayout(c, 2)
        });
        setEditScreen(parseInt(c.screen, 10) === 2 ? 2 : 1);
        setStatus('synced');
      })
      .catch(err => {
        setStatus('error');
        setStatusMsg(err.message);
      });
  }, []);

  // Pull the live widget data whenever we save (or first mount). Editor
  // tiles render real content from this payload.
  useEffect(() => {
    if (!cfg) return;
    const screen = editMode ? editScreen : (parseInt(cfg.screen, 10) === 2 ? 2 : 1);
    fetchPreviewData(screen).then(setPreviewData).catch(() => {});
  }, [cfg, editScreen, editMode, previewKey]);

  // Live cfg updates flow into the previewData snapshot so tiles
  // reflect text edits (message, todos, quote, etc) without waiting
  // for a save round-trip.
  const livePreviewData = previewData
    ? { ...previewData, cfg }
    : { cfg, weather: null, events: [], units: (cfg?.units || 'F'), screen: editScreen };

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

  const updateLayout = (screen, next) => {
    setLayouts(prev => ({ ...prev, [screen]: next }));
    markDirty();
  };

  const handleSave = async () => {
    if (!cfg) return;
    setStatus('saving');
    try {
      // Keep legacy `cfg.widgets` booleans in sync with whatever's enabled
      // on screen 1, so devices that haven't migrated still render right.
      const widgetsBool = { ...(cfg.widgets || {}) };
      for (const def of WIDGET_REGISTRY) {
        const item = layouts[1].find(l => l.id === def.id);
        if (item) widgetsBool[def.requires] = item.enabled !== false;
      }
      const next = {
        ...cfg,
        widgets: widgetsBool,
        layouts: {
          1: compactLayout(layouts[1]),
          2: compactLayout(layouts[2])
        }
      };
      // Drop the legacy single-array field if present; new schema lives on
      // `layouts`.
      delete next.layout;
      const saved = await saveConfig(next);
      setCfg(saved);
      setLayouts({
        1: getScreenLayout(saved, 1),
        2: getScreenLayout(saved, 2)
      });
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
  const layout = layouts[editScreen] || [];

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
                // Exiting edit mode. If the user has unsaved changes,
                // ask whether to discard or keep them (which auto-saves
                // is still up to them on the Save bar).
                if (status === 'dirty' && editSnapshot) {
                  const discard = window.confirm(
                    'Discard unsaved layout changes?\n\nClick OK to revert the editor to the last saved state. Click Cancel to keep editing.'
                  );
                  if (!discard) return;
                  setLayouts(editSnapshot.layouts);
                  setCfg(editSnapshot.cfg);
                  setStatus('synced');
                }
                setEditSnapshot(null);
                setEditMode(false);
              } else {
                // Entering edit mode — snapshot so we can roll back.
                setEditSnapshot({
                  layouts: { 1: [...layouts[1]], 2: [...layouts[2]] },
                  cfg: { ...cfg }
                });
                setEditMode(true);
              }
            }}
          >
            {editMode ? 'EXIT EDIT' : '✎ EDIT LAYOUT'}
          </motion.button>
        </div>
      </header>

      <main className={`layout ${editMode ? 'edit-mode' : ''}`}>
        {!editMode && (
          <div className="preview-stage">
            <Preview
              screen={parseInt(cfg.screen, 10) === 2 ? 2 : 1}
              cacheKey={previewKey}
              onRefresh={refreshPreview}
            />
          </div>
        )}

        <div className="settings">
          {editMode ? (
            <section className="card">
              <div className="section-title">
                <span>Edit Layout</span>
                <span className="badge">{GRID_COLS}×{GRID_ROWS}</span>
              </div>
              <div className="editor-toolbar">
                <div className="btn-row" style={{ marginTop: 0 }}>
                  <span className="editor-help" style={{ marginRight: 6, marginTop: 0 }}>SCREEN</span>
                  {SCREENS.map(s => (
                    <button
                      key={s}
                      className={`btn ${editScreen === s ? 'btn-primary' : ''}`}
                      onClick={() => setEditScreen(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="btn-row" style={{ marginTop: 0 }}>
                  <button className="btn" onClick={() => setShowGrid(g => !g)}>
                    {showGrid ? '◧ HIDE GRID' : '◧ SHOW GRID'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => {
                    updateLayout(editScreen, defaultsForScreen(editScreen));
                  }}>
                    ↻ RESET
                  </button>
                </div>
              </div>
              <EditorGrid
                layout={layout}
                showGrid={showGrid}
                previewData={livePreviewData}
                onChange={(next) => updateLayout(editScreen, next)}
                onError={showToast}
              />
              <div className="editor-help">
                DRAG TILE TO MOVE · CORNER TO RESIZE (SNAPS TO VALID SIZES) · × TO REMOVE · DRAG POOL CARD ONTO CANVAS
              </div>
            </section>
          ) : (
            <Settings
              cfg={cfg}
              layout={layout}
              onPatch={patchCfg}
              onPatchNested={patchNested}
            />
          )}
        </div>
      </main>

      <SaveBar
        status={statusDef.cls}
        label={statusDef.label + (statusMsg && status === 'error' ? ` · ${statusMsg}` : '')}
        onSave={handleSave}
      />

      {toast && (
        <div className="toast">{toast}</div>
      )}
    </div>
  );
}
