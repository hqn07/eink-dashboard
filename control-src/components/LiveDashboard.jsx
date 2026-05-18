import React from 'react';
import {
  renderWidget,
  renderHeader,
  renderFooter,
  isHeaderOn,
  isFooterOn
} from '../widget-render.js';
import { widgetById } from '../widgets.js';

const DASH_W = 800;
const DASH_H = 480;
const HEADER_H = 60;
const FOOTER_H = 28;
const GRID_COLS = 12;
const GRID_ROWS = 6;

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
  const cfg = (data && data.cfg) || {};
  const layout = (data && data.layout) || [];
  const headerOn = isHeaderOn(data);
  const footerOn = isFooterOn(data);
  const nowM = nowMinsTZ(cfg.timezone || 'UTC');

  const pageStyle = {
    gridTemplateRows: `${headerOn ? HEADER_H : 0}px minmax(0, 1fr) ${footerOn ? FOOTER_H : 0}px`
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
    const inner = renderWidget(item.widgetId || item.id, { ...data, cellW: item.w, cellH: item.h }) || '';
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
    <div className="page" style={pageStyle}>
      {headerOn ? (
        <header className="hdr" dangerouslySetInnerHTML={{ __html: renderHeader(data) }} />
      ) : (
        <div className="hdr-stub" />
      )}
      <main className="body body-grid" style={bodyStyle}>
        {tiles.length > 0 ? tiles : (
          <div className="empty terminal-empty" style={{ gridColumn: `1 / span ${GRID_COLS}`, gridRow: `1 / span ${GRID_ROWS}` }}>
            &gt; NO_WIDGETS_ENABLED
          </div>
        )}
      </main>
      {footerOn ? (
        <footer className="ftr" dangerouslySetInnerHTML={{ __html: renderFooter(data) }} />
      ) : (
        <div className="ftr-stub" />
      )}
    </div>
  );
}
