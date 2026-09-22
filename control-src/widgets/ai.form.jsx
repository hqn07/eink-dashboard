import React from 'react';
import { buildForm } from './_schema.jsx';
import { FEED_PRESETS } from './_feeds.js';

// Two settings and a feed list, and that is the whole form. The prompt is the
// customization — everything cosmetic is the design's decision now. Cadence
// earns its place because it is not taste: it trades money and battery (every
// generation is an API call, and new text means a 15-26s colour redraw).

// One-tap chips for the common feeds. A chip that is already on removes its
// feed, so the chips are the entire interface for the usual case and the list
// below is only needed for a feed that is not on it.
function FeedChips({ values, patch }) {
  const cur = Array.isArray(values.feedUrls) ? values.feedUrls : [];
  return (
    <div className="wsm-feed-presets">
      {FEED_PRESETS.map((f) => {
        const have = cur.includes(f.url);
        return (
          <button
            key={f.url}
            type="button"
            className={`wsm-chip ${have ? 'is-on' : ''}`}
            title={f.url}
            onClick={() => patch({ feedUrls: have ? cur.filter(u => u !== f.url) : [...cur, f.url] })}
          >{f.label}</button>
        );
      })}
    </div>
  );
}

export const FIELDS = [
  {
    type: 'note', section: 'Prompt',
    text: "The dashboard's current data — weather, calendar, tasks, headlines, now playing, "
      + 'battery — is sent along with whatever you write here. Ask for what you actually '
      + 'want on the wall.'
  },
  {
    key: 'prompt', type: 'textarea', label: 'Prompt', section: 'Prompt', rows: 3,
    placeholder: 'Brief me on today in two short sentences.',
    help: 'e.g. “What should I wear today?” · “Summarize the headlines in three lines.” '
      + '· “One sentence: what needs attention today?”'
  },
  {
    key: 'title', type: 'text', label: 'Title', section: 'Prompt',
    placeholder: 'AI',
    help: "Shown in the tile's header bar."
  },
  {
    type: 'note', section: 'Sources',
    text: "The model has no web access. It only sees the dashboard's own data plus any feeds "
      + 'you add here, so naming a site in the prompt will not reach it — add the feed instead.'
  },
  { type: 'custom', section: 'Sources', render: (ctx) => <FeedChips values={ctx.values} patch={ctx.patch} /> },
  {
    key: 'feedUrls', type: 'list', label: 'RSS / Atom feeds', section: 'Sources',
    addLabel: 'Add feed', rowPlaceholder: 'https://example.com/rss',
    help: 'Replaces the default news feed for this tile. e.g. https://news.google.com/rss'
  },
  {
    key: 'cadence', type: 'select', label: 'How often to regenerate', section: 'Refresh',
    options: [
      { value: 'daily',  label: 'Daily — one generation each day' },
      { value: '12h',    label: 'Twice daily — every 12 hours' },
      { value: '6h',     label: 'Every 6 hours' },
      { value: '3h',     label: 'Every 3 hours' },
      { value: 'hourly', label: 'Hourly — costs most, redraws most' }
    ],
    help: 'Cached in between, so ordinary panel wakes cost nothing. New text triggers a full '
      + 'colour redraw (15-26s), so daily is kinder to the battery.'
  }
];

export const Form = buildForm(FIELDS);
