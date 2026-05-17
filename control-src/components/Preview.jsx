import React, { useEffect, useRef, useState } from 'react';

// Renders the dashboard preview image with a loading placeholder so the
// card never collapses to zero height while the server warms its
// Puppeteer browser.
export default function Preview({ src, cacheKey, onRefresh }) {
  const [url, setUrl] = useState(`${src}&_=${cacheKey}`);
  const [state, setState] = useState('loading'); // loading | ready | error
  const imgRef = useRef(null);

  useEffect(() => {
    setUrl(`${src}&_=${cacheKey}`);
    setState('loading');
  }, [src, cacheKey]);

  return (
    <>
      <div className="preview-frame">
        {state !== 'ready' && (
          <div className="preview-placeholder">
            {state === 'loading' ? '> RENDERING...' : '> ERROR LOADING PREVIEW'}
          </div>
        )}
        <img
          ref={imgRef}
          src={url}
          alt="dashboard preview"
          style={{ display: state === 'ready' ? 'block' : 'none' }}
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
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
