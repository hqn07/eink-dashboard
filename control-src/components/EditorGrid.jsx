import React, { useMemo, useRef, useEffect, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { motion } from 'framer-motion';
import { WIDGET_REGISTRY, GRID_COLS, GRID_ROWS, widgetById } from '../widgets.js';

export default function EditorGrid({ layout, showGrid, onChange, onToggle }) {
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

  // Body grid is GRID_ROWS rows tall; pick rowHeight so the grid is the
  // dashboard's aspect ratio (60% of width = 480/800 → minus header/footer).
  const rowHeight = (width * 0.6) / GRID_ROWS;

  const rglLayout = layout.map(l => ({
    i: l.id,
    x: l.x, y: l.y, w: l.w, h: l.h,
    minW: 1, minH: 1, maxW: GRID_COLS, maxH: GRID_ROWS
  }));

  const handleLayoutChange = (next) => {
    // react-grid-layout fires onLayoutChange on mount with the layout we
    // already passed in. Skip when nothing actually moved.
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

  return (
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
        draggableHandle=".tile-drag"
        resizeHandles={['se']}
      >
        {layout.map(l => {
          const def = widgetById(l.id);
          return (
            <div key={l.id} className="tile-drag">
              <motion.div
                layout
                onClick={(e) => {
                  // Skip toggle when the user clicked the resize handle
                  // (which is RGL's own element). Drag-initiated mouse-ups
                  // don't produce a click event, so genuine clicks here
                  // are real toggle intents.
                  if (e.target.closest('.react-resizable-handle')) return;
                  e.stopPropagation();
                  onToggle(l.id);
                }}
                className={`editor-tile ${l.enabled === false ? 'disabled' : ''}`}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                style={{ width: '100%', height: '100%' }}
              >
                <div className="tile-id">{l.id}</div>
                <div className="tile-label">{def?.label || l.id}</div>
                <div className="tile-size">{l.w}×{l.h} · {l.enabled === false ? 'OFF' : 'ON'}</div>
              </motion.div>
            </div>
          );
        })}
      </GridLayout>
    </div>
  );
}
