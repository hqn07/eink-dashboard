import React from 'react';
import { Warning } from '@phosphor-icons/react';

// One line answering "why does my dashboard look wrong?"
//
// Renders nothing when nothing is wrong — an always-present status bar that
// usually says "all good" trains people to stop reading it, and then it is
// not there when it matters.
//
// Each item is a button: tile problems open that tile's settings, which is
// where the fix is. The panel item is not clickable because there is nothing
// to click — the device is asleep or unreachable, and the honest response is
// to say so, not to offer a button that cannot help.
export default function AttentionStrip({ items, onFixTile }) {
  const list = items || [];
  if (!list.length) return null;

  return (
    <div className="attention-strip" role="status">
      <Warning size={13} weight="bold" className="attention-icon" />
      <span className="attention-count">
        {list.length === 1 ? '1 thing needs attention' : `${list.length} things need attention`}
      </span>
      <span className="attention-items">
        {list.map((it, i) => (
          <React.Fragment key={it.itemId || `${it.widgetId}-${i}`}>
            {i > 0 && <span className="attention-sep">·</span>}
            {it.itemId ? (
              <button
                type="button"
                className="attention-item"
                onClick={() => onFixTile && onFixTile(it.itemId)}
                title={it.hint ? `${it.label} — ${it.hint}` : it.label}
              >
                {it.label}{it.hint ? ` — ${it.hint}` : ''}
              </button>
            ) : (
              <span className="attention-item attention-item-static">
                {it.label}{it.hint ? ` — ${it.hint}` : ''}
              </span>
            )}
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}
