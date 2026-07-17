import React, { useState } from 'react';
import { Trash, PencilSimple, Check } from '@phosphor-icons/react';
import { useSavedFeeds } from './saved-feeds-context.js';

// Compact editor for the cross-widget feed library. Lets the user rename
// or delete anything they saved via SaveFeedButton so the "My feeds"
// picker doesn't accumulate junk. Rendered inside a Collapsible in the
// calendar / headlines forms; returns null when the library is empty.
export default function SavedFeedsManager() {
  const { feeds, removeFeed, renameFeed } = useSavedFeeds();
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState('');

  if (!feeds.length) return null;

  const startEdit = (f) => { setEditId(f.id); setDraft(f.name); };
  const commit = (id) => {
    const n = draft.trim();
    if (n) renameFeed(id, n);
    setEditId(null);
    setDraft('');
  };

  return (
    <div className="saved-feeds-mgr">
      <div className="wsm-field-label" style={{ marginTop: 10 }}>My feeds ({feeds.length})</div>
      <div className="wsm-field-help" style={{ marginBottom: 6 }}>
        Reusable on any calendar or headlines widget. Rename or remove here.
      </div>
      {feeds.map(f => (
        <div className="saved-feeds-row" key={f.id}>
          {editId === f.id ? (
            <input
              type="text"
              value={draft}
              autoFocus
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(f.id); }
                if (e.key === 'Escape') { setEditId(null); setDraft(''); }
              }}
              onBlur={() => commit(f.id)}
              style={{ flex: 1 }}
            />
          ) : (
            <span className="saved-feeds-name" title={f.url}>{f.name}</span>
          )}
          {editId === f.id ? (
            <button type="button" className="saved-feeds-ico" onClick={() => commit(f.id)} title="Save name">
              <Check size={13} weight="bold" />
            </button>
          ) : (
            <button type="button" className="saved-feeds-ico" onClick={() => startEdit(f)} title="Rename">
              <PencilSimple size={13} />
            </button>
          )}
          <button type="button" className="saved-feeds-ico saved-feeds-del" onClick={() => removeFeed(f.id)} title="Remove from library">
            <Trash size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
