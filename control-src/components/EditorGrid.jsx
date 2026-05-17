import React, { useRef, useEffect, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { motion, AnimatePresence } from 'framer-motion';
import { WIDGET_REGISTRY, GRID_COLS, GRID_ROWS, widgetById } from '../widgets.js';

// Editor uses two regions:
//  - Canvas: dashboard grid with enabled widgets. Drag to reposition.
//  - Pool: palette of disabled widgets with "+ ADD" buttons.
//  - Each canvas tile has size-preset buttons (S/M/L/XL) and a × remove.
// Resizing is preset-based — no arbitrary corner drag — to keep layouts
// snapping to known-good sizes.
export default function EditorGrid({ layout, showGrid, onChange }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const enabled  = layout.filter(l => l.enabled !== false);
  const disabled = layout.filter(l => l.enabled === false);

  const rowHeight = ((width - 16) * 0.6) / GRID_ROWS;

  const rglLayout = enabled.map(l => ({
    i: l.id,
    x: l.x, y: l.y, w: l.w, h: l.h,
    minW: 1, minH: 1, maxW: GRID_COLS, maxH: GRID_ROWS,
    static: false
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
      // When the user free-resizes via the corner handle, the tile no
      // longer matches a known preset. Clear `size` so the preset row
      // visually reflects "custom".
      const sizeChanged = (l.w !== n.w || l.h !== n.h);
      return { ...l, x: n.x, y: n.y, w: n.w, h: n.h, size: sizeChanged ? null : l.size };
    });
    onChange(merged);
  };

  // Bounds-checked positioning. Tries to keep tile at (x, y) but clamps
  // when the new size would push it off the grid.
  const clampPos = (x, y, w, h) => ({
    x: Math.max(0, Math.min(x, GRID_COLS - w)),
    y: Math.max(0, Math.min(y, GRID_ROWS - h))
  });

  // Find an empty position to drop an added widget. Tries default first,
  // then scans for a free top-left.
  const findFreeSlot = (def, w, h, items) => {
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
    return { x: 0, y: 0 };
  };

  const setSize = (id, sizeKey) => {
    const def = widgetById(id);
    if (!def || !def.sizes[sizeKey]) return;
    let { w, h } = def.sizes[sizeKey];
    w = Math.min(w, GRID_COLS);
    h = Math.min(h, GRID_ROWS);

    const target = layout.find(l => l.id === id);
    if (!target) return;
    const others = enabled.filter(o => o.id !== id);
    const overlaps = (px, py) => others.some(o =>
      px < o.x + o.w && px + w > o.x &&
      py < o.y + o.h && py + h > o.y
    );

    // Prefer to keep the tile's current position; if the bigger size
    // collides with neighbors, scan for a free top-left slot. Falls back
    // to the clamped original position when nothing fits — the user can
    // then move other widgets out of the way.
    let { x, y } = clampPos(target.x, target.y, w, h);
    if (overlaps(x, y)) {
      let found = null;
      for (let yy = 0; yy + h <= GRID_ROWS && !found; yy++) {
        for (let xx = 0; xx + w <= GRID_COLS; xx++) {
          if (!overlaps(xx, yy)) { found = { x: xx, y: yy }; break; }
        }
      }
      if (found) ({ x, y } = found);
    }

    onChange(layout.map(l => l.id === id ? { ...l, x, y, w, h, size: sizeKey } : l));
  };

  const addToCanvas = (id) => {
    const def = widgetById(id);
    if (!def) return;
    const sizeKey = def.defaultSize;
    const { w, h } = def.sizes[sizeKey];
    const slot = findFreeSlot(def, w, h, enabled);
    onChange(layout.map(l => l.id === id ? { ...l, ...slot, w, h, size: sizeKey, enabled: true } : l));
  };

  const removeFromCanvas = (id) => {
    onChange(layout.map(l => l.id === id ? { ...l, enabled: false } : l));
  };

  return (
    <div>
      <div ref={wrapRef} className={`editor-wrap ${showGrid ? 'show-grid' : ''}`}>
        <GridLayout
          className="layout"
          cols={GRID_COLS}
          rowHeight={rowHeight}
          width={width - 16}
          maxRows={GRID_ROWS}
          compactType={null}
          preventCollision
          isResizable
          resizeHandles={['se']}
          margin={[4, 4]}
          containerPadding={[0, 0]}
          layout={rglLayout}
          onLayoutChange={handleLayoutChange}
        >
          {enabled.map(l => {
            const def = widgetById(l.id);
            const sizeKeys = def ? Object.keys(def.sizes) : [];
            return (
              <div key={l.id}>
                <motion.div
                  layout
                  className="editor-tile"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  style={{ width: '100%', height: '100%' }}
                >
                  <button
                    className="tile-remove"
                    title="Remove from layout"
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); removeFromCanvas(l.id); }}
                  >×</button>
                  <div className="tile-id">{l.id}</div>
                  <div className="tile-label">{def?.label || l.id}</div>
                  <div className="tile-sizes" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                    {sizeKeys.map(k => (
                      <button
                        key={k}
                        className={`size-pill ${l.size === k ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setSize(l.id, k); }}
                        title={`${def.sizes[k].w}×${def.sizes[k].h}`}
                      >{k}</button>
                    ))}
                  </div>
                </motion.div>
              </div>
            );
          })}
        </GridLayout>

        {enabled.length === 0 && (
          <div className="editor-empty terminal-line">
            &gt; CANVAS_EMPTY — ADD A WIDGET FROM POOL BELOW
          </div>
        )}
      </div>

      <div className="palette">
        <div className="palette-title">
          <span>Widget Pool</span>
          <span className="badge">{disabled.length}</span>
        </div>
        {disabled.length === 0 ? (
          <div className="terminal-line palette-empty">&gt; ALL_WIDGETS_ON_CANVAS</div>
        ) : (
          <AnimatePresence>
            {disabled.map(l => {
              const def = widgetById(l.id);
              return (
                <motion.div
                  key={l.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="palette-tile"
                >
                  <div>
                    <div className="tile-id">{l.id}</div>
                    <div className="tile-label">{def?.label || l.id}</div>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => addToCanvas(l.id)}
                  >
                    + ADD
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
