// Loaders for the two inputs the SSR renderer needs: the dashboard.html shell
// (mtime-cached so dev edits hot-apply) and the compiled per-widget render
// bundle (control-src/widgets/_ssr.js, dynamically imported as ESM and cached).
// Kept separate from lib/ssr.js because these do I/O and are also consumed by
// the preview/dev routes directly.
const fsp = require('fs/promises');
const path = require('path');

const DASHBOARD_HTML_PATH = path.join(__dirname, '..', 'public', 'dashboard.html');
let _htmlCache = null; // { mtimeMs, html }

async function loadDashboardHtml() {
  const st = await fsp.stat(DASHBOARD_HTML_PATH);
  if (_htmlCache && _htmlCache.mtimeMs === st.mtimeMs) return _htmlCache.html;
  const html = await fsp.readFile(DASHBOARD_HTML_PATH, 'utf8');
  _htmlCache = { mtimeMs: st.mtimeMs, html };
  return html;
}

let _ssrPromise = null;
function loadSsr() {
  if (!_ssrPromise) _ssrPromise = import('../control-src/widgets/_ssr.js');
  return _ssrPromise;
}

module.exports = { loadSsr, loadDashboardHtml, DASHBOARD_HTML_PATH };
