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
  const maxW = el.clientWidth;
  const maxH = el.clientHeight;
  if (maxW <= 0 || maxH <= 0) return;
  const minFont = Math.max(8, parseInt(el.getAttribute('data-min-font') || '11', 10));
  const maxFont = Math.max(minFont, parseInt(el.getAttribute('data-max-font') || '260', 10));
  let lo = minFont, hi = maxFont;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.style.fontSize = mid + 'px';
    if (el.scrollWidth <= maxW + 1 && el.scrollHeight <= maxH + 1) lo = mid;
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
