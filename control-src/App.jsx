import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { fetchConfig, saveConfig, previewUrl } from './api.js';
import {
  WIDGET_REGISTRY,
  GRID_COLS,
  GRID_ROWS,
  resolveLayout
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
  const [layout, setLayout] = useState([]); // editor working copy
  const [status, setStatus] = useState('syncing');
  const [statusMsg, setStatusMsg] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [previewKey, setPreviewKey] = useState(Date.now());

  useEffect(() => {
    fetchConfig()
      .then(c => {
        setCfg(c);
        setLayout(resolveLayout(c));
        setStatus('synced');
      })
      .catch(err => {
        setStatus('error');
        setStatusMsg(err.message);
      });
  }, []);

  const markDirty = () => { if (status !== 'dirty') setStatus('dirty'); };

  const patchCfg = (patch) => {
    setCfg(prev => ({ ...prev, ...patch }));
    markDirty();
  };

  const patchNested = (key, patch) => {
    setCfg(prev => ({ ...prev, [key]: { ...(prev?.[key] || {}), ...patch } }));
    markDirty();
  };

  const updateLayoutItem = (id, patch) => {
    setLayout(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
    markDirty();
  };

  const handleSave = async () => {
    if (!cfg) return;
    setStatus('saving');
    try {
      // Persist the editor layout array and keep the legacy widgets booleans
      // in sync (so devices without `layout` still render correctly).
      const widgetsBool = { ...(cfg.widgets || {}) };
      for (const def of WIDGET_REGISTRY) {
        const item = layout.find(l => l.id === def.id);
        if (item) widgetsBool[def.requires] = item.enabled !== false;
      }
      const next = {
        ...cfg,
        widgets: widgetsBool,
        layout: layout.map(({ id, x, y, w, h, enabled }) => ({ id, x, y, w, h, enabled }))
      };
      const saved = await saveConfig(next);
      setCfg(saved);
      setLayout(resolveLayout(saved));
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
            onClick={() => setEditMode(v => !v)}
          >
            {editMode ? 'EXIT EDIT' : '✎ EDIT LAYOUT'}
          </motion.button>
        </div>
      </header>

      <main className="layout">
        <div className="preview-stage">
          <Preview src={previewUrl()} cacheKey={previewKey} onRefresh={refreshPreview} />
        </div>

        <div className="settings">
          <AnimatePresence mode="wait">
            {editMode ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <section className="card">
                  <div className="section-title">
                    <span>Edit Layout</span>
                    <span className="badge">{GRID_COLS}×{GRID_ROWS}</span>
                  </div>
                  <div className="editor-toolbar">
                    <div className="btn-row">
                      <button className="btn" onClick={() => setShowGrid(g => !g)}>
                        {showGrid ? '◧ HIDE GRID' : '◧ SHOW GRID'}
                      </button>
                      <button className="btn btn-ghost" onClick={() => {
                        // Reset to defaults
                        setLayout(WIDGET_REGISTRY.map(def => ({
                          id: def.id,
                          ...def.defaultLayout,
                          enabled: !!(cfg.widgets && cfg.widgets[def.requires])
                        })));
                        markDirty();
                      }}>
                        ↻ RESET
                      </button>
                    </div>
                  </div>
                  <EditorGrid
                    layout={layout}
                    showGrid={showGrid}
                    onChange={(next) => { setLayout(next); markDirty(); }}
                    onToggle={(id) => {
                      const item = layout.find(l => l.id === id);
                      if (!item) return;
                      updateLayoutItem(id, { enabled: !item.enabled });
                    }}
                  />
                  <div className="editor-help">
                    DRAG TO MOVE · CORNER TO RESIZE · CLICK TILE TO TOGGLE ON/OFF
                  </div>
                </section>
              </motion.div>
            ) : (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <Settings
                  cfg={cfg}
                  layout={layout}
                  onPatch={patchCfg}
                  onPatchNested={patchNested}
                  onToggleWidget={(id) => {
                    const item = layout.find(l => l.id === id);
                    if (!item) return;
                    updateLayoutItem(id, { enabled: !item.enabled });
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <SaveBar
        status={statusDef.cls}
        label={statusDef.label + (statusMsg && status === 'error' ? ` · ${statusMsg}` : '')}
        onSave={handleSave}
      />
    </div>
  );
}
