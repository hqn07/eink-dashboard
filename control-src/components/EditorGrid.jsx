import React, { useRef, useEffect, useState } from 'react';
import { GridStack } from 'gridstack';
import { motion, AnimatePresence } from 'framer-motion';
import { Gear, X } from '@phosphor-icons/react';
import { WIDGET_REGISTRY, GRID_COLS, GRID_ROWS, widgetById, makeInstance } from '../widgets.js';
import { renderWidget, renderHeader, renderFooter, isHeaderOn, isFooterOn, headerVariant, footerVariant } from '../widget-render.js';
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

// Install Gridstack's renderCB once. v11+ no longer accepts raw `content`
// HTML via addWidget for XSS safety — apps must opt in via renderCB.
// We stash the per-instance HTML on the widget object via a private
// `_einkHtml` field so this module-global callback can read it.
GridStack.renderCB = function (el, w) {
  if (w && typeof w._einkHtml === 'string') {
    el.innerHTML = w._einkHtml;
  }
};

// Pick a widget's smallest registered size by area — used for the pool
// preview and for the initial drop size when a widget is added.
function smallestSizeKey(def) {
  return Object.keys(def.sizes).reduce((a, b) => {
    const sa = def.sizes[a]; const sb = def.sizes[b];
    return (sb.w * sb.h) < (sa.w * sa.h) ? b : a;
  }, def.defaultSize);
}

export default function EditorGrid({ layout, showGrid, previewData, onChange, onError, onCommitItemNow }) {
  const wrapRef = useRef(null);
  const gridHostRef = useRef(null);
  const gridRef = useRef(null);
  const [size, setSizeState] = useState({ w: 800, h: 480 });
  const [shake, setShake] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  // Tile selection (click on desktop, tap on touch). The selected tile
  // keeps its action buttons visible; clicking elsewhere clears it.
  const [selectedId, setSelectedId] = useState(null);
  // Which tile (if any) currently has its settings modal open.
  const [modalForId, setModalForId] = useState(null);
  // 5px drag threshold so a single click (mousedown→up < 5px move) is
  // treated as a select while a real drag is left for Gridstack.
  const downPosRef = useRef(null);
  // React state we want to read inside Gridstack event handlers without
  // re-binding listeners every render. Keep a ref mirror of `layout`.
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // autofit runner — matches the helper in dashboard.html. Binary-search
  // the largest font size that fits inside each .autofit element's box.
  function autofitText(el) {
    if (!el) return;
    const maxW = el.clientWidth;
    const maxH = el.clientHeight;
    if (maxW <= 0 || maxH <= 0) return;
    const minFont = Math.max(8, parseInt(el.getAttribute('data-min-font') || '11', 10));
    let lo = minFont, hi = 260;
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
  // section we hand to Gridstack is BODY_H/DASH_H of that height. Row
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

  // Drag-to-delete: when the user releases a tile over the .trash-zone
  // DOM element, drop the widget instead of committing the new position.
  const trashRef = useRef(null);
  const [trashHover, setTrashHover] = useState(false);
  const [snapGuides, setSnapGuides] = useState({ xCols: [], yRows: [] });
  // Mirror trashHover into a ref so dragstop handlers can read current
  // value without re-binding.
  const trashHoverRef = useRef(false);
  useEffect(() => { trashHoverRef.current = trashHover; }, [trashHover]);

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
      if (o.id === item.id) continue;
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

  // Build the inner HTML string for one tile — used both for initial
  // widget creation and for live re-renders triggered by previewData
  // updates or layout edits.
  const buildTileHtml = (l) => {
    const itemSlot = (previewData && previewData.perItem && previewData.perItem[l.id]) || {};
    const inner = renderWidget(l.widgetId, {
      ...previewData,
      ...itemSlot,
      cellW: l.w,
      cellH: l.h,
      density: l.density
    }) || '';
    const dashW = l.w * (DASH_W / GRID_COLS);
    const dashH = l.h * (BODY_H / GRID_ROWS);
    const classes = ['cell', `cell-${l.widgetId}`];
    if (l.x + l.w >= GRID_COLS) classes.push('cell-edge-right');
    if (l.y + l.h >= GRID_ROWS) classes.push('cell-edge-bottom');
    if (l.flush) classes.push('cell-flush');
    if (l.border === 'dashed') classes.push('cell-border-dashed');
    if (l.border === 'none')   classes.push('cell-border-none');
    const cellHtml = `<div class="${classes.join(' ')}" style="width:${dashW}px;height:${dashH}px">${inner}</div>`;
    const isSelected = selectedId === l.id;
    // The Gear/X buttons are emitted as plain HTML so they live inside
    // Gridstack's content (a React tree under it would be torn down by
    // Gridstack's DOM rewrites on add/remove). Click handling is wired
    // via delegated listeners attached to the grid host.
    return (
      `<div class="editor-tile live-tile ${isSelected ? 'selected' : ''}" data-tile-id="${l.id}">` +
        `<div class="tile-actions">` +
          `<button class="tile-settings gs-no-drag" data-tile-action="settings" data-tile-id="${l.id}" title="Settings" aria-label="Settings">` +
            `<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M128 80a48 48 0 1 0 48 48 48 48 0 0 0-48-48Zm0 80a32 32 0 1 1 32-32 32 32 0 0 1-32 32Zm88-29.84q.06-2.16 0-4.32l14.92-18.64a8 8 0 0 0 1.48-7.06 107.21 107.21 0 0 0-10.88-26.25 8 8 0 0 0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186 40.54a8 8 0 0 0-3.94-6 107.71 107.71 0 0 0-26.25-10.86 8 8 0 0 0-7.06 1.48L130.16 40Q128 39.94 125.84 40L107.2 25.11a8 8 0 0 0-7.06-1.48A107.6 107.6 0 0 0 73.89 34.51a8 8 0 0 0-3.93 6L67.32 64.27q-1.56 1.49-3 3L40.54 70a8 8 0 0 0-6 3.94 107.71 107.71 0 0 0-10.87 26.25 8 8 0 0 0 1.49 7.06L40 125.84Q39.94 128 40 130.16L25.11 148.8a8 8 0 0 0-1.48 7.06 107.21 107.21 0 0 0 10.88 26.25 8 8 0 0 0 6 3.93l23.72 2.64q1.49 1.56 3 3L70 215.46a8 8 0 0 0 3.94 6 107.71 107.71 0 0 0 26.25 10.87 8 8 0 0 0 7.06-1.49L125.84 216q2.16.06 4.32 0l18.64 14.92a8 8 0 0 0 7.06 1.48 107.21 107.21 0 0 0 26.25-10.88 8 8 0 0 0 3.93-6l2.64-23.72q1.56-1.48 3-3L215.46 186a8 8 0 0 0 6-3.94 107.71 107.71 0 0 0 10.87-26.25 8 8 0 0 0-1.49-7.06Zm-16.1-6.5a73.93 73.93 0 0 1 0 8.68 8 8 0 0 0 1.74 5.48l14.19 17.73a91.57 91.57 0 0 1-6.23 15L187 173.11a8 8 0 0 0-5.1 2.64 74.11 74.11 0 0 1-6.14 6.14 8 8 0 0 0-2.64 5.1l-2.51 22.58a91.32 91.32 0 0 1-15 6.23l-17.74-14.19a8 8 0 0 0-5-1.75h-.48a73.93 73.93 0 0 1-8.68 0 8 8 0 0 0-5.48 1.74l-17.78 14.2a91.57 91.57 0 0 1-15-6.23L83 187a8 8 0 0 0-2.64-5.1 74.11 74.11 0 0 1-6.14-6.14 8 8 0 0 0-5.1-2.64l-22.58-2.52a91.32 91.32 0 0 1-6.23-15l14.19-17.74a8 8 0 0 0 1.74-5.48 73.93 73.93 0 0 1 0-8.68 8 8 0 0 0-1.74-5.48L40.31 100.45a91.57 91.57 0 0 1 6.23-15L69 82.89a8 8 0 0 0 5.1-2.64 74.11 74.11 0 0 1 6.14-6.14A8 8 0 0 0 82.89 69l2.51-22.57a91.32 91.32 0 0 1 15-6.23l17.74 14.19a8 8 0 0 0 5.48 1.74 73.93 73.93 0 0 1 8.68 0 8 8 0 0 0 5.48-1.74L155.55 40.31a91.57 91.57 0 0 1 15 6.23L173.11 69a8 8 0 0 0 2.64 5.1 74.11 74.11 0 0 1 6.14 6.14 8 8 0 0 0 5.1 2.64l22.58 2.51a91.32 91.32 0 0 1 6.23 15l-14.19 17.74a8 8 0 0 0-1.74 5.53Z"/></svg>` +
          `</button>` +
          `<button class="tile-remove gs-no-drag" data-tile-action="remove" data-tile-id="${l.id}" title="Remove" aria-label="Remove">` +
            `<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66 194.34a8 8 0 0 1-11.32 11.32L128 139.31l-66.34 66.35a8 8 0 0 1-11.32-11.32L116.69 128 50.34 61.66a8 8 0 0 1 11.32-11.32L128 116.69l66.34-66.35a8 8 0 0 1 11.32 11.32L139.31 128Z"/></svg>` +
          `</button>` +
        `</div>` +
        `<div class="live-tile-body">` +
          `<div class="live-tile-scale" style="transform:scale(${scale});transform-origin:top left;">` +
            cellHtml +
          `</div>` +
        `</div>` +
      `</div>`
    );
  };

  // ============================================================
  // Gridstack lifecycle. We treat React as source of truth: the
  // [layout, scale, previewData, selectedId, headerOn, footerOn]
  // dep array reconciles by clearing + re-adding all widgets. The
  // tile count is small (<50) so this is acceptable.
  // ============================================================
  useEffect(() => {
    if (!gridHostRef.current) return;
    if (gridRef.current) return; // already initialized
    const grid = GridStack.init({
      column: GRID_COLS,
      maxRow: GRID_ROWS,
      cellHeight: rowHeight,
      margin: MARGIN,
      float: true,                // no compacting (matches compactType: null)
      animate: false,
      disableOneColumnMode: true,
      columnOpts: { breakpoints: [{ w: 0, c: GRID_COLS }] },
      resizable: { handles: 'se,sw,nw' },
      draggable: { cancel: '.gs-no-drag, .tile-actions, button' }
    }, gridHostRef.current);
    gridRef.current = grid;

    // Mirror position/size changes back to React. Gridstack's `change`
    // event fires after drag/resize commits. We keep size & other
    // metadata that lives only in React state.
    grid.on('change', (_event, nodes) => {
      const cur = layoutRef.current;
      const map = new Map((nodes || []).map(n => [n.id, n]));
      const merged = cur.map(l => {
        const n = map.get(l.id);
        if (!n) return l;
        const sizeChanged = (l.w !== n.w || l.h !== n.h);
        return {
          ...l,
          x: n.x, y: n.y, w: n.w, h: n.h,
          size: sizeChanged ? null : l.size
        };
      });
      // Bail if nothing actually changed (Gridstack can fire `change`
      // for cosmetic reasons like initial layout settle).
      const changed = merged.some((l, i) => {
        const c = cur[i];
        return !c || c.x !== l.x || c.y !== l.y || c.w !== l.w || c.h !== l.h;
      });
      if (changed) onChangeRef.current(merged);
    });

    // Snap guides + trash-zone detection during drag/resize.
    const findNode = (el) => {
      const id = el && el.getAttribute && el.getAttribute('gs-id');
      if (!id) return null;
      const all = grid.engine.nodes;
      const n = all.find(x => x.id === id);
      if (!n) return null;
      return { id: n.id, x: n.x, y: n.y, w: n.w, h: n.h };
    };

    grid.on('drag', (event, el) => {
      const me = findNode(el);
      if (!me) return;
      const others = grid.engine.nodes
        .filter(n => n.id !== me.id)
        .map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
      setSnapGuides(computeSnapGuides(me, others));
      // Underlying browser MouseEvent lives on event (Gridstack passes
      // a DragEvent-like wrapper). Try both shapes.
      const ev = event && (event.originalEvent || event);
      setTrashHover(pointerOverTrash(ev));
    });

    grid.on('dragstop', (event, el) => {
      setSnapGuides({ xCols: [], yRows: [] });
      const ev = event && (event.originalEvent || event);
      const overTrash = pointerOverTrash(ev) || trashHoverRef.current;
      setTrashHover(false);
      if (overTrash) {
        const id = el && el.getAttribute && el.getAttribute('gs-id');
        if (id) {
          // Defer so Gridstack's own dragstop cleanup runs first.
          setTimeout(() => removeFromCanvas(id), 0);
        }
      }
    });

    grid.on('resize', (event, el) => {
      const me = findNode(el);
      if (!me) return;
      const others = grid.engine.nodes
        .filter(n => n.id !== me.id)
        .map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
      setSnapGuides(computeSnapGuides(me, others));
    });

    grid.on('resizestop', () => {
      setSnapGuides({ xCols: [], yRows: [] });
    });

    return () => {
      try { grid.destroy(false); } catch (_) { /* ignore */ }
      gridRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update cellHeight + column when display size changes.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.cellHeight(rowHeight);
  }, [rowHeight]);

  // Reconcile widgets with React layout. We clear + re-add on every
  // change — simple and correct for our scale (<50 tiles per screen).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.batchUpdate();
    try {
      grid.removeAll(false);
      for (const l of layout) {
        const def = widgetById(l.widgetId);
        const min = (def && def.minSize) || { w: 1, h: 1 };
        grid.addWidget({
          id: l.id,
          x: l.x, y: l.y, w: l.w, h: l.h,
          minW: min.w, minH: min.h,
          maxW: GRID_COLS, maxH: GRID_ROWS,
          // Stashed for renderCB to read on creation.
          _einkHtml: buildTileHtml(l)
        });
      }
    } finally {
      grid.batchUpdate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, previewData, scale, selectedId, headerOn, footerOn]);

  // Delegated click/pointer handlers for the inline gear/remove buttons
  // and click-to-select on the tile body. Mounted once on the grid host.
  useEffect(() => {
    const host = gridHostRef.current;
    if (!host) return;
    const onMouseDown = (e) => {
      const tileEl = e.target.closest('[data-tile-id]');
      if (!tileEl) return;
      downPosRef.current = {
        x: e.clientX,
        y: e.clientY,
        id: tileEl.getAttribute('data-tile-id')
      };
    };
    const onMouseUp = (e) => {
      const d = downPosRef.current;
      downPosRef.current = null;
      const tileEl = e.target.closest('[data-tile-id]');
      if (!d || !tileEl) return;
      if (d.id !== tileEl.getAttribute('data-tile-id')) return;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (moved < 5) setSelectedId(d.id);
    };
    const onTouchEnd = (e) => {
      const tileEl = e.target.closest('[data-tile-id]');
      if (tileEl) setSelectedId(tileEl.getAttribute('data-tile-id'));
    };
    const onClick = (e) => {
      const btn = e.target.closest('[data-tile-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.getAttribute('data-tile-action');
      const id = btn.getAttribute('data-tile-id');
      if (action === 'settings') setModalForId(id);
      else if (action === 'remove') removeFromCanvas(id);
    };
    host.addEventListener('mousedown', onMouseDown);
    host.addEventListener('mouseup', onMouseUp);
    host.addEventListener('touchend', onTouchEnd);
    host.addEventListener('click', onClick);
    return () => {
      host.removeEventListener('mousedown', onMouseDown);
      host.removeEventListener('mouseup', onMouseUp);
      host.removeEventListener('touchend', onTouchEnd);
      host.removeEventListener('click', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

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
        <div
          ref={gridHostRef}
          className="grid-stack layout"
          style={{ width: innerW, height: '100%' }}
        />
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
            border: updated.border,
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
