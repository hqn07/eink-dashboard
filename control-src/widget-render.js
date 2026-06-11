// Client-side dispatcher used by the React editor (EditorGrid /
// LiveDashboard / Preview). Re-exports the typography helpers from
// widgets/_chrome.js so both the editor and server SSR share the same
// per-tile style code.
//
// Widget renderers live in their own modules under widgets/<id>.js and
// are aggregated by widgets/_registry.js. This file is just the
// switchboard the editor imports from.

import { MIGRATED_RENDERERS } from './widgets/_registry.js';

export {
  typographyCss,
  scaleWrap,
  cellClasses,
  buildTileCtx,
  tileCellClasses
} from './widgets/_chrome.js';

export function renderWidget(id, data) {
  const fn = MIGRATED_RENDERERS[id];
  if (!fn) return '';
  try { return fn(data || {}); } catch { return ''; }
}
