import React, { useRef, useEffect, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { motion, AnimatePresence } from 'framer-motion';
import { WIDGET_REGISTRY, GRID_COLS, GRID_ROWS, widgetById, makeInstance } from '../widgets.js';
import { renderWidget, renderHeader, renderFooter, isHeaderOn, isFooterOn } from '../widget-render.js';

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

export default function EditorGrid({ layout, showGrid, previewData, onChange, onError, onJumpToSettings }) {
  const wrapRef = useRef(null);
  const [size, setSizeState] = useState({ w: 800, h: 480 });
  const [shake, setShake] = useState(false);
  const [dropHover, setDropHover] = useState(false);

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

  const rglLayout = enabled.map(l => ({
    i: l.id,
    x: l.x, y: l.y, w: l.w, h: l.h,
    minW: 1, minH: 1, maxW: GRID_COLS, maxH: GRID_ROWS
  }));

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

  const pointerOverTrash = (event) => {
    if (!trashRef.current || !event) return false;
    const r = trashRef.current.getBoundingClientRect();
    const x = event.clientX ?? (event.touches && event.touches[0]?.clientX);
    const y = event.clientY ?? (event.touches && event.touches[0]?.clientY)
            ?? (event.changedTouches && event.changedTouches[0]?.clientY);
    if (x == null || y == null) return false;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const onTileDrag = (_, __, ___, ____, event) => {
    setTrashHover(pointerOverTrash(event));
  };

  const onTileDragStop = (_, __, newItem, ___, event) => {
    if (pointerOverTrash(event)) {
      removeFromCanvas(newItem.i);
    }
    setTrashHover(false);
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
        const inst = makeInstance(widgetId, { x: slot.x, y: slot.y, w: c.w, h: c.h, sizeKey: c.key });
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
      >
        {/* Header chrome — purely visual; matches dashboard.css `.hdr`. */}
        {headerOn && (
          <div
            className="editor-chrome hdr"
            style={{
              position: 'absolute', top: 0, left: 0,
              width: DASH_W, height: HEADER_H,
              transform: `scale(${scale})`, transformOrigin: 'top left',
              pointerEvents: 'none'
            }}
            dangerouslySetInnerHTML={{ __html: renderHeader(previewData) }}
          />
        )}
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
        >
          {enabled.map(l => {
            const inner = renderWidget(l.widgetId, { ...previewData, cellW: l.w, cellH: l.h }) || '';
            const dashW = l.w * (DASH_W / GRID_COLS);
            const dashH = l.h * (BODY_H / GRID_ROWS);
            const classes = ['cell', `cell-${l.widgetId}`];
            if (l.x + l.w >= GRID_COLS) classes.push('cell-edge-right');
            if (l.y + l.h >= GRID_ROWS) classes.push('cell-edge-bottom');
            if (l.flush) classes.push('cell-flush');
            const cellHtml = `<div class="${classes.join(' ')}" style="width:${dashW}px;height:${dashH}px">${inner}</div>`;
            return (
              <div key={l.id}>
                <motion.div
                  layout
                  className="editor-tile live-tile"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  style={{ width: '100%', height: '100%' }}
                >
                  <div className="tile-actions">
                    <button
                      className={`tile-flush ${l.flush ? 'on' : ''}`}
                      title={l.flush ? 'Flush edges ON — click for inset' : 'Inset (with border) — click for flush edges'}
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange(layout.map(it => it.id === l.id ? { ...it, flush: !it.flush } : it));
                      }}
                    >⊞</button>
                    {onJumpToSettings && (
                      <button
                        className="tile-settings"
                        title="Jump to widget settings"
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); onJumpToSettings(l.widgetId); }}
                      >⚙</button>
                    )}
                    <button
                      className="tile-border"
                      title={`Border: ${l.border || 'solid'} — click to cycle`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        const order = ['solid', 'dashed', 'none'];
                        const cur = l.border || 'solid';
                        const next = order[(order.indexOf(cur) + 1) % order.length];
                        onChange(layout.map(it => it.id === l.id ? { ...it, border: next } : it));
                      }}
                    >▢</button>
                    <button
                      className="tile-remove"
                      title="Remove"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); removeFromCanvas(l.id); }}
                    >×</button>
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

        {enabled.length === 0 && (
          <div className="editor-empty terminal-line">
            &gt; CANVAS_EMPTY — DRAG A WIDGET FROM POOL BELOW
          </div>
        )}

        {/* Footer chrome */}
        {footerOn && (
          <div
            className="editor-chrome ftr"
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

      <div className="palette">
        <div className="palette-title">
          <span>Widget Pool</span>
          <input
            type="text"
            className="palette-search"
            value={poolFilter}
            onChange={e => setPoolFilter(e.target.value)}
            placeholder="Search widgets…"
          />
          <span className="badge">{palette.length}</span>
        </div>
        {palette.length === 0 && (
          <div className="terminal-line" style={{ padding: 12 }}>
            &gt; NO WIDGETS MATCH "{poolFilter}"
          </div>
        )}
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
      </div>
    </div>
  );
}
