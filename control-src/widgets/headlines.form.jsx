import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  const source = v.source === 'rss' ? 'rss' : 'hn';
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
            <option value="hn">Hacker News</option>
            <option value="rss">Custom RSS / Atom feed</option>
          </select>
        </label>
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
          <TextField
            label="Feed URL"
            value={v.feedUrl || ''}
            defaultValue={defaults.feedUrl}
            onChange={(x) => patch({ feedUrl: x })}
            placeholder="https://feeds.bbci.co.uk/news/rss.xml"
            help="Any public RSS 2.0 / Atom / RSS 1.0 feed."
          />
        )}
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
          onChange={(x) => patch({ title: x })}
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
