// Shared fetch wrapper with a hard timeout. Every external HTTP call
// the widgets make must go through this so a slow upstream can't hang
// the Railway dyno's render queue.
const DEFAULT_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

module.exports = { fetchWithTimeout, DEFAULT_TIMEOUT_MS };
