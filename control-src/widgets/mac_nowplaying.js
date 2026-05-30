// Mac · Now Playing — art + title + progress. Two layouts: horizontal
// (tiny / compact / standard) and stacked (extended / full) with
// optional time bookends flanking the cover art.

import { escapeHtml, fmtSec, pickTier, placeholder } from './_shared.js';

export const def = {
  id: 'mac_nowplaying',
  label: 'Mac · Now Playing',
  requires: 'mac_nowplaying',
  minSize: { w: 8, h: 4 },
  sizes: {
    S:   { w: 8,  h: 4 },
    M:   { w: 12, h: 5 },
    L:   { w: 16, h: 8 },
    XL:  { w: 24, h: 10 },
    XXL: { w: 24, h: 12 }
  },
  defaultSize: 'M',
  defaults: () => ({
    variant: 'time_bookends',
    fontScale: 1,
    padding: 14
  })
};

export function render({ macNowPlaying, cellW, cellH, density, settings }) {
  if (!macNowPlaying) return placeholder('NOW PLAYING', 'MAC OFFLINE', 'msg');
  const np = macNowPlaying;
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const stateIcon = np.isPlaying ? '▶' : '❚❚';
  const s = settings || {};
  const variant   = s.variant   || 'time_bookends';
  const fontScale = Number.isFinite(s.fontScale) ? s.fontScale : 1;
  const TIER_CFG = {
    tiny:     { art: 0,   maxFont: 20, showProgress: false, showSource: false, stacked: false },
    compact:  { art: 56,  maxFont: 26, showProgress: false, showSource: false, stacked: false },
    standard: { art: 80,  maxFont: 34, showProgress: true,  showSource: true,  stacked: false },
    extended: { art: 240, maxFont: 48, showProgress: true,  showSource: true,  stacked: true  },
    full:     { art: 320, maxFont: 64, showProgress: true,  showSource: true,  stacked: true  }
  };
  const cfg = TIER_CFG[tier] || TIER_CFG.standard;
  const artistAlbum = [np.artist, np.album].filter(Boolean).map(escapeHtml).join(' · ');
  const source = cfg.showSource && np.sourceLabel ? `via ${escapeHtml(np.sourceLabel)}` : '';
  const hasProgress = cfg.showProgress
    && Number.isFinite(np.durationSec) && np.durationSec > 0
    && Number.isFinite(np.elapsedSec);
  const pct = hasProgress
    ? Math.max(0, Math.min(100, (np.elapsedSec || 0) / np.durationSec * 100))
    : 0;
  const artInner = np.artworkBase64
    ? `<img class="mac-np-art" style="width:${cfg.art}px;height:${cfg.art}px" src="data:image/png;base64,${np.artworkBase64}" alt="" />`
    : `<div class="mac-np-art mac-np-art-empty" style="width:${cfg.art}px;height:${cfg.art}px">${stateIcon}</div>`;

  if (cfg.stacked) {
    const elapsedStr = hasProgress ? fmtSec(np.elapsedSec) : '';
    const remainStr  = hasProgress ? '−' + fmtSec(Math.max(0, np.durationSec - (np.elapsedSec || 0))) : '';
    const progressBar = hasProgress
      ? `<div class="mac-np-bar mac-np-bar-only"><div class="mac-np-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>`
      : '';
    const showBookends = variant !== 'centered';
    const maxFont = Math.max(14, Math.round(cfg.maxFont * fontScale));
    return `
      <div class="mac-np-card mac-np-stacked mac-np-tier-${tier} mac-np-var-${variant}">
        <div class="mac-np-head">
          <span class="col-title">NOW PLAYING</span>
        </div>
        <div class="mac-np-stacked-row">
          ${showBookends ? `<div class="mac-np-bookend mac-np-bookend-left">${elapsedStr}</div>` : ''}
          ${artInner}
          ${showBookends ? `<div class="mac-np-bookend mac-np-bookend-right">${remainStr}</div>` : ''}
        </div>
        <div class="mac-np-state-big">${stateIcon}</div>
        <div class="mac-np-stacked-text">
          <div class="mac-np-title autofit" data-min-font="14" data-max-font="${maxFont}">${escapeHtml(np.title)}</div>
          <div class="mac-np-meta">${artistAlbum || '—'}</div>
          ${source ? `<div class="mac-np-source">${source}</div>` : ''}
        </div>
        ${progressBar}
      </div>
    `;
  }

  const art = cfg.art === 0 ? '' : artInner;
  const progress = hasProgress
    ? `<div class="mac-np-progress">
         <div class="mac-np-bar"><div class="mac-np-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
         <div class="mac-np-time">${fmtSec(np.elapsedSec)} / ${fmtSec(np.durationSec)}</div>
       </div>`
    : '';
  return `
    <div class="mac-np-card mac-np-tier-${tier}">
      <div class="mac-np-head">
        <span class="mac-np-state">${stateIcon}</span>
        <span class="col-title">NOW PLAYING</span>
      </div>
      <div class="mac-np-body">
        ${art}
        <div class="mac-np-text">
          <div class="mac-np-title autofit" data-min-font="14" data-max-font="${cfg.maxFont}">${escapeHtml(np.title)}</div>
          <div class="mac-np-meta">${artistAlbum || '—'}</div>
          ${source ? `<div class="mac-np-source">${source}</div>` : ''}
        </div>
      </div>
      ${progress}
    </div>
  `;
}
