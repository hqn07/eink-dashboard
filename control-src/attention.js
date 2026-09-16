// What needs attention, in one list.
//
// Before this, a misconfigured tile said SETUP NEEDED *on the panel* — where
// you see it hours later, across the room — and device health lived on the
// admin-only /status page. Nothing in the editor answered the question people
// actually ask: "why does my dashboard look wrong?"
//
// Detection deliberately reads what the tile RENDERS rather than asking each
// widget to declare its own broken state. A declaration is a second source of
// truth that drifts from the first the moment a widget changes its mind about
// what counts as configured; `_shared.js` `placeholder()` already knows, and
// every widget funnels through it. The cost is rendering the tiles to strings,
// which the editor is doing anyway.

import { renderWidget, buildTileCtx } from './widget-render.js';
import { widgetById as defaultWidgetById } from './widgets.js';

// Big enough that the placeholder renders its hint; kind is size-independent
// either way, so this only affects how much text we can quote back.
const SCAN_CTX_SIZE = { cellW: 400, cellH: 240 };

const PH_KIND = /data-ph-kind="([^"]*)"/;
const PH_HINT = /data-ph-hint="([^"]*)"/;

function unescapeAttr(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// A tile's settings + the data it was given decide whether it is set up; its
// position and size do not. Keeping those out of the signature means dragging
// a tile around does not re-run the scan on every frame.
export function attentionSignature(layout, previewData) {
  const tiles = (layout || [])
    .map(it => `${it.widgetId || it.id}:${JSON.stringify(it.settings || {})}`)
    .join('|');
  // previewData is replaced wholesale on each refetch, so its identity is a
  // sufficient stand-in for "the data changed".
  return tiles + '#' + (previewData ? (previewData.generatedAt || '1') : '0');
}

// -> [{ itemId, widgetId, label, hint, kind }]
export function scanTiles({ layout, previewData, widgetById = defaultWidgetById }) {
  const out = [];
  for (const item of layout || []) {
    const wid = item.widgetId || item.id;
    let html = '';
    try {
      const ctx = { ...buildTileCtx(item, previewData, widgetById(wid)), ...SCAN_CTX_SIZE };
      html = renderWidget(wid, ctx) || '';
    } catch {
      // A widget that throws is its own bug, not a setup problem. The canvas
      // surfaces it through the error boundary; don't double-report here.
      continue;
    }
    const km = PH_KIND.exec(html);
    if (!km) continue;
    const kind = km[1];
    // 'nodata' is a fetch that failed or has nothing to say right now —
    // transient, and not something the user can fix by configuring anything.
    if (kind !== 'setup') continue;
    const hm = PH_HINT.exec(html);
    const def = widgetById(wid);
    out.push({
      itemId: item.id,
      widgetId: wid,
      label: (def && def.label) || wid,
      hint: unescapeAttr(hm ? hm[1] : ''),
      kind
    });
  }
  return out;
}

// Device-side problems, phrased the same way as tile ones.
// `presence` comes from device-presence.js.
export function scanDevice(presence) {
  if (!presence || !presence.everSeen) return [];
  if (!presence.stale) return [];
  return [{
    itemId: null,
    widgetId: null,
    label: 'Panel',
    hint: `last seen ${presence.lastSeenLabel}`,
    kind: 'offline'
  }];
}
