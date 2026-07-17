import React, { useState } from 'react';
import { Check, BookmarkSimple } from '@phosphor-icons/react';
import { useSavedFeeds, deriveFeedName } from './saved-feeds-context.js';

// Inline "save this URL to My feeds" affordance rendered next to a feed
// URL input. Three states:
//   already saved  — static "Saved" chip (no re-save)
//   idle           — bookmark button; click reveals the namer
//   naming         — tiny name input + confirm; commits to the library
// Only renders for well-formed http(s)/webcal URLs so junk rows stay quiet.
function isFeedUrl(url) {
  const s = String(url || '').trim();
  if (!s) return false;
  try {
    const u = new URL(s.replace(/^webcal:/i, 'https:'));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

export default function SaveFeedButton({ url }) {
  const { feeds, addFeed } = useSavedFeeds();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const clean = String(url || '').trim();

  if (!isFeedUrl(clean)) return null;

  const existing = feeds.find(f => f.url === clean);
  if (existing) {
    return (
      <span className="feed-save feed-save-done" title={`Saved as “${existing.name}”`}>
        <Check size={11} weight="bold" /> Saved
      </span>
    );
  }

  const start = () => { setName(deriveFeedName(clean)); setNaming(true); };
  const commit = () => {
    const n = name.trim() || deriveFeedName(clean);
    addFeed(n, clean);
    setNaming(false);
    setName('');
  };

  if (naming) {
    return (
      <span className="feed-save feed-save-naming">
        <input
          type="text"
          value={name}
          autoFocus
          placeholder="Name this feed"
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setNaming(false); setName(''); }
          }}
        />
        <button type="button" className="feed-save-ok" onClick={commit} title="Save to My feeds">
          <Check size={11} weight="bold" />
        </button>
      </span>
    );
  }

  return (
    <button type="button" className="feed-save feed-save-btn" onClick={start} title="Save to My feeds">
      <BookmarkSimple size={11} weight="bold" /> Save
    </button>
  );
}
