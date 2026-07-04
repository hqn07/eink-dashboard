// Small HTTP helpers shared across routes.
const { IS_PROD } = require('./env');

// Generic error body so we don't leak internals (file paths, upstream API
// failure URLs) to anyone hitting the public endpoints. The full error still
// reaches the server log via the caller's console.error.
function safeError(err) {
  if (IS_PROD) return { error: 'internal_error' };
  return { error: err && err.message ? err.message : String(err) };
}

module.exports = { safeError };
