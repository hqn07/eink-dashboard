import { escapeHtml, pickTier } from './_shared.js';

// Webhook — TRMNL-style "private plugin". Anything that can POST JSON
// (Shortcuts, cron scripts, Home Assistant) pushes to /api/webhook/<key>;
// this widget renders the latest payload. Two modes:
//   - no template: auto key/value grid of the payload's top-level fields
//     (zero-config path — POST something and it shows up)
//   - template: one line per row, `{{path.to.value}}` substituted from the
//     payload (dot paths, numeric indices for arrays). First line renders
//     as the hero value.
// Data arrives via the per-item slot (ctx.webhook = { data, at } | null),
// fetched in lib/widget-data.js from the webhook-store.

export const def = {
  id: 'webhook',
  label: 'Webhook',
  requires: null,
  minSize: { w: 4, h: 3 },
  sizes: {
    S: { w: 6,  h: 4 },
    M: { w: 8,  h: 6 },
    L: { w: 12, h: 6 }
  },
  defaultSize: 'S',
  defaults: () => ({
    key: '',
    title: '',
    template: '',
    fontScale: 1,
    padding: 14
  })
};

// Resolve `a.b.0.c` against an object. Returns undefined when any hop is
// missing so the caller can substitute a placeholder.
function getPath(obj, path) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[Array.isArray(cur) && /^\d+$/.test(part) ? +part : part];
  }
  return cur;
}

function fmtValue(v) {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
  if (typeof v === 'boolean') return v ? 'YES' : 'NO';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// `{{path}}` substitution. Values are escaped; the surrounding literal text
// was escaped by the caller before substitution so a payload value can't
// smuggle markup onto the panel.
function fillTemplate(escapedLine, data) {
  return escapedLine.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g,
    (_, p) => escapeHtml(fmtValue(getPath(data, p))));
}

function agoLabel(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function emptyState(msg, sub) {
  return `
    <div class="widget" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;width:100%;border:2px dashed #000;color:#000;font-family:'JetBrains Mono',monospace;text-align:center;padding:8px;box-sizing:border-box">
      <span style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">${msg}</span>
      ${sub ? `<span style="font-size:11px;letter-spacing:1px">${sub}</span>` : ''}
    </div>`;
}

export function render(ctx) {
  const s = ctx.settings || {};
  const key = (typeof s.key === 'string' && s.key.trim()) ? s.key.trim() : '';
  const tier = pickTier(ctx.cellW || 0, ctx.cellH || 0, ctx.density);
  const scale = Number.isFinite(s.fontScale) ? s.fontScale : 1;
  const title = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim().toUpperCase() : 'WEBHOOK';

  if (!key) return emptyState('Webhook · click to set up', 'pick a key in settings');

  const hook = ctx.webhook;
  if (!hook || !hook.data) {
    return emptyState('Waiting for data', `POST /api/webhook/${escapeHtml(key)}`);
  }

  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const data = hook.data;
  const tpl = (typeof s.template === 'string') ? s.template.trim() : '';
  let body = '';

  if (tpl) {
    // Template mode: first line = hero, the rest = stacked rows.
    const lines = tpl.split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => fillTemplate(escapeHtml(l), data));
    const [hero, ...rest] = lines;
    body = `
      <div class="tr-lv ${tier === 'tiny' ? 'tr-lv-sm' : 'tr-lv-md'}" style="margin-bottom:${rest.length ? 8 : 0}px">
        <div class="tr-v autofit" data-min-font="14" style="font-size:${Math.round(34 * scale)}px">${hero}</div>
      </div>
      ${rest.map(l => `<div style="font-size:${Math.round(13 * scale)}px;font-weight:600;letter-spacing:0.5px;padding:5px 0;border-top:2px dotted #000">${l}</div>`).join('')}`;
  } else {
    // Auto mode: top-level key/value rows, insertion order, capped to what
    // a tile can plausibly hold.
    const entries = Object.entries(data).slice(0, 8);
    body = entries.map(([k, v]) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:5px 0;border-bottom:2px dotted #000">
        <span class="tr-l" style="margin:0">${escapeHtml(String(k).toUpperCase())}</span>
        <span style="font-size:${Math.round(16 * scale)}px;font-weight:800;font-variant-numeric:tabular-nums;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(fmtValue(v))}</span>
      </div>`).join('');
  }

  const showFoot = tier !== 'tiny' && (ctx.cellH || 0) >= 5;
  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(title)}</span><span class="tr-meta">${agoLabel(hook.at || now, now)}</span></div>
    <div class="tr-body" style="justify-content:center">${body}</div>
    ${showFoot ? `<div class="tr-foot"><span class="tr-foot-name">Webhook</span><span>${escapeHtml(key)}</span></div>` : ''}
  </div>`;
}
