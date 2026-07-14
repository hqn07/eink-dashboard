import { escapeHtml, pickTier, placeholder } from './_shared.js';

// Photo — shows a user image Floyd–Steinberg dithered to 1-bit so it reads
// as real greyscale on the panel (stippled, not a hard threshold that
// flattens photos to blobs). The dither happens server-side in
// widgets/photo.js (async sharp) and arrives as ctx.photo.src — a data:
// URI sized to the tile. render() just places it; when there's no image
// (or the fetch failed) it shows an "Add a photo" placeholder.
//
// Contract v2 variants —
//   full    — image fills the tile, edge to edge (default)
//   framed  — dithered border + optional caption below (gallery look)
//   caption — image with a caption band across the bottom

export const def = {
  id: 'photo',
  label: 'Photo',
  requires: null,
  minSize: { w: 6, h: 4 },
  sizes: {
    S:  { w: 6,  h: 4 },
    M:  { w: 10, h: 7 },
    L:  { w: 16, h: 10 },
    XL: { w: 24, h: 12 }
  },
  defaultSize: 'M',
  variants: {
    full:    { label: 'Full — edge to edge' },
    framed:  { label: 'Framed — dithered border + caption' },
    caption: { label: 'Caption — caption band overlay' }
  },
  defaultVariant: 'full',
  degrade: {
    tiny: ['caption', 'title']
  },
  defaults: () => ({
    variant: 'full',
    imageUrl: '',        // remote http(s) image
    imageUrls: [],       // rotation list — cycles every ~30 min (refresh-aligned)
    imageData: '',       // fresh upload (data: URI) — externalized to imageRef on save
    imageRef: '',        // server-side upload file ref (DATA_DIR/uploads)
    fit: 'cover',        // 'cover' | 'contain'
    dither: 'atkinson',  // 'atkinson' | 'fs' | 'threshold'
    brightness: 0,       // -100..100
    contrast: 0,         // -100..100
    caption: '',
    title: '',
    fontScale: 1,
    padding: 0
  })
};

export function render(ctx) {
  const { photo, settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const src = photo && photo.src;
  if (!src) {
    const hasSource = (s.imageUrl && s.imageUrl.trim()) || (s.imageData && s.imageData.trim()) || (s.imageRef && s.imageRef.trim()) || (Array.isArray(s.imageUrls) && s.imageUrls.filter(Boolean).length);
    return placeholder('PHOTO', hasSource ? 'Image failed' : 'Add a photo', 'msg', { cellW, cellH }, hasSource ? 'nodata' : 'setup');
  }

  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'full');
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const objFit = s.fit === 'contain' ? 'contain' : 'cover';
  const img = `<img class="photo-img" src="${src}" alt="" `
    + `style="object-fit:${objFit}" draggable="false">`;

  const capText = (s.caption && s.caption.trim() && tier !== 'tiny') ? s.caption.trim() : '';

  if (variant === 'caption') {
    return `<div class="photo photo-caption">
      <div class="photo-frame">${img}</div>
      ${capText ? `<div class="photo-cap-band">${escapeHtml(capText)}</div>` : ''}
    </div>`;
  }

  if (variant === 'framed') {
    const titleLabel = (typeof s.title === 'string' && s.title.trim() && tier !== 'tiny')
      ? s.title.trim() : '';
    return `<div class="photo photo-framed">
      ${titleLabel ? `<div class="col-title">${escapeHtml(titleLabel)}</div>` : ''}
      <div class="photo-frame photo-frame-border face-frame face-frame-g50">${img}</div>
      ${capText ? `<div class="photo-cap">${escapeHtml(capText)}</div>` : ''}
    </div>`;
  }

  // full
  return `<div class="photo photo-full"><div class="photo-frame">${img}</div></div>`;
}
