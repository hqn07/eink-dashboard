// Mac · Now Playing — art + title + progress. Two layouts: horizontal
// (tiny / compact / standard) and stacked (extended / full). The
// stacked layout has a "side-space" slot on either side of the cover
// art whose contents are picked by the `variant` setting — time
// counters by default, or one of several decorative variants that
// turn the side gutters into texture instead.
//
// Contract v2 (widgets-refresh W2): the side-space options are declared
// as def.variants so the settings modal auto-renders the shared visual
// picker and the chosen name rides on ctx.variant. NOTE: variants only
// re-fill the bookend slots on stacked (extended/full) tiers — smaller
// tiles ignore variant and use the inline layout, so the picker
// thumbnails read alike at small sizes.

import { escapeHtml, fmtSec, pickTier, placeholder } from './_shared.js';

// What fills the bookend slots on each side of the cover art when the
// tile is large enough to stack (extended / full tier). Returns the
// raw HTML for the left + right slots; the render function drops them
// into `.mac-np-stacked-row`.
function sideSpaceSlots(variant, { np, elapsedStr, remainStr, stateIcon, titleLabel }) {
  switch (variant) {
    case 'centered':
      return { left: '', right: '' };
    case 'vertical_text':
      return {
        left:  `<div class="mac-np-bookend mac-np-bookend-vert mac-np-bookend-left">${escapeHtml(titleLabel)}</div>`,
        right: `<div class="mac-np-bookend mac-np-bookend-vert mac-np-bookend-right">${escapeHtml(titleLabel)}</div>`
      };
    case 'play_state':
      return {
        left:  `<div class="mac-np-bookend mac-np-bookend-glyph mac-np-bookend-left">${stateIcon}</div>`,
        right: `<div class="mac-np-bookend mac-np-bookend-glyph mac-np-bookend-right">${stateIcon}</div>`
      };
    case 'bars':
      // Six stacked dither bars per side. Pure decoration that survives
      // the 1-bit threshold without becoming noise.
      return {
        left:  `<div class="mac-np-bookend mac-np-bookend-bars mac-np-bookend-left"><span></span><span></span><span></span><span></span><span></span><span></span></div>`,
        right: `<div class="mac-np-bookend mac-np-bookend-bars mac-np-bookend-right"><span></span><span></span><span></span><span></span><span></span><span></span></div>`
      };
    case 'metadata': {
      const artist = escapeHtml(np.artist || '—');
      const albumOrSource = np.album
        ? `<span class="bookend-label">ALBUM</span><span class="bookend-value">${escapeHtml(np.album)}</span>`
        : np.sourceLabel
          ? `<span class="bookend-label">SOURCE</span><span class="bookend-value">${escapeHtml(np.sourceLabel)}</span>`
          : '<span class="bookend-label">—</span>';
      return {
        left:  `<div class="mac-np-bookend mac-np-bookend-meta mac-np-bookend-left"><span class="bookend-label">ARTIST</span><span class="bookend-value">${artist}</span></div>`,
        right: `<div class="mac-np-bookend mac-np-bookend-meta mac-np-bookend-right">${albumOrSource}</div>`
      };
    }
    case 'time_bookends':
    default:
      return {
        left:  `<div class="mac-np-bookend mac-np-bookend-left">${elapsedStr}</div>`,
        right: `<div class="mac-np-bookend mac-np-bookend-right">${remainStr}</div>`
      };
  }
}

export const def = {
  id: 'mac_nowplaying',
  label: 'Now Playing',
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
  variants: {
    time_bookends: { label: 'Time bookends — elapsed · remaining' }
  },
  defaultVariant: 'time_bookends',
  // The settings-modal variant picker renders each thumbnail at this
  // size instead of the live tile size — the side-space variants only
  // show on stacked (extended/full) tiers, so a small tile would make
  // every thumbnail look identical. 16×8 = the L stacked preset.
  variantThumb: { w: 16, h: 8 },
  // Advisory; the TIER_CFG table below is the source of truth. Variant
  // side-space only renders on the stacked (extended/full) tiers, so
  // it degrades out first as the tile shrinks.
  degrade: {
    standard: ['sidespace'],
    compact:  ['sidespace', 'progress', 'source'],
    tiny:     ['sidespace', 'progress', 'source', 'art']
  },
  defaults: () => ({
    title: '',
    variant: 'time_bookends',
    showAlbumArt:  true,
    artShape:      'square',   // 'square' | 'rounded' | 'circle' | 'none'
    showProgress:  true,
    showSource:    true,
    showStateIcon: true,
    showColTitle:  true,        // toggle the "NOW PLAYING" heading
    showSongTitle: true,        // toggle the song title line
    showArtist:    true,        // toggle the artist · album line
    headerAlign:   'left',      // 'left' | 'center' | 'right'
    artPosition:   'right',     // 'left' | 'right' (horizontal layout only)
    textAlign:     'left',      // 'left' | 'center' | 'right' (artist/title block)
    textOffsetY:   0,           // -120..+120 px vertical nudge for the text block
    fontScale: 1,
    padding: 14
  })
};

export function render(ctx) {
  const { macNowPlaying, cellW, cellH, density, settings } = ctx;
  const titleLabel = (settings && typeof settings.title === 'string' && settings.title.trim())
    ? settings.title.trim()
    : 'NOW PLAYING';
  if (!macNowPlaying) return placeholder(titleLabel, 'Mac offline', 'msg', { cellW, cellH }, 'offline');
  const np = macNowPlaying;
  const tier = pickTier(cellW || 0, cellH || 0, density);
  // Inline SVG instead of Unicode glyphs so the 1-bit threshold pass
  // can't shear the bars. Both shapes are solid black on white at any
  // size; `1em` sizing lets the surrounding CSS font-size scale them.
  const stateIcon = np.isPlaying
    ? '<svg class="mac-np-glyph" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M6 4l14 8-14 8z" fill="#000"/></svg>'
    : '<svg class="mac-np-glyph" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="6" y="4" width="5" height="16" fill="#000"/><rect x="13" y="4" width="5" height="16" fill="#000"/></svg>';
  const s = settings || {};
  // buildTileCtx resolves settings.variant → ctx.variant against
  // def.variants; fall back to the raw setting for direct render calls.
  const variant   = ctx.variant || s.variant || 'time_bookends';
  const fontScale = Number.isFinite(s.fontScale) ? s.fontScale : 1;
  const TIER_CFG = {
    tiny:     { art: 0,   maxFont: 20, showProgress: false, showSource: false, stacked: false },
    compact:  { art: 56,  maxFont: 26, showProgress: false, showSource: false, stacked: false },
    standard: { art: 80,  maxFont: 34, showProgress: true,  showSource: true,  stacked: false },
    extended: { art: 240, maxFont: 48, showProgress: true,  showSource: true,  stacked: true  },
    full:     { art: 320, maxFont: 64, showProgress: true,  showSource: true,  stacked: true  }
  };
  const cfg = TIER_CFG[tier] || TIER_CFG.standard;
  // Tile-level visibility toggles override the tier defaults. Tier
  // still gates upward (e.g. a tiny tile never shows the progress bar
  // even if the user enables it), but the toggle can hide an element
  // the tier would otherwise have shown.
  const artShape       = (s.artShape === 'rounded' || s.artShape === 'circle' || s.artShape === 'none')
                           ? s.artShape : 'square';
  const allowArt       = s.showAlbumArt !== false && artShape !== 'none';
  const allowProgress  = cfg.showProgress && s.showProgress !== false;
  const allowSource    = cfg.showSource   && s.showSource   !== false;
  const allowStateIcon = s.showStateIcon !== false;
  const allowColTitle  = s.showColTitle  !== false;
  const allowSongTitle = s.showSongTitle !== false;
  const allowArtist    = s.showArtist    !== false;
  const headerAlign    = s.headerAlign === 'center' || s.headerAlign === 'right' ? s.headerAlign : 'left';
  const textAlign      = s.textAlign   === 'center' || s.textAlign   === 'right' ? s.textAlign   : 'left';
  const artPosition    = s.artPosition === 'left' ? 'left' : 'right';
  // Clamp the user's slider to a sane range so they can't push the
  // text block out of the tile entirely.
  const textOffsetY    = Math.max(-120, Math.min(120, parseInt(s.textOffsetY, 10) || 0));
  const textOffsetStyle = textOffsetY ? `transform:translateY(${textOffsetY}px);` : '';
  // The horizontal layout puts art on one side and the text block on
  // the other. `art-right` (default) keeps the original layout; the
  // user can flip to `art-left` to swap which column the cover sits in.
  const bodyDirClass   = artPosition === 'left' ? 'mac-np-body-art-left' : 'mac-np-body-art-right';
  const artistAlbum = [np.artist, np.album].filter(Boolean).map(escapeHtml).join(' · ');
  const source = allowSource && np.sourceLabel ? `via ${escapeHtml(np.sourceLabel)}` : '';
  const hasProgress = allowProgress
    && Number.isFinite(np.durationSec) && np.durationSec > 0
    && Number.isFinite(np.elapsedSec);
  const pct = hasProgress
    ? Math.max(0, Math.min(100, (np.elapsedSec || 0) / np.durationSec * 100))
    : 0;
  const artSize = allowArt ? cfg.art : 0;
  const artShapeClass = `mac-np-art-shape-${artShape}`;
  const artInner = artSize === 0
    ? ''
    : (np.artworkBase64
      ? `<img class="mac-np-art ${artShapeClass}" style="width:${artSize}px;height:${artSize}px" src="data:image/png;base64,${np.artworkBase64}" alt="" />`
      : `<div class="mac-np-art mac-np-art-empty ${artShapeClass}" style="width:${artSize}px;height:${artSize}px">${stateIcon}</div>`);

  if (cfg.stacked) {
    const elapsedStr = hasProgress ? fmtSec(np.elapsedSec) : '';
    const remainStr  = hasProgress ? '−' + fmtSec(Math.max(0, np.durationSec - (np.elapsedSec || 0))) : '';
    const progressBar = hasProgress
      ? `<div class="mac-np-bar mac-np-bar-only"><div class="mac-np-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>`
      : '';
    const slots = sideSpaceSlots(variant, { np, elapsedStr, remainStr, stateIcon, titleLabel });
    const maxFont = Math.max(14, Math.round(cfg.maxFont * fontScale));
    return `
      <div class="mac-np-card mac-np-stacked mac-np-tier-${tier} mac-np-var-${variant} mac-np-text-${textAlign}">
        ${allowColTitle ? `<div class="mac-np-head mac-np-head-${headerAlign}">
          <span class="col-title">${escapeHtml(titleLabel)}</span>
        </div>` : ''}
        <div class="mac-np-stacked-row">
          ${slots.left}
          ${artInner}
          ${slots.right}
        </div>
        ${allowStateIcon ? `<div class="mac-np-state-big">${stateIcon}</div>` : ''}
        <div class="mac-np-stacked-text" style="${textOffsetStyle}">
          ${allowSongTitle ? `<div class="mac-np-title autofit" data-min-font="14" data-max-font="${maxFont}">${escapeHtml(np.title)}</div>` : ''}
          ${allowArtist ? `<div class="mac-np-meta">${artistAlbum || '—'}</div>` : ''}
          ${source ? `<div class="mac-np-source">${source}</div>` : ''}
        </div>
        ${progressBar}
      </div>
    `;
  }

  const art = artInner;
  const progress = hasProgress
    ? `<div class="mac-np-progress">
         <div class="mac-np-bar"><div class="mac-np-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
         <div class="mac-np-time">${fmtSec(np.elapsedSec)} / ${fmtSec(np.durationSec)}</div>
       </div>`
    : '';
  return `
    <div class="mac-np-card mac-np-tier-${tier} mac-np-text-${textAlign}">
      ${allowColTitle ? `<div class="mac-np-head mac-np-head-${headerAlign}">
        ${allowStateIcon ? `<span class="mac-np-state">${stateIcon}</span>` : ''}
        <span class="col-title">${escapeHtml(titleLabel)}</span>
      </div>` : ''}
      <div class="mac-np-body ${bodyDirClass}">
        ${art}
        <div class="mac-np-text" style="${textOffsetStyle}">
          ${allowSongTitle ? `<div class="mac-np-title autofit" data-min-font="14" data-max-font="${cfg.maxFont}">${escapeHtml(np.title)}</div>` : ''}
          ${allowArtist ? `<div class="mac-np-meta">${artistAlbum || '—'}</div>` : ''}
          ${source ? `<div class="mac-np-source">${source}</div>` : ''}
        </div>
      </div>
      ${progress}
    </div>
  `;
}
