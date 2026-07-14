import React, { useRef, useEffect, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { m, AnimatePresence } from 'framer-motion';
import { Gear, X, Copy } from '@phosphor-icons/react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { WIDGET_REGISTRY, POOL_CATEGORIES, GRID_COLS, GRID_ROWS, widgetById, makeInstance, newInstanceId } from '../widgets.js';
import { renderWidget, typographyCss, scaleWrap, buildTileCtx, tileCellClasses } from '../widget-render.js';
import { demoCtxForWidget } from '../widgets/_pool_demo.js';
import { autofitText } from '../autofit.js';
import WidgetSettingsModal from './WidgetSettingsModal.jsx';

// Editor cells must align 1:1 with dashboard cells so widget previews
// scale cleanly. Any padding/margin would offset cells from the
// dashboard's tight grid and overflow the live previews.
const PAD = 0;
const MARGIN = 0;

// Dashboard chrome heights (must match public/dashboard.css `.page`
// grid-template-rows: 60px 1fr 28px on a 480px-tall canvas).
const DASH_W = 800;
const DASH_H = 480;
const HEADER_H_BASE = 60;
const FOOTER_H_BASE = 28;

// Pick a widget's smallest registered size by area — used for the pool
// preview and for the initial drop size when a widget is added.
function smallestSizeKey(def) {
  return Object.keys(def.sizes).reduce((a, b) => {
    const sa = def.sizes[a]; const sb = def.sizes[b];
    return (sb.w * sb.h) < (sa.w * sa.h) ? b : a;
  }, def.defaultSize);
}

// Showcase size per widget — what HoverCard renders on hover. Picked
// by hand so each widget looks its best instead of always the
// smallest preset. Fallback: the widget's defaultSize.
const SHOWCASE_SIZE_BY_ID = {
  clock:            'S',
  mac_battery:      'S',
  eink_battery:     'S',
  text:             'S',
  calendar:         'M',
  weather_forecast: 'M',
  weather_hero:     'L',
  mac_nowplaying:   'L'
};
function showcaseSizeKey(def) {
  const hint = SHOWCASE_SIZE_BY_ID[def.id];
  if (hint && def.sizes[hint]) return hint;
  return def.defaultSize;
}

export default function EditorGrid({ layout, showGrid, cardStyle, readOnly = false, previewData, seedCtx, onChange, onError, onCommitItemNow }) {
  const cardsMode = cardStyle === 'cards';
  const wrapRef = useRef(null);
  const paletteRef = useRef(null);
  const dupLockRef = useRef(false);
  const [size, setSizeState] = useState({ w: 800, h: 480 });
  const [shake, setShake] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  // Tile selection (click on desktop, tap on touch). The selected tile
  // keeps its action buttons visible; clicking elsewhere clears it.
  const [selectedId, setSelectedId] = useState(null);
  // Which tile (if any) currently has its settings modal open.
  const [modalForId, setModalForId] = useState(null);
  // 5px drag threshold so a single click (mousedown→up < 5px move) is
  // treated as a select, while a real drag is left for react-grid-layout.
  const downPosRef = useRef(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width;
        const h = e.contentRect.height;
        if (w > 0 && h > 0) setSizeState({ w, h });
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // All items in `layout` are on the canvas (no more enabled flag).
  // Filter for the pool — narrows the list of templates by label.
  const [poolFilter, setPoolFilter] = useState('');
  // Pool collapsed by default — saves vertical real estate now that the
  // editor canvas is always visible (no more separate edit mode).
  const [poolOpen, setPoolOpen] = useState(false);

  // Auto-scroll the page while a pool widget is being dragged near the
  // viewport edges. This is what lets the user grab a card and drop it
  // onto the canvas even when the canvas has scrolled out of view.
  useEffect(() => {
    let raf = null;
    let velocity = 0;
    const EDGE = 80;     // px from edge before scroll kicks in
    const MAX_VEL = 24;  // px per frame at the edge
    const tick = () => {
      raf = null;
      if (velocity !== 0) {
        window.scrollBy(0, velocity);
        raf = requestAnimationFrame(tick);
      }
    };
    const onDragOver = (e) => {
      const y = e.clientY;
      const h = window.innerHeight;
      if (y < EDGE)        velocity = -Math.round(((EDGE - y) / EDGE) * MAX_VEL);
      else if (y > h - EDGE) velocity =  Math.round(((y - (h - EDGE)) / EDGE) * MAX_VEL);
      else                 velocity = 0;
      if (velocity !== 0 && raf == null) raf = requestAnimationFrame(tick);
    };
    const onDragEnd = () => { velocity = 0; if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragend', onDragEnd);
    window.addEventListener('drop', onDragEnd);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('drop', onDragEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Run autofit on every .autofit element under the editor wrap after
  // each render. requestAnimationFrame so layout has settled.
  useEffect(() => {
    if (!wrapRef.current) return;
    let cancelled = false;
    let rafId = 0;
    const run = () => {
      rafId = requestAnimationFrame(() => {
        if (cancelled || !wrapRef.current) return;
        wrapRef.current.querySelectorAll('.autofit').forEach(autofitText);
      });
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (!cancelled) run(); });
    } else {
      run();
    }
    return () => { cancelled = true; if (rafId) cancelAnimationFrame(rafId); };
  });

  // The pool is a fixed list of widget templates from the registry —
  // each card creates a NEW instance when added.
  const enabled = layout;
  const palette = poolFilter.trim()
    ? WIDGET_REGISTRY.filter(d => {
        const q = poolFilter.toLowerCase();
        return d.label.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          (d.blurb || '').toLowerCase().includes(q) ||
          (d.category || '').toLowerCase().includes(q);
      })
    : WIDGET_REGISTRY;

  // Editor canvas is sized to the full dashboard aspect. Header + footer
  // chrome was removed in favor of the text widget (bar variant); widgets now own
  // the full 800×480 panel.
  const HEADER_H = 0;
  const FOOTER_H = 0;
  const BODY_H = DASH_H;
  const scale = size.w > 0 ? size.w / DASH_W : 1;
  const bodyHeight = size.h * (BODY_H / DASH_H);
  // Cards mode: give tiles a gap (scaled to the canvas) and shrink rowHeight
  // so the gapped grid still fits the fixed 800×480 aspect box.
  const tileMargin = cardsMode ? Math.max(2, Math.round(4 * scale)) : MARGIN;
  const rowHeight = (bodyHeight - (GRID_ROWS - 1) * tileMargin) / GRID_ROWS;
  const innerW = size.w;

  const rglLayout = enabled.map(l => {
    const def = widgetById(l.widgetId);
    const min = (def && def.minSize) || { w: 1, h: 1 };
    return {
      i: l.id,
      x: l.x, y: l.y, w: l.w, h: l.h,
      minW: min.w, minH: min.h,
      maxW: GRID_COLS, maxH: GRID_ROWS
    };
  });

  const handleLayoutChange = (next) => {
    const changed = next.some(n => {
      const cur = layout.find(l => l.id === n.i);
      if (!cur) return true;
      return cur.x !== n.x || cur.y !== n.y || cur.w !== n.w || cur.h !== n.h;
    });
    if (!changed) return;
    const map = new Map(next.map(n => [n.i, n]));
    const merged = layout.map(l => {
      const n = map.get(l.id);
      if (!n) return l;
      const sizeChanged = (l.w !== n.w || l.h !== n.h);
      return { ...l, x: n.x, y: n.y, w: n.w, h: n.h, size: sizeChanged ? null : l.size };
    });
    onChange(merged);
  };

  // Drag-to-delete via RGL's own drag system: when the user releases
  // a tile over the .trash-zone DOM element, drop the widget instead
  // of committing the new position.
  const trashRef = useRef(null);
  const [trashHover, setTrashHover] = useState(false);
  // Zone is only visible while a tile drag is in flight — it collapses
  // (CSS max-height) when idle so it doesn't eat vertical space.
  const [tileDragging, setTileDragging] = useState(false);
  const [snapGuides, setSnapGuides] = useState({ xCols: [], yRows: [] });

  // Compare the in-flight tile's four edges (in grid cells) against every
  // other tile's edges. Edges that match exactly become snap guides — a
  // visual hint that the user has nailed alignment. Only emits if the
  // dragged tile actually overlaps the same row/column band as the
  // anchor, so we don't flag distant coincidences.
  const computeSnapGuides = (item, others) => {
    const xCols = new Set();
    const yRows = new Set();
    const left = item.x, right = item.x + item.w;
    const top = item.y, bottom = item.y + item.h;
    for (const o of others) {
      if (o.i === item.i) continue;
      const oL = o.x, oR = o.x + o.w, oT = o.y, oB = o.y + o.h;
      const overlapY = !(bottom <= oT || top >= oB);
      const overlapX = !(right <= oL || left >= oR);
      if (overlapY) {
        if (left === oL || left === oR) xCols.add(left);
        if (right === oL || right === oR) xCols.add(right);
      }
      if (overlapX) {
        if (top === oT || top === oB) yRows.add(top);
        if (bottom === oT || bottom === oB) yRows.add(bottom);
      }
    }
    return { xCols: [...xCols], yRows: [...yRows] };
  };

  const pointerOverTrash = (event) => {
    if (!trashRef.current || !event) return false;
    const r = trashRef.current.getBoundingClientRect();
    const x = event.clientX ?? (event.touches && event.touches[0]?.clientX);
    const y = event.clientY ?? (event.touches && event.touches[0]?.clientY)
            ?? (event.changedTouches && event.changedTouches[0]?.clientY);
    if (x == null || y == null) return false;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const onTileDrag = (rglItems, _oldItem, newItem, _placeholder, event) => {
    setTrashHover(pointerOverTrash(event));
    setSnapGuides(computeSnapGuides(newItem, rglItems));
  };

  const onTileDragStart = () => setTileDragging(true);

  const onTileDragStop = (_, __, newItem, ___, event) => {
    if (pointerOverTrash(event)) {
      removeFromCanvas(newItem.i);
    }
    setTileDragging(false);
    setTrashHover(false);
    setSnapGuides({ xCols: [], yRows: [] });
  };
  const onTileResize = (rglItems, _oldItem, newItem) => {
    setSnapGuides(computeSnapGuides(newItem, rglItems));
  };
  const onTileResizeStop = () => {
    setSnapGuides({ xCols: [], yRows: [] });
  };

  const clampPos = (x, y, w, h) => ({
    x: Math.max(0, Math.min(x, GRID_COLS - w)),
    y: Math.max(0, Math.min(y, GRID_ROWS - h))
  });

  // Find free slot at given size, scanning top-left to bottom-right.
  const findFreeSlot = (w, h, items) => {
    const fits = (x, y) => {
      if (x + w > GRID_COLS || y + h > GRID_ROWS) return false;
      return !items.some(it =>
        x < it.x + it.w && x + w > it.x &&
        y < it.y + it.h && y + h > it.y
      );
    };
    for (let y = 0; y + h <= GRID_ROWS; y++) {
      for (let x = 0; x + w <= GRID_COLS; x++) {
        if (fits(x, y)) return { x, y };
      }
    }
    return null;
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  // Add a NEW instance of the given widget type. Multiple instances of
  // the same widget can coexist on the canvas.
  const addToCanvas = (widgetId) => {
    const def = widgetById(widgetId);
    if (!def) return;
    const candidates = Object.entries(def.sizes)
      .map(([key, sz]) => ({ key, w: sz.w, h: sz.h }))
      .sort((a, b) => (a.w * a.h) - (b.w * b.h));
    candidates.push({ key: null, w: 1, h: 1 });

    for (const c of candidates) {
      const slot = findFreeSlot(c.w, c.h, enabled);
      if (slot) {
        const inst = makeInstance(widgetId, { x: slot.x, y: slot.y, w: c.w, h: c.h, sizeKey: c.key }, seedCtx);
        if (inst) {
          onChange([...layout, inst]);
          // Select the new tile so it's visibly highlighted, and bring
          // the canvas back into view — click-to-add from the pool
          // otherwise drops the widget somewhere off-screen above.
          setSelectedId(inst.id);
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          wrapRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
        }
        return;
      }
    }
    triggerShake();
    onError && onError(`No room for ${def.label} on canvas`);
  };

  // Remove a specific instance by its instance id.
  const removeFromCanvas = (id) => {
    onChange(layout.filter(l => l.id !== id));
  };

  // Clone a configured tile (settings + size) into a FREE slot so users
  // don't re-configure from scratch. If the canvas is full there's nowhere
  // safe to put it — shake + bail rather than stack the clone on top of the
  // original (which corrupts the layout with overlapping tiles).
  const duplicateTile = (id) => {
    // A fast double-click fires this twice within one render, so both calls
    // see the same layout + pick the same free slot → overlapping clones.
    // Lock briefly so an accidental double-click only duplicates once.
    if (dupLockRef.current) return;
    const item = enabled.find(l => l.id === id);
    if (!item) return;
    const slot = findFreeSlot(item.w, item.h, enabled);
    if (!slot) {
      triggerShake();
      onError && onError('No room to duplicate — free up space first');
      return;
    }
    const clone = {
      ...item,
      id: newInstanceId(item.widgetId),
      x: slot.x, y: slot.y,
      settings: item.settings ? { ...item.settings } : undefined
    };
    onChange([...layout, clone]);
    setSelectedId(clone.id);
    dupLockRef.current = true;
    setTimeout(() => { dupLockRef.current = false; }, 350);
  };

  // Keyboard control of the selected tile: arrows nudge one cell,
  // Shift+arrows resize, Delete/Backspace removes, Cmd/Ctrl+D
  // duplicates. Collisions block with the same shake as drag-drop —
  // nudging must not silently stack tiles.
  useEffect(() => {
    if (readOnly || !selectedId || modalForId) return;
    const collides = (cand) => enabled.some(it =>
      it.id !== cand.id &&
      cand.x < it.x + it.w && cand.x + cand.w > it.x &&
      cand.y < it.y + it.h && cand.y + cand.h > it.y
    );
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const item = enabled.find(l => l.id === selectedId);
      if (!item) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateTile(selectedId);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeFromCanvas(selectedId);
        setSelectedId(null);
        return;
      }
      if (e.key === 'Escape') { setSelectedId(null); return; }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir || mod) return;
      e.preventDefault();
      const def = widgetById(item.widgetId);
      const minW = (def && def.minSize && def.minSize.w) || 2;
      const minH = (def && def.minSize && def.minSize.h) || 1;
      let cand;
      if (e.shiftKey) {
        cand = { ...item,
          w: Math.max(minW, Math.min(GRID_COLS - item.x, item.w + dir[0])),
          h: Math.max(minH, Math.min(GRID_ROWS - item.y, item.h + dir[1]))
        };
      } else {
        cand = { ...item, ...clampPos(item.x + dir[0], item.y + dir[1], item.w, item.h) };
      }
      if (cand.x === item.x && cand.y === item.y && cand.w === item.w && cand.h === item.h) return;
      if (collides(cand)) { triggerShake(); return; }
      onChange(layout.map(l => l.id === item.id ? cand : l));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // HTML5 drag from pool tile onto canvas.
  const onPoolDragStart = (e, id) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/x-widget-id', id);
  };

  const onCanvasDragOver = (e) => {
    if (e.dataTransfer.types.includes('text/x-widget-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropHover(true);
    }
  };

  const onCanvasDragLeave = () => setDropHover(false);

  const onCanvasDrop = (e) => {
    e.preventDefault();
    setDropHover(false);
    const id = e.dataTransfer.getData('text/x-widget-id');
    if (id) addToCanvas(id);
  };


  return (
    <div>
      <m.div
        ref={wrapRef}
        className={`editor-wrap ${showGrid ? 'show-grid' : ''} ${dropHover ? 'drop-target' : ''} ${cardsMode ? 'cards' : ''}`}
        animate={shake ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.45 }}
        onDragOver={onCanvasDragOver}
        onDragLeave={onCanvasDragLeave}
        onDrop={onCanvasDrop}
        onMouseDown={(e) => {
          // Clicking the empty canvas (not on a tile) clears selection.
          if (e.target === e.currentTarget) setSelectedId(null);
        }}
        onTouchStart={(e) => {
          if (e.target === e.currentTarget) setSelectedId(null);
        }}
      >
        <div
          className="editor-grid-inset"
          style={{
            position: 'absolute',
            left: 0, right: 0,
            top: `${(HEADER_H / DASH_H) * 100}%`,
            bottom: `${(FOOTER_H / DASH_H) * 100}%`
          }}
        >
        <GridLayout
          className="layout"
          cols={GRID_COLS}
          rowHeight={rowHeight}
          width={innerW}
          maxRows={GRID_ROWS}
          compactType={null}
          preventCollision
          isDraggable={!readOnly}
          isResizable={!readOnly}
          resizeHandles={['se', 'sw', 'nw']}
          margin={[tileMargin, tileMargin]}
          containerPadding={[PAD, PAD]}
          layout={rglLayout}
          onLayoutChange={handleLayoutChange}
          onDragStart={onTileDragStart}
          onDrag={onTileDrag}
          onDragStop={onTileDragStop}
          onResize={onTileResize}
          onResizeStop={onTileResizeStop}
        >
          {enabled.map(l => {
            const innerRaw = renderWidget(l.widgetId, buildTileCtx(l, previewData, widgetById(l.widgetId))) || '';
            const swl = scaleWrap(l.settings);
            const inner = `${swl.open}${innerRaw}${swl.close}`;
            // Per-tile typography (font family + padding) lives on the
            // cell wrapper so the global .cell[style*="--w-font"]
            // override rule can reach every child of every widget.
            const typoStyle = typographyCss(l.settings);
            const dashW = l.w * (DASH_W / GRID_COLS);
            const dashH = l.h * (BODY_H / GRID_ROWS);
            const classes = tileCellClasses(l, GRID_COLS, GRID_ROWS);
            const cellHtml = `<div class="${classes.join(' ')}" style="width:${dashW}px;height:${dashH}px;${typoStyle}">${inner}</div>`;
            const isSelected = selectedId === l.id;
            return (
              <div key={l.id}>
                <m.div
                  className={`editor-tile live-tile ${isSelected ? 'selected' : ''}`}
                  style={{ width: '100%', height: '100%' }}
                  onMouseDown={(e) => {
                    // Track pointer-down position so we can distinguish a
                    // click-to-select from a real drag started by RGL.
                    downPosRef.current = { x: e.clientX, y: e.clientY, id: l.id };
                  }}
                  onMouseUp={(e) => {
                    const d = downPosRef.current;
                    downPosRef.current = null;
                    if (!d || d.id !== l.id) return;
                    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
                    if (moved < 5) setSelectedId(l.id);
                  }}
                  onTouchEnd={() => setSelectedId(l.id)}
                >
                  <div className="tile-actions">
                    <button
                      className="tile-settings"
                      title="Settings"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setModalForId(l.id); }}
                    ><Gear size={14} weight="bold" /></button>
                    <button
                      className="tile-settings"
                      title="Duplicate"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); duplicateTile(l.id); }}
                    ><Copy size={14} weight="bold" /></button>
                    <button
                      className="tile-remove"
                      title="Remove"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); removeFromCanvas(l.id); }}
                    ><X size={14} weight="bold" /></button>
                  </div>
                  <div className="live-tile-body">
                    <div
                      className="live-tile-scale"
                      style={{
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left'
                      }}
                      dangerouslySetInnerHTML={{ __html: cellHtml }}
                    />
                  </div>
                </m.div>
              </div>
            );
          })}
        </GridLayout>
        {(snapGuides.xCols.length || snapGuides.yRows.length) ? (
          <div className="snap-guides">
            {snapGuides.xCols.map(col => (
              <div key={`x${col}`}
                className="snap-line snap-line-x"
                style={{ left: `${(col / GRID_COLS) * 100}%` }} />
            ))}
            {snapGuides.yRows.map(row => (
              <div key={`y${row}`}
                className="snap-line snap-line-y"
                style={{ top: `${(row / GRID_ROWS) * 100}%` }} />
            ))}
          </div>
        ) : null}
        </div>

        {enabled.length === 0 && (
          <div className="editor-empty">
            <div className="editor-empty-title">This screen is empty</div>
            <div className="editor-empty-sub">Add widgets to build your dashboard — drag them onto the grid or click to drop.</div>
            <button
              type="button"
              className="btn btn-primary editor-empty-cta"
              onClick={() => {
                setPoolOpen(true);
                // Wait a frame so the pool exists before scrolling to it.
                requestAnimationFrame(() => {
                  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                  paletteRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
                });
              }}
            >
              + ADD YOUR FIRST WIDGET
            </button>
          </div>
        )}

      </m.div>

      <div
        ref={trashRef}
        className={`trash-zone ${tileDragging ? 'active' : ''} ${trashHover ? 'hover' : ''}`}
      >
        <span>&gt; DRAG TILE HERE TO REMOVE</span>
      </div>

      <div ref={paletteRef} className={`palette ${poolOpen ? 'open' : 'collapsed'}`}>
        <button
          className="palette-toggle"
          onClick={() => setPoolOpen(o => !o)}
        >
          <span>{poolOpen ? '▾' : '▸'} {poolOpen ? 'HIDE WIDGET POOL' : '+ ADD WIDGET'}</span>
          <span className="badge">{WIDGET_REGISTRY.length}</span>
        </button>
        {poolOpen && (
          <div className="palette-title">
            <input
              type="text"
              className="palette-search"
              value={poolFilter}
              onChange={e => setPoolFilter(e.target.value)}
              placeholder="Search widgets…"
              autoFocus
            />
            <span className="badge">{palette.length}</span>
          </div>
        )}
        {poolOpen && palette.length === 0 && (
          <div className="terminal-line" style={{ padding: 12 }}>
            &gt; NO WIDGETS MATCH "{poolFilter}"
          </div>
        )}
        {poolOpen && POOL_CATEGORIES
          .filter(cat => palette.some(d => d.category === cat))
          .map(cat => (
        <div className="palette-section" key={cat}>
          <div className="palette-section-head">{cat}</div>
          <div className="palette-grid">
          {palette.filter(d => d.category === cat).map(def => {
            const sizeKey = smallestSizeKey(def);
            const { w, h } = def.sizes[sizeKey];
            // Pool tiles render with frozen demo data so a brand-new
            // user doesn't see "SETUP NEEDED" placeholders before
            // they've configured anything. Each render gets its own
            // cellW/cellH so size-conditional logic (forecast day
            // count, weather hourly strip, calendar sections) shows
            // the appropriate fidelity for the size being previewed.
            const thumbCtx = demoCtxForWidget(def.id, w, h);
            const inner = renderWidget(def.id, thumbCtx) || '';
            const dashW = w * (DASH_W / GRID_COLS);
            const dashH = h * (BODY_H / GRID_ROWS);
            const html = `<div class="cell cell-${def.id}" style="width:${dashW}px;height:${dashH}px">${inner}</div>`;
            const cardScale = Math.min(180 / dashW, 140 / dashH, 0.5);
            const count = enabled.filter(l => l.widgetId === def.id).length;

            // Showcase preview — bigger render shown on hover via Radix
            // HoverCard. Scaled to fit a 480x280 popover so even L
            // widgets don't take over the page. Renders the same
            // widget-render output the canvas uses so it matches what
            // the user gets on drop.
            const showcaseKey = showcaseSizeKey(def);
            const { w: sw, h: sh } = def.sizes[showcaseKey];
            const showcaseW = sw * (DASH_W / GRID_COLS);
            const showcaseH = sh * (BODY_H / GRID_ROWS);
            const showcaseScale = Math.min(
              480 / showcaseW,
              280 / showcaseH,
              0.9
            );
            const showcaseCtx  = demoCtxForWidget(def.id, sw, sh);
            const showcaseInner = renderWidget(def.id, showcaseCtx) || '';
            const showcaseHtml = `<div class="cell cell-${def.id}" style="width:${showcaseW}px;height:${showcaseH}px">${showcaseInner}</div>`;

            return (
              <HoverCard.Root key={def.id} openDelay={250} closeDelay={100}>
                <HoverCard.Trigger asChild>
                  <m.div
                    layout
                    className="palette-card"
                    draggable
                    onDragStart={(e) => onPoolDragStart(e, def.id)}
                    onClick={() => addToCanvas(def.id)}
                    title={`${def.label} — drag onto canvas or click to add`}
                  >
                    <div
                      className="palette-card-preview"
                      style={{ width: dashW * cardScale, height: dashH * cardScale }}
                    >
                      <div
                        className="palette-card-scale"
                        style={{
                          width: dashW,
                          height: dashH,
                          transform: `scale(${cardScale})`,
                          transformOrigin: 'top left'
                        }}
                        dangerouslySetInnerHTML={{ __html: html }}
                      />
                    </div>
                    <div className="palette-card-label">
                      {def.label}{count > 0 ? ` · ${count} ON` : ''}
                    </div>
                    {def.blurb && <div className="palette-card-blurb">{def.blurb}</div>}
                  </m.div>
                </HoverCard.Trigger>
                <HoverCard.Portal>
                  <HoverCard.Content
                    className="palette-hover-card"
                    side="right"
                    sideOffset={12}
                    collisionPadding={16}
                  >
                    <div className="palette-hover-label">
                      {def.category ? `${def.category} · ` : ''}{def.label} · {showcaseKey} · {sw}×{sh}
                    </div>
                    {def.blurb && <div className="palette-hover-blurb">{def.blurb}</div>}
                    <div
                      className="palette-hover-preview"
                      style={{
                        width:  showcaseW * showcaseScale,
                        height: showcaseH * showcaseScale
                      }}
                    >
                      <div
                        className="palette-card-scale"
                        style={{
                          width: showcaseW,
                          height: showcaseH,
                          transform: `scale(${showcaseScale})`,
                          transformOrigin: 'top left'
                        }}
                        dangerouslySetInnerHTML={{ __html: showcaseHtml }}
                      />
                    </div>
                    <HoverCard.Arrow className="palette-hover-arrow" />
                  </HoverCard.Content>
                </HoverCard.Portal>
              </HoverCard.Root>
            );
          })}
          </div>
        </div>
        ))}
      </div>

      <WidgetSettingsModal
        open={!!modalForId}
        item={modalForId ? layout.find(it => it.id === modalForId) : null}
        layout={layout}
        cfg={previewData && previewData.cfg}
        previewData={previewData}
        onCancel={() => setModalForId(null)}
        onSave={(updated) => {
          const patch = {
            flush: updated.flush,
            density: updated.density,
            settings: updated.settings
          };
          if (onCommitItemNow) {
            // Persist immediately + refresh preview so the editor shows
            // updated data without a second click on the main save bar.
            onCommitItemNow({ id: updated.id, ...patch });
          } else {
            onChange(layout.map(it => it.id === updated.id
              ? { ...it, ...patch }
              : it
            ));
          }
          setModalForId(null);
        }}
      />
    </div>
  );
}
