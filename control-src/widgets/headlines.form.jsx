import React, { useState } from 'react';
import SearchableSelect from '../components/SearchableSelect.jsx';
import SaveFeedButton from '../components/SaveFeedButton.jsx';
import SavedFeedsManager from '../components/SavedFeedsManager.jsx';
import { useSavedFeeds } from '../components/saved-feeds-context.js';

// Appends a saved feed URL to the round-robin "extra feeds" list. Lives in
// its own component because the pure Form body can't call hooks.
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

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, CsvField, TypographyFields, FormSection, defaults = {} } = fields;
  const source = (v.source === 'rss' || v.source === 'news') ? v.source : 'hn';
  const feedUrls = Array.isArray(v.feedUrls) ? v.feedUrls : [];
  return (
    <>
      <FormSection title="Feed">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Source
          <select
            value={source}
            onChange={(e) => patch({ source: e.target.value })}
            style={{ width: 220 }}
          >
            <option value="news">News outlet</option>
            <option value="hn">Hacker News</option>
            <option value="rss">Custom RSS / Atom feed</option>
          </select>
        </label>
        {source === 'news' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            Outlet
            <select
              value={v.newsSource || 'bbc'}
              onChange={(e) => patch({ newsSource: e.target.value })}
              style={{ width: 220 }}
            >
              <option value="bbc">BBC News</option>
              <option value="bbc_world">BBC World</option>
              <option value="nyt">New York Times</option>
              <option value="guardian">The Guardian</option>
              <option value="npr">NPR News</option>
              <option value="aljazeera">Al Jazeera</option>
            </select>
          </label>
        )}
        {source === 'hn' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            Which stories
            <select
              value={v.hnFeed || 'top'}
              onChange={(e) => patch({ hnFeed: e.target.value })}
              style={{ width: 220 }}
            >
              <option value="top">Front page</option>
              <option value="best">Best</option>
              <option value="new">Newest</option>
            </select>
          </label>
        )}
        {source === 'rss' && (
          <>
            <TextField
              label="Feed URL"
              value={v.feedUrl || ''}
              defaultValue={defaults.feedUrl}
              onChange={(x) => patch({ feedUrl: x })}
              placeholder="https://feeds.bbci.co.uk/news/rss.xml"
              help="Any public RSS 2.0 / Atom / RSS 1.0 feed."
            />
            <div style={{ margin: '-2px 0 8px' }}>
              <SaveFeedButton url={v.feedUrl || ''} />
            </div>
          </>
        )}
        <MyFeedPicker feedUrls={feedUrls} onAdd={(arr) => patch({ feedUrls: arr })} />
        <CsvField
          label="Extra feeds (URLs, comma-separated)"
          value={v.feedUrls || []}
          defaultValue={defaults.feedUrls}
          onCommit={(arr) => patch({ feedUrls: arr })}
          placeholder="https://…/rss.xml, https://…/atom.xml"
          help="Merged round-robin with the source above, so one tile interleaves several feeds."
        />
        <SavedFeedsManager />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Max items ({Number.isFinite(v.count) ? v.count : 6})
          <input
            type="range" min={2} max={12} step={1}
            value={Number.isFinite(v.count) ? v.count : 6}
            onChange={(e) => patch({ count: parseInt(e.target.value, 10) })}
            style={{ width: 220 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={v.showAge !== false}
            onChange={(e) => patch({ showAge: e.target.checked })}
          />
          Show item age
        </label>
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="Leave blank to use the feed name"
          help="Optional override for the title bar."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
