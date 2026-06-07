import React, { useEffect, useRef } from 'react';
import { renderWidget } from '../widget-render.js';
import { widgetById } from '../widgets.js';

// Binary-search a font-size that lets the element's content fit its
// bounding box. Matches autofitText in public/dashboard.html.
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

const DASH_W = 800;
const DASH_H = 480;
const HEADER_H = 60;
const FOOTER_H = 28;
const GRID_COLS = 24;
const GRID_ROWS = 12;

// Same minute-of-day helper the dashboard.html version uses, for the
// per-tile visibility gating.
function nowMinsTZ(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC', hour12: false, hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    let h = 0, m = 0;
    for (const p of parts) {
      if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
      if (p.type === 'minute') m = parseInt(p.value, 10);
    }
    return h * 60 + m;
  } catch { return new Date().getHours() * 60 + new Date().getMinutes(); }
}
function parseHHMM(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function withinVisibility(vis, nowM) {
  if (!vis || !vis.enabled) return true;
  const a = parseHHMM(vis.from), b = parseHHMM(vis.to);
  if (a == null || b == null) return true;
  if (a === b) return true;
  if (a < b) return nowM >= a && nowM < b;
  return nowM >= a || nowM < b;
}

// React mirror of public/dashboard.html. Renders the exact same DOM
// structure + CSS classes so the in-page preview = what Puppeteer would
// screenshot. Used by the control panel preview AND (eventually) the
// in-place edit canvas.
export default function LiveDashboard({
  data,
  onTileClick,
  selectedTileId,
  editingTileId,
  renderTileOverlay
}) {
  const rootRef = useRef(null);
  // Run autofit after every render so .autofit elements grow/shrink as
  // the cell dims change. requestAnimationFrame so layout has settled.
  useEffect(() => {
    if (!rootRef.current) return;
    let cancelled = false;
    let rafId = 0;
    const run = () => {
      rafId = requestAnimationFrame(() => {
        if (cancelled || !rootRef.current) return;
        rootRef.current.querySelectorAll('.autofit').forEach(autofitText);
      });
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (!cancelled) run(); });
    } else {
      run();
    }
    return () => { cancelled = true; if (rafId) cancelAnimationFrame(rafId); };
  });
  const cfg = (data && data.cfg) || {};
  const layout = (data && data.layout) || [];
  const nowM = nowMinsTZ(cfg.timezone || 'UTC');

  const pageStyle = {
    gridTemplateRows: `0px minmax(0, 1fr) 0px`
  };
  const bodyStyle = {
    gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
    gridTemplateRows:    `repeat(${GRID_ROWS}, minmax(0, 1fr))`
  };

  const tiles = [];
  for (const item of layout) {
    const def = widgetById(item.widgetId || item.id);
    if (!def) continue;
    if (!withinVisibility(item.visibility, nowM)) continue;
    const inner = renderWidget(item.widgetId || item.id, { ...data, cellW: item.w, cellH: item.h, density: item.density }) || '';
    if (!inner) continue;
    const classes = ['cell', `cell-${def.id}`];
    if (item.x + item.w >= GRID_COLS) classes.push('cell-edge-right');
    if (item.y + item.h >= GRID_ROWS) classes.push('cell-edge-bottom');
    if (item.flush) classes.push('cell-flush');
    if (item.border === 'dashed') classes.push('cell-border-dashed');
    if (item.border === 'none')   classes.push('cell-border-none');
    if (selectedTileId === item.id) classes.push('cell-selected');
    if (editingTileId === item.id)  classes.push('cell-editing');
    const tileStyle = {
      gridColumn: `${item.x + 1} / span ${item.w}`,
      gridRow:    `${item.y + 1} / span ${item.h}`,
      position: 'relative'
    };
    if (renderTileOverlay) {
      tiles.push(
        <div
          key={item.id}
          className={classes.join(' ')}
          style={tileStyle}
          data-tile-id={item.id}
          onClick={(e) => onTileClick && onTileClick(item, e)}
        >
          <div className="cell-inner" dangerouslySetInnerHTML={{ __html: inner }} />
          {renderTileOverlay(item)}
        </div>
      );
    } else {
      tiles.push(
        <div
          key={item.id}
          className={classes.join(' ')}
          style={tileStyle}
          data-tile-id={item.id}
          onClick={(e) => onTileClick && onTileClick(item, e)}
          dangerouslySetInnerHTML={{ __html: inner }}
        />
      );
    }
  }

  return (
    <div className="page" style={pageStyle} ref={rootRef}>
      <div className="hdr-stub" />
      <main className="body body-grid" style={bodyStyle}>
        {tiles.length > 0 ? tiles : (
          <div className="empty terminal-empty" style={{ gridColumn: `1 / span ${GRID_COLS}`, gridRow: `1 / span ${GRID_ROWS}` }}>
            &gt; NO_WIDGETS_ENABLED
          </div>
        )}
      </main>
      <div className="ftr-stub" />
    </div>
  );
}
