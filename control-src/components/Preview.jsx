import React, { useEffect, useState } from 'react';

export default function Preview({ src, cacheKey, onRefresh }) {
  const [url, setUrl] = useState(`${src}&_=${cacheKey}`);

  useEffect(() => {
    setUrl(`${src}&_=${cacheKey}`);
  }, [src, cacheKey]);

  return (
    <>
      <img src={url} alt="dashboard preview" />
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
