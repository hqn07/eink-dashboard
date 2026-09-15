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
  el.style.fontSize = lo + 'px';
}

// Run the pass over every `.autofit` element under `root` (default document).
export function runAutofit(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope) return;
  scope.querySelectorAll('.autofit').forEach(autofitText);
}
