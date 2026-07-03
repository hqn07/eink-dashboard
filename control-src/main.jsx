import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

// Top-level backstop: if anything escapes the inner boundaries, show a
// recoverable message instead of a blank white page.
createRoot(document.getElementById('root')).render(
  <ErrorBoundary
    fallback={(err, retry) => (
      <div className="error-boundary-fallback error-boundary-root">
        <div className="eb-title">The control panel hit an error</div>
        <div className="eb-msg">{String(err.message || err)}</div>
        <button type="button" className="eb-retry" onClick={retry}>Reload view</button>
      </div>
    )}
  >
    <App />
  </ErrorBoundary>
);
