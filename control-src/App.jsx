import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { Star, ArrowCounterClockwise, SlidersHorizontal, Trash, Lock, Cards } from '@phosphor-icons/react';
import { fetchConfig, saveConfig, fetchPreviewData, onUnauthorized } from './api.js';
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
import ScheduleTimeline from './components/ScheduleTimeline.jsx';
import QuietHours from './components/QuietHours.jsx';
import SetupWizard from './components/SetupWizard.jsx';
import SettingsMenu from './components/SettingsMenu.jsx';
import ShortcutsHelp from './components/ShortcutsHelp.jsx';
import LiveDashboard from './components/LiveDashboard.jsx';
import DeviceStatusCard from './components/DeviceStatusCard.jsx';

const STATUS = {
  syncing: { label: 'SYNCING...', cls: 'saving' },
  synced:  { label: 'SYNCED',     cls: 'saved' },
  dirty:   { label: 'UNSAVED',    cls: 'dirty' },
  saving:  { label: 'SAVING...',  cls: 'saving' },
  saved:   { label: 'SAVED ✓',    cls: 'saved' },
  error:   { label: 'ERROR',      cls: 'error' }
};

const MAX_SCREENS = 20;

// Right-side always-on Live preview pane. The dashboard renders at
// the real 800×480 size and is then CSS-scaled down to fit the
// pane's actual width via a ResizeObserver, so the preview stays
// crisp at any pane width.
function PreviewPane({ data, label, onHide, refreshMinutes }) {
  const wrapRef = React.useRef(null);
  const [scale, setScale] = useState(0.4);
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
  return (
    <aside className="preview-pane">
      <div className="preview-pane-head">
        <span className="preview-pane-title">Live preview</span>
        <button
          type="button"
          className="preview-pane-toggle"
          onClick={onHide}
          title="Hide preview pane"
          aria-label="Hide preview pane"
        >×</button>
      </div>
      <div className="preview-pane-frame" ref={wrapRef} style={{ height: 800 * scale * (480 / 800) }}>
        <div
          className="preview-pane-scale"
          style={{
            width: 800,
            height: 480,
            transform: `scale(${scale})`,
            transformOrigin: 'top left'
          }}
        >
          <LiveDashboard data={data} />
        </div>
      </div>
      <div className="preview-pane-meta">{label}</div>
      <DeviceStatusCard refreshMinutes={refreshMinutes} />
    </aside>
  );
}

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
  // Schedule timeline starts collapsed unless the user has opened it
  // before; the strip is only relevant when the user has > 1 screen
  // with scheduling enabled, which is the minority case.
  const [timelineOpen, setTimelineOpen] = useState(() => {
    try { return localStorage.getItem('ctrl.timelineOpen') === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('ctrl.timelineOpen', timelineOpen ? '1' : '0'); }
    catch { /* ignore */ }
  }, [timelineOpen]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Auto-fade the SaveBar after a brief success window. The 'saved'
  // state stays long enough for the SyncPill flash to confirm the
  // write, then transitions to 'synced' so SaveBar slides out.
  useEffect(() => {
    if (status !== 'saved') return;
    const t = setTimeout(() => setStatus(s => (s === 'saved' ? 'synced' : s)), 1500);
    return () => clearTimeout(t);
  }, [status]);
  // Right-side live preview pane. Defaults to open since it's the main
  // win of the 3-col layout; user can dismiss and the state sticks.
  const [previewPaneOpen, setPreviewPaneOpen] = useState(() => {
    try { return localStorage.getItem('ctrl.previewPaneOpen') !== '0'; }
    catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('ctrl.previewPaneOpen', previewPaneOpen ? '1' : '0'); }
    catch { /* ignore */ }
  }, [previewPaneOpen]);
  // Mobile bottom-sheet drawer holding the sidebar contents. Driven
  // by a FAB shown only below the sidebar's narrow breakpoint.
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(Date.now());
  const [previewData, setPreviewData] = useState(null);
  const [toast, setToast] = useState(null);
  // Undo/redo history stacks of whole-cfg snapshots. Every mutateCfg pushes
  // the prior cfg onto undoStack and clears redoStack; undo/redo shuttle
  // between them. Capped so a long editing session doesn't grow unbounded.
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const HISTORY_MAX = 50;
  // Timestamp of the last successful sync — drives the header SyncPill's
  // "N min ago" readout. The existing 60s nowTick (further down) gives
  // us a re-render every minute so the pill ages without an explicit
  // poll here.
  const [lastSavedAt, setLastSavedAt] = useState(null);
  // Locked when the server rejects us (401) and we have no working credential.
  // Read-only: the grid stops responding to drag/resize and the save bar hides,
  // so editing isn't possible without authorization (not just non-persistent).
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => { onUnauthorized(() => setReadOnly(true)); }, []);

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
  const editCardStyle = (editScreen && editScreen.cardStyle) || 'grid';
  const livePreviewData = previewData
    ? { ...previewData, cfg, layout: editScreen ? editScreen.layout : [], chrome: editScreen ? editScreen.chrome : null, cardStyle: editCardStyle }
    : { cfg, weather: null, events: [], units: (editScreen && editScreen.units) || 'F', layout: editScreen ? editScreen.layout : [], chrome: editScreen ? editScreen.chrome : null, cardStyle: editCardStyle };


  // Toast supports an optional action button ({ label, onClick }) for
  // the "destructive action + undo" pattern. The timer ref prevents an
  // earlier toast's timeout from dismissing a newer toast early.
  const toastTimerRef = useRef(null);
  const showToast = (msg, action = null) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, action });
    toastTimerRef.current = setTimeout(
      () => setToast(null),
      action ? 5000 : 1800
    );
  };

  const markDirty = () => setStatus(s => s === 'dirty' ? s : 'dirty');

  // Wrap every cfg mutation so we can snapshot the previous state for undo.
  const mutateCfg = (fn) => {
    setCfg(prev => {
      setUndoStack(st => [...st, prev].slice(-HISTORY_MAX));
      setRedoStack([]);
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
  // Manual re-launch of the setup wizard (it otherwise only auto-shows on
  // first run when no location is set).
  const [showWizard, setShowWizard] = useState(false);

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
    setUndoStack(st => {
      if (!st.length) { showToast('Nothing to undo'); return st; }
      const prev = st[st.length - 1];
      setRedoStack(rs => [...rs, cfg].slice(-HISTORY_MAX));
      setCfg(prev);
      markDirty();
      showToast('Undone');
      return st.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack(rs => {
      if (!rs.length) { showToast('Nothing to redo'); return rs; }
      const next = rs[rs.length - 1];
      setUndoStack(st => [...st, cfg].slice(-HISTORY_MAX));
      setCfg(next);
      markDirty();
      showToast('Redone');
      return rs.slice(0, -1);
    });
  };

  // Pre-save validation pass — DOM-scoped, no per-field registry. We
  // walk the page for invalid TimeField / URL inputs (each marks
  // itself with .time-field-invalid / .url-badge-invalid), grab the
  // first, scroll it into view + flash, and abort the save. The
  // server-side reject still runs for anything we miss here.
  const findFirstInvalidField = () => {
    const el = document.querySelector(
      '.time-field-invalid, .url-badge-invalid'
    );
    if (!el) return null;
    // For UrlBadge the input sits before the badge — focus the input
    // instead of the badge so the caret lands where the user types.
    const target = el.classList.contains('url-badge-invalid')
      ? (el.previousElementSibling || el)
      : el;
    return target;
  };

  const flashInvalid = (el) => {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    } catch { /* ignore */ }
    el.classList.add('field-flash');
    setTimeout(() => el.classList.remove('field-flash'), 1200);
  };

  const handleSave = async () => {
    if (!cfg || !canSave) return;
    const bad = findFirstInvalidField();
    if (bad) {
      flashInvalid(bad);
      showToast('Fix the highlighted field first');
      return;
    }
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

  // Clear is destructive (wipes the whole layout) and sits next to
  // benign buttons — instead of a blocking confirm, clear immediately
  // and offer UNDO on the toast (direct manipulation + undo).
  const clearLayout = (screenId) => {
    const snapshot = cfg;
    const count = (screens.find(s => s.id === screenId)?.layout || []).length;
    if (!count) return;
    updateScreenLayout(screenId, []);
    showToast(`Cleared ${count} widget${count > 1 ? 's' : ''}`, {
      label: 'UNDO',
      onClick: () => {
        setCfg(snapshot);
        markDirty();
        setToast(null);
      }
    });
  };

  // Auto-save: 2s after the last edit if config is valid.
  useEffect(() => {
    if (status !== 'dirty' || !canSave) return;
    const t = setTimeout(() => { handleSave(); }, 2000);
    return () => clearTimeout(t);
  }, [status, canSave, cfg]);

  // Keyboard shortcuts (single listener — a duplicate effect used to
  // register a second handler, making ]/[ jump two screens and cmd+z
  // undo twice):
  //   cmd+s        — save now
  //   cmd+z        — undo last change
  //   1..9         — jump to screen N
  //   [ / ]        — prev / next screen
  //   g            — toggle canvas grid overlay
  //   ?            — keyboard shortcuts help
  //   shift+a      — open the Add Screen preset picker
  useEffect(() => {
    function onKey(e) {
      const t = e.target;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canSave && status === 'dirty') handleSave();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // cmd+shift+z or cmd+y — redo
      if (mod && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (inField || mod) return;
      // ? — open shortcuts help
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true); return; }
      // g — toggle canvas grid overlay
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        setShowGrid(g => !g);
        return;
      }
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
  }, [canSave, cfg, undoStack, redoStack, status, screens, editScreenId]);

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
    <MotionConfig reducedMotion="user">
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
          {cfg && (
            <SettingsMenu
              cfg={cfg}
              onSetup={() => setShowWizard(true)}
              onShortcuts={() => setShortcutsOpen(true)}
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
        onReorder={(fromId, toId) => {
          const arr = screens.slice();
          const fromIdx = arr.findIndex(s => s.id === fromId);
          const toIdx   = arr.findIndex(s => s.id === toId);
          if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
          const [moved] = arr.splice(fromIdx, 1);
          arr.splice(toIdx, 0, moved);
          mutateCfg(prev => ({ ...prev, screens: arr }));
        }}
        canAdd={screens.length < MAX_SCREENS}
      />

      <div className="schedule-collapsible">
        <button
          type="button"
          className="schedule-collapsible-trigger"
          onClick={() => setTimelineOpen(o => !o)}
          aria-expanded={timelineOpen}
        >
          <span className="schedule-collapsible-caret">{timelineOpen ? '▾' : '▸'}</span>
          <span>Schedule timeline</span>
          <span className="schedule-collapsible-summary">
            {/* "none" instead of 0 — JetBrains Mono's dotted zero reads
                as an 8 at this size. */}
            {screens.filter(s => s.schedule?.enabled).length || 'none'} of {screens.length} scheduled
          </span>
        </button>
        {timelineOpen && (
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
        )}
        {timelineOpen && (
          <QuietHours
            value={cfg.quietHours}
            onChange={(next) => mutateCfg(prev => ({ ...prev, quietHours: next }))}
          />
        )}
      </div>

      {readOnly && (
        <div className="readonly-banner" role="alert">
          <Lock size={14} weight="bold" />
          <span>Read-only — not authorized to edit. Open the editor with <code>?token=…</code> or sign in, then reload.</span>
        </div>
      )}

      <main className={`layout edit-mode ${previewPaneOpen ? 'preview-on' : 'preview-off'}`}>
        <aside className="settings-sidebar">
          {editScreen && (
            <ScreenPanel
              screen={editScreen}
              isOverlap={overlapIds.has(editScreen.id)}
              onUpdate={(patch) => updateScreen(editScreen.id, patch)}
              onOpenTimeline={() => setTimelineOpen(true)}
            />
          )}
        </aside>
        <div className="canvas-column">
          <section className="card">
            <div className="section-title">
              <span>{editScreen?.name || 'Screen'}</span>
              <div className="btn-row" style={{ marginTop: 0, gap: 6 }}>
                <span className="badge">{GRID_COLS}×{GRID_ROWS}</span>
                {editScreen && !editScreen.isDefault && (
                  <button
                    className="btn btn-ghost btn-iconed btn-compact"
                    title="Show this screen when no schedule matches"
                    onClick={() => setDefaultScreen(editScreen.id)}
                  >
                    <Star size={12} weight="bold" /> MAKE DEFAULT
                  </button>
                )}
                {editScreen && (
                  <button
                    className={`btn btn-iconed btn-compact ${editCardStyle === 'cards' ? '' : 'btn-ghost'}`}
                    title="Prototype: float each widget as a bordered card with gaps (vs abutting grid)"
                    onClick={() => updateScreen(editScreen.id, { cardStyle: editCardStyle === 'cards' ? 'grid' : 'cards' })}
                  >
                    <Cards size={12} weight="bold" /> {editCardStyle === 'cards' ? 'CARDS ON' : 'CARDS'}
                  </button>
                )}
                <button className="btn btn-ghost btn-iconed btn-compact"
                  title="Remove every widget from this screen (undoable)"
                  onClick={() => clearLayout(editScreen.id)}>
                  <ArrowCounterClockwise size={12} weight="bold" /> CLEAR
                </button>
                {editScreen && screens.length > 1 && (
                  <button className="btn btn-danger btn-iconed btn-compact"
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
              readOnly={readOnly}
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
              drag to move · corner to resize · × or drag to trash · drag pool card onto canvas
            </div>
          </section>
        </div>
        {previewPaneOpen && (
          <PreviewPane
            data={livePreviewData}
            label={`${editScreen?.name || 'Screen'} · ${GRID_COLS}×${GRID_ROWS}`}
            onHide={() => setPreviewPaneOpen(false)}
            refreshMinutes={editScreen?.refreshMinutes ?? 30}
          />
        )}
        {!previewPaneOpen && (
          <button
            type="button"
            className="preview-pane-show"
            onClick={() => setPreviewPaneOpen(true)}
            title="Show live preview"
          >
            ◧ Show preview
          </button>
        )}
      </main>

      {!readOnly && (
        <SaveBar
          status={canSave ? status : 'error'}
          label={
            canSave
              ? (statusDef.label + (statusMsg && status === 'error' ? ` · ${statusMsg}` : ''))
              : `BLOCKED · ${validationErrors[0]}`
          }
          onSave={handleSave}
          onDiscard={undoStack.length ? undo : null}
          disabled={!canSave}
        />
      )}

      {/* Mobile FAB — only shown by CSS below the breakpoint where
       *  the sidebar collapses out of the layout. */}
      <button
        type="button"
        className="mobile-settings-fab"
        onClick={() => setMobileDrawerOpen(true)}
        aria-label="Open screen settings"
      >
        <SlidersHorizontal size={22} weight="bold" />
      </button>

      {/* Mobile bottom-sheet drawer. Hand-rolled (no Radix Dialog dep);
       *  overlay + bottom-sliding sheet animated via framer. */}
      <AnimatePresence>
        {mobileDrawerOpen && (
          <motion.div
            className="mobile-drawer-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileDrawerOpen(false)}
          >
            <motion.div
              className="mobile-drawer"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mobile-drawer-handle" aria-hidden="true" />
              <div className="mobile-drawer-head">
                <span>Screen settings</span>
                <button
                  type="button"
                  className="wsm-close"
                  onClick={() => setMobileDrawerOpen(false)}
                  aria-label="Close"
                >×</button>
              </div>
              <div className="mobile-drawer-body">
                {editScreen && (
                  <ScreenPanel
                    screen={editScreen}
                    isOverlap={overlapIds.has(editScreen.id)}
                    onUpdate={(patch) => updateScreen(editScreen.id, patch)}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.msg}
            className={`toast ${toast.action ? 'toast-actionable' : ''}`}
            initial={{ y: 24, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <span>{toast.msg}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={toast.action.onClick}
              >
                {toast.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Setup wizard: auto-shows on first run (no location set), or on
       *  demand via the header "Setup" button. */}
      {((cfg.firstRun !== false && !cfg.lat) || showWizard) && (
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
          onClose={() => setShowWizard(false)}
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
    </MotionConfig>
  );
}
