// Content-Security-Policy support for the inline <script> blocks this server
// emits. Two exist and both are generated at require time from files on disk:
// the autofit pass (lib/ssr.js, inlined from control-src/autofit.js) and the
// dev hot-reload listener (routes/render-pages.js).
//
// Hashes rather than a nonce, because the content is fixed at startup — there
// is nothing per-request about it, and a nonce would mean rewriting the shell
// on every render. `allowInlineScript` returns its input so a call site can
// wrap the script it is already building and register the hash in one step,
// which is the only way to guarantee the two can't drift apart.
//
// This matters more than it looks: `script-src 'self'` silently blocked the
// autofit pass, text rendered at fallback metrics, and check:visual moved
// 0.347% — a real panel regression that no test other than the pixel diff
// would have caught.
const crypto = require('crypto');

const hashes = new Set();

// Register an inline script's content (WITHOUT the surrounding <script> tags —
// the browser hashes exactly the bytes between them) and return it unchanged.
function allowInlineScript(js) {
  const digest = crypto.createHash('sha256').update(js, 'utf8').digest('base64');
  hashes.add(`'sha256-${digest}'`);
  return js;
}

// Built per-request rather than once, so a route registered after the
// middleware still contributes its hash.
function scriptSrc() {
  return ["'self'", ...hashes].join(' ');
}

module.exports = { allowInlineScript, scriptSrc };
