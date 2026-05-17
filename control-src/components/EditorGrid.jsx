import React, { useRef, useEffect, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { motion, AnimatePresence } from 'framer-motion';
import { WIDGET_REGISTRY, GRID_COLS, GRID_ROWS, widgetById } from '../widgets.js';

// Editor uses two regions:
//  - Canvas: the dashboard grid where enabled widgets live. Drag & resize via RGL.
//  - Pool: a palette below the canvas listing disabled widgets. "+ ADD"
//    moves a widget onto the canvas at its default (or next free) slot.
//  - Each canvas tile has a small × button that returns it to the pool.
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

  // Body grid is GRID_ROWS rows tall; pick rowHeight so the editor mirrors
  // the dashboard's 60% aspect.
  const rowHeight = ((width - 16) * 0.6) / GRID_ROWS;

  const rglLayout = enabled.map(l => ({
    i: l.id,
    x: l.x, y: l.y, w: l.w, h: l.h,
    minW: 1, minH: 1, maxW: GRID_COLS, maxH: GRID_ROWS
  }));

  const handleLayoutChange = (next) => {
    // RGL fires onLayoutChange on mount; skip when nothing actually moved.
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
      return { ...l, x: n.x, y: n.y, w: n.w, h: n.h };
    });
    onChange(merged);
  };

  // Find an empty position to drop an added widget. Tries the widget's
  // default first; if it collides, scans for a free top-left.
  const findFreeSlot = (def, items) => {
    const fits = (x, y, w, h) => {
      if (x + w > GRID_COLS || y + h > GRID_ROWS) return false;
      return !items.some(it =>
        x < it.x + it.w && x + w > it.x &&
        y < it.y + it.h && y + h > it.y
      );
    };
    const d = def.defaultLayout;
    if (fits(d.x, d.y, d.w, d.h)) return { x: d.x, y: d.y, w: d.w, h: d.h };
    // Fall back: try smaller 3x2 footprint at the first free cell.
    const w = Math.min(d.w, 4), h = Math.min(d.h, 2);
    for (let y = 0; y + h <= GRID_ROWS; y++) {
      for (let x = 0; x + w <= GRID_COLS; x++) {
        if (fits(x, y, w, h)) return { x, y, w, h };
      }
    }
    return { x: 0, y: 0, w: Math.min(d.w, 3), h: Math.min(d.h, 2) };
  };

  const addToCanvas = (id) => {
    const def = widgetById(id);
    if (!def) return;
    const slot = findFreeSlot(def, enabled);
    onChange(layout.map(l => l.id === id ? { ...l, ...slot, enabled: true } : l));
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
          margin={[4, 4]}
          containerPadding={[0, 0]}
          layout={rglLayout}
          onLayoutChange={handleLayoutChange}
          resizeHandles={['se']}
        >
          {enabled.map(l => {
            const def = widgetById(l.id);
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
                  <div className="tile-size">{l.w}×{l.h}</div>
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
