import React, { useState } from 'react';
import { buildForm } from './_schema.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import SaveFeedButton from '../components/SaveFeedButton.jsx';
import SavedFeedsManager from '../components/SavedFeedsManager.jsx';
import { useSavedFeeds } from '../components/saved-feeds-context.js';

// Appends a saved feed URL to the round-robin "extra feeds" list. Its own
// component because the form body cannot call hooks — TabbedForm calls that
// body as a plain function to read its sections.
function MyFeedPicker({ feedUrls, onAdd }) {
  const [pick, setPick] = useState('');
  const { feeds } = useSavedFeeds();
  if (!feeds.length) return null;
  const add = (url) => {
    if (url && !feedUrls.includes(url)) onAdd([...feedUrls, url]);
    setPick('');
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="wsm-field-label">Add from My feeds</div>
      <SearchableSelect
        value={pick}
        onChange={add}
        groups={[{ label: 'My feeds', items: feeds.map(f => ({ value: f.url, label: f.name, hint: 'Saved' })) }]}
        placeholder="— Pick a saved feed —"
        ariaLabel="Add saved feed"
      />
    </div>
  );
}

const sourceOf = (v) => (v.source === 'rss' || v.source === 'news' ? v.source : 'hn');

export const FIELDS = [
  {
    key: 'source', type: 'select', label: 'Source', section: 'Feed',
    options: [
      { value: 'news', label: 'News outlet' },
      { value: 'hn',   label: 'Hacker News' },
      { value: 'rss',  label: 'Custom RSS / Atom feed' }
    ]
  },
  {
    key: 'newsSource', type: 'select', label: 'Outlet', section: 'Feed',
    options: [
      { value: 'bbc',       label: 'BBC News' },
      { value: 'bbc_world', label: 'BBC World' },
      { value: 'nyt',       label: 'New York Times' },
      { value: 'guardian',  label: 'The Guardian' },
      { value: 'npr',       label: 'NPR News' },
      { value: 'aljazeera', label: 'Al Jazeera' }
    ],
    when: (v) => sourceOf(v) === 'news'
  },
  {
    key: 'hnFeed', type: 'select', label: 'Which stories', section: 'Feed',
    options: [
      { value: 'top',  label: 'Front page' },
      { value: 'best', label: 'Best' },
      { value: 'new',  label: 'Newest' }
    ],
    when: (v) => sourceOf(v) === 'hn'
  },
  {
    key: 'feedUrl', type: 'text', label: 'Feed URL', section: 'Feed',
    placeholder: 'https://feeds.bbci.co.uk/news/rss.xml',
    help: 'Any public RSS 2.0 / Atom / RSS 1.0 feed.',
    when: (v) => sourceOf(v) === 'rss'
  },
  {
    type: 'custom', section: 'Feed',
    when: (v) => sourceOf(v) === 'rss',
    render: (ctx) => (
      <div style={{ margin: '-2px 0 8px' }}>
        <SaveFeedButton url={ctx.values.feedUrl || ''} />
      </div>
    )
  },
  {
    type: 'custom', section: 'Feed', owns: ['feedUrls'],
    render: (ctx) => (
      <MyFeedPicker
        feedUrls={Array.isArray(ctx.values.feedUrls) ? ctx.values.feedUrls : []}
        onAdd={(arr) => ctx.patch({ feedUrls: arr })}
      />
    )
  },
  {
    key: 'feedUrls', type: 'csv', label: 'Extra feeds (URLs, comma-separated)', section: 'Feed',
    placeholder: 'https://…/rss.xml, https://…/atom.xml',
    help: 'Merged round-robin with the source above, so one tile interleaves several feeds.'
  },
  { type: 'custom', section: 'Feed', render: () => <SavedFeedsManager /> },
  { key: 'count', type: 'slider', label: 'Max items', section: 'Feed', min: 2, max: 12, step: 1 },
  { key: 'showAge', type: 'toggle', label: 'Show item age', section: 'Feed' },
  {
    key: 'title', type: 'text', label: 'Tile heading', section: 'Feed', tokens: true,
    placeholder: 'HEADLINES',
    help: 'Leave blank to keep the default heading.'
  }
];

export const Form = buildForm(FIELDS);
