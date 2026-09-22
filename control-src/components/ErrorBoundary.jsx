import React from 'react';
import { isChunkLoadError } from '../lazy-chunk.js';

// Catches render/lifecycle errors in a subtree and shows a fallback instead
// of unmounting the whole React tree (which blanks the editor to white). Used
// around the widget settings form + the app root, so one misbehaving form or
// widget can't take the entire control panel down.
//
// `resetKeys` — when any value in this array changes, the boundary clears its
// error and retries. The settings modal passes the widget id so reopening the
// modal on a different tile recovers automatically.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface it — console.error is captured by the server error ring in
    // prod and shows in devtools locally.
    console.error('ErrorBoundary caught:', error && (error.stack || error.message), info && info.componentStack);
  }

  componentDidUpdate(prevProps) {
    const a = prevProps.resetKeys || [];
    const b = this.props.resetKeys || [];
    if (this.state.error && (a.length !== b.length || a.some((v, i) => v !== b[i]))) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      // A chunk that 404s means this page is from a previous deploy, not that
      // anything is broken. lazy-chunk.js reloads once on its own; if we are
      // still here, that reload already happened and did not help — so say
      // what it is and offer the only action that can work.
      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="error-boundary-fallback">
            <div className="eb-title">This page is out of date</div>
            <div className="eb-msg">
              A new version of the control panel was deployed while this tab was open.
            </div>
            <button type="button" className="eb-retry" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        );
      }
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error, () => this.setState({ error: null }));
      }
      return this.props.fallback || (
        <div className="error-boundary-fallback">
          <div className="eb-title">Something went wrong here</div>
          <div className="eb-msg">{String(this.state.error.message || this.state.error)}</div>
          <button type="button" className="eb-retry" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
