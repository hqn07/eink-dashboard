// Page rules — the dividers between tiles, computed for the PAGE instead of
// drawn by each tile.
//
// WHY THIS EXISTS. `.cell` drew its own `border-right` / `border-bottom`, and a
// border a box draws around itself can only ever fence that box off. Two tiles
// that belong together — a weather hero beside its own forecast, two halves of
// one idea — had no way to share an edge, because neither could tell the other
// to stop drawing. The page was eight tidy boxes rather than one page.
//
// Ownership moves here. A rule is a property of the SEAM between two tiles, so
// it is computed from the layout: walk every pair of touching tiles, and draw a
// rule along the exact overlap of their shared edge unless they are in the same
// zone. Partial seams work — a 9-wide tile beside a 3-tall one gets a rule for
// the three rows they actually share and nothing for the rest, which a
// per-cell border cannot express at all.
//
// Zones: `settings.zone` when set, otherwise the widget id. So two `weather`
// tiles placed against each other read as one weather module with no seam,
// while a weather tile against a clock keeps its rule. Naming a zone lets
// unrelated widgets join deliberately.
//
// Geometry is emitted in PERCENT of the page, so the same numbers drive the
// 800x480 render, the editor canvas at whatever width it happens to be, and
// the preview pane — one computation, three surfaces, which is the parity rule
// that `_chrome.js` exists to enforce.

const DEFAULT_GRID = { cols: 24, rows: 12 };

function zoneOf(item) {
  const s = item && item.settings;
  const z = s && typeof s.zone === 'string' ? s.zone.trim() : '';
  return z || item.widgetId || item.id || '';
}

// [a1, a2) and [b1, b2) — the shared span, or null when they only touch at a
// point (a corner, which is not a seam).
function overlap(a1, a2, b1, b2) {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  return hi > lo ? [lo, hi] : null;
}

// Vertical seams (a tile's right edge against its right-hand neighbours) and
// horizontal seams (bottom edge against the tiles below). Each seam is
// considered once, from the tile on the left / above.
export function pageRuleSegments(layout, grid = DEFAULT_GRID) {
  const cols = grid.cols || DEFAULT_GRID.cols;
  const rows = grid.rows || DEFAULT_GRID.rows;
  const tiles = (layout || []).filter(t => t
    && Number.isFinite(t.x) && Number.isFinite(t.y)
    && Number.isFinite(t.w) && Number.isFinite(t.h));

  const segs = [];
  for (const a of tiles) {
    const ax2 = a.x + a.w;
    const ay2 = a.y + a.h;
    for (const b of tiles) {
      if (b === a) continue;
      // b starts exactly where a ends horizontally → vertical seam.
      if (b.x === ax2) {
        const span = overlap(a.y, ay2, b.y, b.y + b.h);
        if (span && zoneOf(a) !== zoneOf(b)) {
          segs.push({ dir: 'v', at: ax2, from: span[0], to: span[1] });
        }
      }
      // b starts exactly where a ends vertically → horizontal seam.
      if (b.y === ay2) {
        const span = overlap(a.x, ax2, b.x, b.x + b.w);
        if (span && zoneOf(a) !== zoneOf(b)) {
          segs.push({ dir: 'h', at: ay2, from: span[0], to: span[1] });
        }
      }
    }
  }

  // The page's own edges are never seams — a rule there is a frame, and the
  // panel's bezel already is one.
  const inside = segs.filter(s => s.at > 0 && s.at < (s.dir === 'v' ? cols : rows));

  // Two tiles stacked on the left of one tall tile produce the same vertical
  // seam twice; merging also joins collinear runs so a seam that crosses
  // several tiles is one rule rather than a dashed-looking series of them.
  return mergeCollinear(inside);
}

function mergeCollinear(segs) {
  const byLine = new Map();
  for (const s of segs) {
    const key = `${s.dir}:${s.at}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(s);
  }
  const out = [];
  for (const [key, list] of byLine) {
    list.sort((p, q) => p.from - q.from);
    let cur = { ...list[0] };
    for (let i = 1; i < list.length; i++) {
      const s = list[i];
      if (s.from <= cur.to) {
        cur.to = Math.max(cur.to, s.to);
      } else {
        out.push(cur);
        cur = { ...s };
      }
    }
    out.push(cur);
  }
  return out;
}

// Percent geometry for the absolutely-positioned rule layer. Thickness stays in
// px (the rule is 2px on glass at every canvas size — a percentage rule would
// thin out in the editor and break the >=2px lint floor on the panel).
export function pageRuleStyles(layout, grid = DEFAULT_GRID) {
  const cols = grid.cols || DEFAULT_GRID.cols;
  const rows = grid.rows || DEFAULT_GRID.rows;
  return pageRuleSegments(layout, grid).map(s => {
    if (s.dir === 'v') {
      return {
        left: `${(s.at / cols) * 100}%`,
        top: `${(s.from / rows) * 100}%`,
        height: `${((s.to - s.from) / rows) * 100}%`,
        width: 'var(--face-rule)',
        marginLeft: 'calc(var(--face-rule) / -2)'
      };
    }
    return {
      top: `${(s.at / rows) * 100}%`,
      left: `${(s.from / cols) * 100}%`,
      width: `${((s.to - s.from) / cols) * 100}%`,
      height: 'var(--face-rule)',
      marginTop: 'calc(var(--face-rule) / -2)'
    };
  });
}

// Same thing as an HTML fragment, for the server SSR path and any surface that
// builds markup as a string rather than as React elements.
export function pageRulesHtml(layout, grid = DEFAULT_GRID) {
  const styles = pageRuleStyles(layout, grid);
  if (!styles.length) return '';
  const toCss = (o) => Object.keys(o)
    .map(k => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${o[k]}`)
    .join(';');
  return `<div class="page-rules" aria-hidden="true">`
    + styles.map(st => `<i style="${toCss(st)}"></i>`).join('')
    + `</div>`;
}
