// Pick which photo slide should render right now.
// cfg.photo.slides = [{ dataUrl }, ...]   (new)
// cfg.photo.rotateMinutes = N             (0 = no rotation, pick slide 0)
// cfg.photo.dataUrl = '...'               (legacy single slide)
// cfg.photo.fit = 'contain' | 'cover'
//
// Index = floor(epoch_min / rotateMinutes) mod slides.length.
// This is deterministic across requests within the same minute bucket
// so the dashboard + preview agree on which photo to show.
function resolvePhoto(cfg) {
  const p = (cfg && cfg.photo) || {};
  const slides = Array.isArray(p.slides) && p.slides.length
    ? p.slides
    : (p.dataUrl ? [{ dataUrl: p.dataUrl }] : []);
  if (!slides.length) return { dataUrl: '', fit: p.fit || 'contain', index: 0, total: 0 };
  const rotate = Number.isFinite(p.rotateMinutes) ? p.rotateMinutes : 0;
  let idx = 0;
  if (rotate > 0) {
    const epochMin = Math.floor(Date.now() / 60000);
    idx = Math.floor(epochMin / rotate) % slides.length;
  }
  const slide = slides[idx] || slides[0];
  return {
    dataUrl: slide.dataUrl || '',
    caption: slide.caption || '',
    fit: p.fit || 'contain',
    index: idx,
    total: slides.length
  };
}

module.exports = { resolvePhoto };
