import React, { useRef, useEffect, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { motion, AnimatePresence } from 'framer-motion';
import { Gear, X } from '@phosphor-icons/react';
import { WIDGET_REGISTRY, GRID_COLS, GRID_ROWS, widgetById, makeInstance } from '../widgets.js';
import { renderWidget, renderHeader, renderFooter, isHeaderOn, isFooterOn, headerVariant, footerVariant, typographyCss, cellClasses } from '../widget-render.js';
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

export default function EditorGrid({ layout, showGrid, previewData, seedCtx, onChange, onError, onCommitItemNow }) {
  const wrapRef = useRef(null);
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

  // autofit runner — matches the helper in dashboard.html. Binary-search
  // the largest font size that fits inside each .autofit element's box.
  function autofitText(el) {
    if (!el) return;
    const maxW = el.clientWidth;
    const maxH = el.clientHeight;
    if (maxW <= 0 || maxH <= 0) return;
    const minFont = Math.max(8, parseInt(el.getAttribute('data-min-font') || '11', 10));
    const maxFont = Math.max(minFont, parseInt(el.getAttribute('data-max-font') || '260', 10));
    let lo = minFont, hi = maxFont;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      el.style.fontSize = mid + 'px';
      if (el.scrollWidth <= maxW + 1 && el.scrollHeight <= maxH + 1) lo = mid;
      else hi = mid - 1;
    }
    el.style.fontSize = lo + 'px';
  }

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
    ? WIDGET_REGISTRY.filter(d =>
        d.label.toLowerCase().includes(poolFilter.toLowerCase()) ||
        d.id.toLowerCase().includes(poolFilter.toLowerCase()))
    : WIDGET_REGISTRY;

  // Editor canvas is sized to the full dashboard aspect; the body
  // section we hand to RGL is BODY_H/DASH_H of that height. Row
  // height inside the body matches the dashboard's body row height.
  // Chrome rows collapse when disabled, which gives the body more room.
  const headerOn = isHeaderOn(previewData);
  const footerOn = isFooterOn(previewData);
  const HEADER_H = headerOn ? HEADER_H_BASE : 0;
  const FOOTER_H = footerOn ? FOOTER_H_BASE : 0;
  const BODY_H = DASH_H - HEADER_H - FOOTER_H;
  const scale = size.w > 0 ? size.w / DASH_W : 1;
  const bodyHeight = size.h * (BODY_H / DASH_H);
  const rowHeight = bodyHeight / GRID_ROWS;
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

  const onTileDragStop = (_, __, newItem, ___, event) => {
    if (pointerOverTrash(event)) {
      removeFromCanvas(newItem.i);
    }
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
        if (inst) onChange([...layout, inst]);
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
      <motion.div
        ref={wrapRef}
        className={`editor-wrap ${showGrid ? 'show-grid' : ''} ${dropHover ? 'drop-target' : ''}`}
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
        {/* Header chrome — purely visual; matches dashboard.css `.hdr`. */}
        {headerOn && (
          <div
            className={`editor-chrome hdr hdr-${headerVariant(previewData)}`}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: DASH_W, height: HEADER_H,
              transform: `scale(${scale})`, transformOrigin: 'top left',
              pointerEvents: 'none'
            }}
            dangerouslySetInnerHTML={{ __html: renderHeader(previewData) }}
          />
        )}
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
          isResizable
          resizeHandles={['se', 'sw', 'nw']}
          margin={[MARGIN, MARGIN]}
          containerPadding={[PAD, PAD]}
          layout={rglLayout}
          onLayoutChange={handleLayoutChange}
          onDrag={onTileDrag}
          onDragStop={onTileDragStop}
          onResize={onTileResize}
          onResizeStop={onTileResizeStop}
        >
          {enabled.map(l => {
            const itemSlot = (previewData && previewData.perItem && previewData.perItem[l.id]) || {};
            const inner = renderWidget(l.widgetId, { ...previewData, ...itemSlot, cellW: l.w, cellH: l.h, density: l.density, settings: l.settings }) || '';
            // Per-tile typography (font family + padding) lives on the
            // cell wrapper so the global .cell[style*="--w-font"]
            // override rule can reach every child of every widget.
            const typoStyle = typographyCss(l.settings);
            const dashW = l.w * (DASH_W / GRID_COLS);
            const dashH = l.h * (BODY_H / GRID_ROWS);
            const classes = ['cell', `cell-${l.widgetId}`];
            if (l.x + l.w >= GRID_COLS) classes.push('cell-edge-right');
            if (l.y + l.h >= GRID_ROWS) classes.push('cell-edge-bottom');
            if (l.flush) classes.push('cell-flush');
            classes.push(...cellClasses(l.settings));
            const cellHtml = `<div class="${classes.join(' ')}" style="width:${dashW}px;height:${dashH}px;${typoStyle}">${inner}</div>`;
            const isSelected = selectedId === l.id;
            return (
              <div key={l.id}>
                <motion.div
                  layout
                  className={`editor-tile live-tile ${isSelected ? 'selected' : ''}`}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
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
                </motion.div>
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
          <div className="editor-empty terminal-line">
            &gt; CANVAS_EMPTY — DRAG A WIDGET FROM POOL BELOW
          </div>
        )}

        {/* Footer chrome */}
        {footerOn && (
          <div
            className={`editor-chrome ftr ftr-${footerVariant(previewData)}`}
            style={{
              position: 'absolute', bottom: 0, left: 0,
              width: DASH_W, height: FOOTER_H,
              transform: `scale(${scale})`, transformOrigin: 'bottom left',
              pointerEvents: 'none'
            }}
            dangerouslySetInnerHTML={{ __html: renderFooter(previewData) }}
          />
        )}
      </motion.div>

      <div
        ref={trashRef}
        className={`trash-zone ${trashHover ? 'hover' : ''}`}
      >
        <span>&gt; DRAG TILE HERE TO REMOVE</span>
      </div>

      <div className={`palette ${poolOpen ? 'open' : 'collapsed'}`}>
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
        {poolOpen && (
        <div className="palette-grid">
          {palette.map(def => {
            const sizeKey = smallestSizeKey(def);
            const { w, h } = def.sizes[sizeKey];
            const inner = renderWidget(def.id, previewData) || '';
            const dashW = w * (DASH_W / GRID_COLS);
            const dashH = h * (BODY_H / GRID_ROWS);
            const html = `<div class="cell cell-${def.id}" style="width:${dashW}px;height:${dashH}px">${inner}</div>`;
            const cardScale = Math.min(180 / dashW, 140 / dashH, 0.5);
            const count = enabled.filter(l => l.widgetId === def.id).length;
            return (
              <motion.div
                key={def.id}
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
              </motion.div>
            );
          })}
        </div>
        )}
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
