import React, { useEffect, useRef, useState } from 'react';

// Renders the dashboard preview image with a placeholder overlay that
// stays on top until the image fires `load` (or the render takes too
// long). The <img> is kept in the DOM the whole time so its request
// actually fires — `display: none` prevented it in older revs.
export default function Preview({ src, cacheKey, onRefresh }) {
  const [state, setState] = useState('loading'); // loading | ready | error
  const url = `${src}&_=${cacheKey}`;

  useEffect(() => {
    setState('loading');
    // Hard fallback: if we never get onload after 15s, treat as ready
    // anyway so the placeholder doesn't get stuck.
    const id = setTimeout(() => {
      setState(s => s === 'loading' ? 'ready' : s);
    }, 15000);
    return () => clearTimeout(id);
  }, [url]);

  return (
    <>
      <div className="preview-frame">
        <img
          key={url}
          src={url}
          alt="dashboard preview"
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
        {state !== 'ready' && (
          <div className="preview-placeholder">
            {state === 'loading' ? '> RENDERING...' : '> ERROR LOADING PREVIEW'}
          </div>
        )}
      </div>
      <div className="preview-meta">
        <span>LIVE PREVIEW · 800×480</span>
        <button
          className="btn"
          onClick={onRefresh}
          style={{ fontSize: 10, padding: '4px 10px' }}
        >
          ↻ REFRESH
        </button>
      </div>
    </>
  );
}
