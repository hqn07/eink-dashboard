import React, { useRef, useEffect, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { motion, AnimatePresence } from 'framer-motion';
import { WIDGET_REGISTRY, GRID_COLS, GRID_ROWS, widgetById } from '../widgets.js';
import { renderWidget } from '../widget-render.js';

const PAD = 6;
const MARGIN = 4;

// Pick a widget's smallest registered size by area — used for the pool
// preview and for the initial drop size when a widget is added.
function smallestSizeKey(def) {
  return Object.keys(def.sizes).reduce((a, b) => {
    const sa = def.sizes[a]; const sb = def.sizes[b];
    return (sb.w * sb.h) < (sa.w * sa.h) ? b : a;
  }, def.defaultSize);
}

export default function EditorGrid({ layout, showGrid, previewData, onChange, onError }) {
  const wrapRef = useRef(null);
  const [size, setSizeState] = useState({ w: 800, h: 480 });
  const [shake, setShake] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const [trashHover, setTrashHover] = useState(false);

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

  const enabled  = layout.filter(l => l.enabled !== false);
  const disabled = layout.filter(l => l.enabled === false);

  const innerH = Math.max(0, size.h - PAD * 2 - (GRID_ROWS - 1) * MARGIN);
  const rowHeight = innerH / GRID_ROWS;
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

  const addToCanvas = (id) => {
    const def = widgetById(id);
    if (!def) return;
    const sizeKey = smallestSizeKey(def);
    const { w, h } = def.sizes[sizeKey];
    const slot = findFreeSlot(w, h, enabled);
    if (!slot) {
      triggerShake();
      onError && onError(`No room for ${def.label} on canvas`);
      return;
    }
    onChange(layout.map(l => l.id === id ? { ...l, ...slot, w, h, size: sizeKey, enabled: true } : l));
  };

  const removeFromCanvas = (id) => {
    onChange(layout.map(l => l.id === id ? { ...l, enabled: false } : l));
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

  // HTML5 drag a canvas tile onto the TRASH zone to delete it.
  const onTileDragStart = (e, id) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-widget-remove', id);
  };

  const onTrashDragOver = (e) => {
    if (e.dataTransfer.types.includes('text/x-widget-remove')) {
      e.preventDefault();
      setTrashHover(true);
    }
  };

  const onTrashDragLeave = () => setTrashHover(false);

  const onTrashDrop = (e) => {
    e.preventDefault();
    setTrashHover(false);
    const id = e.dataTransfer.getData('text/x-widget-remove');
    if (id) removeFromCanvas(id);
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
        >
          {enabled.map(l => {
            const html = renderWidget(l.id, previewData) || '';
            return (
              <div key={l.id}>
                <motion.div
                  layout
                  className="editor-tile live-tile"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  style={{ width: '100%', height: '100%' }}
                  draggable
                  onDragStart={(e) => onTileDragStart(e, l.id)}
                >
                  <div className="live-tile-body" dangerouslySetInnerHTML={{ __html: html }} />
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
      </motion.div>

      <div
        className={`trash-zone ${trashHover ? 'hover' : ''}`}
        onDragOver={onTrashDragOver}
        onDragLeave={onTrashDragLeave}
        onDrop={onTrashDrop}
      >
        <span>&gt; DRAG HERE TO REMOVE</span>
      </div>

      <div className="palette">
        <div className="palette-title">
          <span>Widget Pool</span>
          <span className="badge">{disabled.length}</span>
        </div>
        {disabled.length === 0 ? (
          <div className="terminal-line palette-empty">&gt; ALL_WIDGETS_ON_CANVAS</div>
        ) : (
          <div className="palette-grid">
            <AnimatePresence>
              {disabled.map(l => {
                const def = widgetById(l.id);
                if (!def) return null;
                const sizeKey = smallestSizeKey(def);
                const { w, h } = def.sizes[sizeKey];
                const html = renderWidget(l.id, previewData) || '';
                // Tile in the pool sized roughly to the widget's footprint.
                // 4 cells per row in the palette area; height keeps ratio.
                const aspect = w / h;
                return (
                  <motion.div
                    key={l.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="palette-card"
                    draggable
                    onDragStart={(e) => onPoolDragStart(e, l.id)}
                    onClick={() => addToCanvas(l.id)}
                    title={`${def.label} — drag onto canvas or click to add`}
                  >
                    <div className="palette-card-preview" style={{ aspectRatio: aspect }}>
                      <div className="palette-card-scale" dangerouslySetInnerHTML={{ __html: html }} />
                    </div>
                    <div className="palette-card-label">{def.label}</div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
