// Single source of truth for the `.autofit` font-fit pass — binary-search
// the largest font-size that lets an element's content fit its own box.
//
// Consumed two ways so the panel and the editor size text identically
// (they used to drift — one copy hardcoded hi=260 and ignored
// data-max-font):
//   • React editor / preview import { autofitText, runAutofit } directly.
//   • The SSR dashboard page: server.js reads THIS file, strips the
//     `export` keywords, and injects the source into the screenshotted
//     HTML (see loadDashboardHtml / __AUTOFIT__). Keep this file
//     dependency-free and environment-agnostic (no imports, no top-level
//     DOM access) so both paths can consume it verbatim.

export function autofitText(el) {
  if (!el) return;
  // Measure against the space AVAILABLE, not the space taken. A nowrap flex
  // item sizes to its own content, so el.clientWidth grows with the text and
  // every font size trivially "fits" itself — the text bar measured 270px
  // inside a 229px parent and autofit happily left it overflowing. Capping by
  // the parent's box makes the constraint real.
  const parent = el.parentElement;
  const parentW = parent ? parent.clientWidth : 0;
  const ownW = el.clientWidth;
  const maxW = parentW > 0 ? Math.min(ownW || parentW, parentW) : ownW;
  const maxH = el.clientHeight;
  if (maxW <= 0) return;
  // A single-line element often has no definite height — it is sized BY its
  // text, so clientHeight is 0 until the font is set. Bailing out there meant
  // it was never fitted at all and kept whatever inline size the render
  // guessed, which is how the text bar came to overrun its tile by 34px.
  // Width alone is a sufficient constraint for one line.
  //
  // Wrapping elements are different: with no height limit, a narrower font
  // just wraps to more lines, so every size "fits" and the binary search is
  // meaningless. Those still bail.
  const wraps = el.classList.contains('multiline');
  const hCap = maxH > 0 ? maxH : (wraps ? 0 : Infinity);
  if (hCap <= 0) return;
  const minFont = Math.max(8, parseInt(el.getAttribute('data-min-font') || '11', 10));
  const maxFont = Math.max(minFont, parseInt(el.getAttribute('data-max-font') || '260', 10));
  let lo = minFont, hi = maxFont;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.style.fontSize = mid + 'px';
    if (el.scrollWidth <= maxW + 1 && el.scrollHeight <= hCap + 1) lo = mid;
    else hi = mid - 1;
  }
  el.style.fontSize = snapToLadder(lo, minFont) + 'px';
}

// The type ladder, shared with the CSS tokens in face-css/260-page-rhythm.css.
// Steps are ~1.25x and every value clears the 11px 1-bit floor that lint:eink
// enforces.
//
// WHY SNAP AT ALL. The binary search returns the largest size that fits, which
// is a different arbitrary number in every tile — one screen measured 11, 12,
// 13, 16, 18, 22, 24, 36, 52, 80 and 86 px across 32 pieces of text. Sizes
// that are merely *close* read as a mistake rather than as hierarchy: two
// headlines at 52 and 56 look like a bug, at 50 and 50 they look like a
// system. Fitting is still the constraint — this only ever rounds DOWN, so a
// snapped element fits wherever the searched one did.
const TYPE_LADDER = [11, 13, 16, 20, 25, 32, 40, 50, 64, 80, 100, 128, 160, 200, 260];

export function snapToLadder(px, floor) {
  const min = Number.isFinite(floor) ? floor : 11;
  // Below the floor the fit constraint wins outright: a tile that can only
  // hold 9px gets 9px, because rounding UP to a rung would overflow it and an
  // overflow on a fixed 800x480 panel draws over the neighbouring tile.
  if (px < min) return px;
  let best = null;
  for (const step of TYPE_LADDER) {
    if (step <= px) best = step;
  }
  return best == null ? px : best;
}

// Run the pass over every `.autofit` element under `root` (default document).
export function runAutofit(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope) return;
  scope.querySelectorAll('.autofit').forEach(autofitText);
}
