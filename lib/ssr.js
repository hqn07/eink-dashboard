// Server-side dashboard HTML rendering. Turns a resolved payload (config +
// live data + layout) into the full 800×480 page HTML that Puppeteer
// screenshots. The per-widget render helpers (DEFS, renderWidget, buildTileCtx,
// scaleWrap, typographyCss, cellClasses, tileCellClasses, demoCtxForWidget)
// are injected via the `ssr` argument — the compiled control-src/widgets
// bundle loaded by server's loadSsr() — so this module shares the exact render
// path used by the editor canvas and preview (parity is load-bearing).
const fs = require('fs');
const path = require('path');
const { expandLayout, withinVisibility } = require('./layout');
const { escapeHtmlServer, htmlAttr } = require('./htmlutil');
const { localMinutesNow } = require('./timewin');

// Fixed hardware geometry (do not change — see CLAUDE.md).
const SCREEN_W = 800, SCREEN_H = 480;
const GRID_COLS = 24, GRID_ROWS = 12;

// Client autofit pass, inlined into the shell. Reads control-src/autofit.js at
// require time and wraps it to run after fonts settle.
const AUTOFIT_SCRIPT = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'control-src', 'autofit.js'), 'utf8')
    .replace(/^export\s+/gm, '');
  return `<script>(function(){\n${src}\n`
    + `var __run=function(){requestAnimationFrame(function(){runAutofit(document);window.__autofitDone=true;});};`
    + `if(document.fonts&&document.fonts.ready){document.fonts.ready.then(__run);}else{__run();}})();</script>`;
})();

function buildPageBodyHtml({ payload, ssr, mode }) {
  const { cfg, weather, events, aqi, onThisDay, units, resolvedMessage,
          perItem, battery, batteryHistory, layout: rawLayout, devWidgetId, cardStyle } = payload;
  const bodyClass = `body body-grid${cardStyle === 'cards' ? ' body-cards' : ''}`;

  const defs = ssr.DEFS;
  const layout = expandLayout(rawLayout, defs);
  const ctxBase = {
    cfg, weather, events, aqi, onThisDay, units,
    resolvedMessage, battery, batteryHistory
  };

  // Matrix mode: every widget at every preset, stacked top-to-bottom.
  if (mode === 'matrix') {
    const PX_W = 800 / GRID_COLS, PX_H = 480 / GRID_ROWS;
    let html = '<div class="page" id="page" style="width:100%;height:auto;display:flex;flex-direction:column;gap:32px;padding:32px;background:#fff">';
    for (const id of Object.keys(defs)) {
      const def = defs[id];
      const sizes = def.sizes || {};
      // Contract v2: widgets with named variants get one matrix row per
      // variant per size so layout bugs in non-default variants surface
      // here instead of on the panel.
      const variantNames = def.variants ? Object.keys(def.variants) : [null];
      for (const key of Object.keys(sizes)) {
        const { w: cw, h: ch } = sizes[key];
        const cellWidth = cw * PX_W;
        const cellHeight = ch * PX_H;
        for (const vn of variantNames) {
          const settings = typeof def.defaults === 'function' ? def.defaults() : undefined;
          if (vn && settings) settings.variant = vn;
          // Live data where the matrix fetch produced some; frozen demo
          // data (same set the editor pool uses) for the rest, so
          // clock / batteries / now-playing show layouts, not
          // SETUP NEEDED placeholders.
          const demo = ssr.demoCtxForWidget ? ssr.demoCtxForWidget(id, cw, ch) : {};
          const live = {};
          for (const k of Object.keys(ctxBase)) {
            const val = ctxBase[k];
            if (val == null) continue;
            if (Array.isArray(val) && !val.length) continue;
            live[k] = val;
          }
          const itemCtx = {
            ...demo, ...live, cellW: cw, cellH: ch,
            // defaults first, demo data settings win over them (so
            // calendar's empty icalUrls can't clobber the demo feed),
            // then re-pin the matrix's per-row variant last.
            settings: {
              ...(settings || {}),
              ...(demo.settings || {}),
              ...(vn ? { variant: vn } : {})
            },
            variant: vn || def.defaultVariant || null
          };
          const inner = ssr.renderWidget(id, itemCtx);
          const label = vn ? `${id} · ${key} · ${vn}` : `${id} · ${key}`;
          html += `
          <div style="border:2px solid #000;background:#fff">
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#000;color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:2px;">
              <span>${escapeHtmlServer(label)}</span>
              <span>${cw}×${ch} · ${Math.round(cellWidth)}×${Math.round(cellHeight)}px</span>
            </div>
            <div class="cell cell-${escapeHtmlServer(id)}" style="width:${cellWidth}px;height:${cellHeight}px;margin:0">${inner}</div>
          </div>`;
        }
      }
    }
    html += '</div>';
    return html;
  }

  // Dev single-widget mode: full-screen single widget, no chrome.
  if ((mode === 'dev' || mode === 'preview') && devWidgetId) {
    const item = layout[0];
    if (!item) return '<div class="page" id="page"></div>';
    const itemCtx = ssr.buildTileCtx(item, { ...ctxBase, perItem }, defs[item.widgetId]);
    const innerRaw = ssr.renderWidget(item.widgetId, itemCtx);
    const sw = ssr.scaleWrap(item.settings);
    const inner = `${sw.open}${innerRaw}${sw.close}`;
    const typo = ssr.typographyCss(item.settings);
    const extraClasses = ssr.cellClasses(item.settings).join(' ');
    // Two flavours of single-widget render:
    //
    //  • `preview` — used by the modal preview iframe / PNG render.
    //    The body grid spans only `item.w × item.h` cells, so a
    //    14×12 tile renders into the iframe's viewport exactly
    //    where it would on a real dashboard, without padding the
    //    rest of the 800×480 page around it.
    //
    //  • `dev` — used by /dev/widget/:id for designer hot-reload.
    //    Always fills the full 24×12 grid so the developer can see
    //    every render-tier and tier-conditional branch at one URL.
    const isPreview = mode === 'preview';
    const cols = isPreview ? item.w : GRID_COLS;
    const rows = isPreview ? item.h : GRID_ROWS;
    return `<div class="page" id="page" style="grid-template-rows:0px minmax(0,1fr) 0px"><div class="hdr-stub"></div><main class="body body-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},minmax(0,1fr))"><div class="cell cell-${escapeHtmlServer(item.widgetId)} ${extraClasses}" style="grid-column:1 / span ${cols};grid-row:1 / span ${rows};${typo}">${inner}</div></main><div class="ftr-stub"></div></div>`;
  }

  // Beam takeover: an active send-to-display message replaces the whole
  // grid until it expires. Big serif text (autofit), quiet mono footer
  // with the sent time — reads like a note left on the fridge.
  if (payload.beam && payload.beam.text) {
    const b = payload.beam;
    const sentAt = new Date(b.at || Date.now());
    let stamp = '';
    try {
      stamp = new Intl.DateTimeFormat('en-US', {
        timeZone: (cfg && cfg.timezone) || 'UTC', hour: 'numeric', minute: '2-digit'
      }).format(sentAt);
    } catch { /* bad tz — skip the stamp */ }
    return `<div class="page" id="page" style="grid-template-rows:0px minmax(0,1fr) 0px"><div class="hdr-stub"></div><main class="beam-page">
      <div class="beam-tag">MESSAGE</div>
      <div class="beam-text autofit multiline" data-min-font="18">${escapeHtmlServer(b.text)}</div>
      <div class="beam-foot">${stamp ? `sent ${escapeHtmlServer(stamp)}` : ''}</div>
    </main><div class="ftr-stub"></div></div>`;
  }

  // Normal dashboard mode. Header/footer chrome was removed in favor of
  // the text widget (bar variant); widgets now own the full 800×480 panel.
  const nowM = localMinutesNow((cfg && cfg.timezone) || 'UTC');
  const cells = [];
  for (const item of layout) {
    if (!withinVisibility(item.visibility, nowM)) continue;
    const itemCtx = ssr.buildTileCtx(item, { ...ctxBase, perItem }, defs[item.widgetId]);
    const innerRaw = ssr.renderWidget(item.widgetId, itemCtx);
    if (!innerRaw) continue;
    const sw = ssr.scaleWrap(item.settings);
    const inner = `${sw.open}${innerRaw}${sw.close}`;
    const classes = ssr.tileCellClasses(item, GRID_COLS, GRID_ROWS);
    const styleParts = [
      `grid-column:${item.x + 1} / span ${item.w}`,
      `grid-row:${item.y + 1} / span ${item.h}`
    ];
    const typo = ssr.typographyCss(item.settings);
    if (typo) styleParts.push(typo);
    cells.push(`<div class="${classes.join(' ')}" style="${styleParts.join(';')}">${inner}</div>`);
  }
  const bodyInner = cells.length
    ? cells.join('')
    : `<div class="empty terminal-empty" style="grid-column:1 / span ${GRID_COLS};grid-row:1 / span ${GRID_ROWS}">&gt; NO_WIDGETS_ENABLED</div>`;

  return `<div class="page" id="page" style="grid-template-rows:0px minmax(0, 1fr) 0px"><div class="hdr-stub"></div><main class="${bodyClass}" style="grid-template-columns:repeat(${GRID_COLS}, minmax(0, 1fr));grid-template-rows:repeat(${GRID_ROWS}, minmax(0, 1fr))">${bodyInner}</main><div class="ftr-stub"></div></div>`;
}

function renderPage({ payload, shell, ssr, mode }) {
  const body = buildPageBodyHtml({ payload, ssr, mode });
  const screen = payload && payload.screen != null ? String(payload.screen) : '';
  const units = (payload && payload.units) || 'F';
  const accent = payload && payload.cfg && payload.cfg.accent;
  let extraStyle = accent
    ? `<style>:root{--accent:${htmlAttr(accent)}}</style>`
    : '';
  // Preview mode: collapse the html/body/.page hardcoded 800×480 down
  // to the widget's actual cell pixel size so the iframe viewport
  // matches 1:1 instead of cropping a corner of the full dashboard.
  if (mode === 'preview' && payload && Array.isArray(payload.layout) && payload.layout[0]) {
    const item = payload.layout[0];
    const PX_W = SCREEN_W / 24, PX_H = SCREEN_H / 12;
    const pw = Math.round((item.w || 8) * PX_W);
    const ph = Math.round((item.h || 4) * PX_H);
    extraStyle += `<style>html,body,.page{width:${pw}px!important;height:${ph}px!important;overflow:hidden;}body{background:#fff;}.page{display:block!important;}main.body{width:${pw}px!important;height:${ph}px!important;}</style>`;
  }
  return shell
    .replace('<!--__BODY__-->', body)
    .replace('<!--__ACCENT__-->', extraStyle)
    .replace('<!--__AUTOFIT__-->', AUTOFIT_SCRIPT)
    .replace('data-screen=""', `data-screen="${htmlAttr(screen)}"`)
    .replace('data-units=""',  `data-units="${htmlAttr(units)}"`);
}

module.exports = {
  renderPage, buildPageBodyHtml,
  SCREEN_W, SCREEN_H, GRID_COLS, GRID_ROWS, AUTOFIT_SCRIPT,
};
