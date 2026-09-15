import React from 'react';
import { FEED_PRESETS } from './_feeds.js';

// Two fields, and that is the whole form. The prompt is the customization —
// everything cosmetic is the design's decision now. Cadence earns its place
// because it isn't taste: it trades money and battery (every generation is an
// API call, and new text means a 15-26s colour redraw on the panel).
export function Form({ values, patch, fields }) {
  const v = values || {};
  const { TextField, SelectField, ListEditor, FormSection } = fields;
  return (
    <>
      <FormSection title="Prompt">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          The dashboard's current data — weather, calendar, tasks, headlines,
          now playing, battery — is sent along with whatever you write here.
          Ask for what you actually want on the wall.
        </div>
        <TextField
          label="Prompt"
          value={v.prompt}
          onChange={(x) => patch({ prompt: x })}
          placeholder="Brief me on today in two short sentences."
          multiline
          help="e.g. “What should I wear today?” · “Summarize the headlines in three lines.” · “One sentence: what needs attention today?”"
        />
        <TextField
          label="Title"
          value={v.title}
          onChange={(x) => patch({ title: x })}
          placeholder="AI"
          help="Shown in the tile's header bar."
        />
      </FormSection>
      <FormSection title="Sources">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          The model has no web access. It only sees the dashboard's own data
          plus any feeds you add here, so naming a site in the prompt will not
          reach it &mdash; add the feed instead.
        </div>
        <div className="wsm-feed-presets">
          {FEED_PRESETS.map((f) => {
            const have = (Array.isArray(v.feedUrls) ? v.feedUrls : []).includes(f.url);
            return (
              <button
                key={f.url}
                type="button"
                className={`wsm-chip ${have ? 'is-on' : ''}`}
                title={f.url}
                onClick={() => {
                  const cur = Array.isArray(v.feedUrls) ? v.feedUrls : [];
                  // Toggle: clicking a chip that is already on removes it, so the
                  // chips are the whole interface for the common case and the list
                  // below is only needed for a feed that is not on it.
                  patch({ feedUrls: have ? cur.filter((u) => u !== f.url) : [...cur, f.url] });
                }}
              >{f.label}</button>
            );
          })}
        </div>
        <ListEditor
          replaceRow
          label="RSS / Atom feeds"
          items={Array.isArray(v.feedUrls) ? v.feedUrls : []}
          onChange={(items) => patch({ feedUrls: items })}
          blank=""
          addLabel="Add feed"
          help="Replaces the default news feed for this tile. e.g. https://news.google.com/rss"
          renderRow={(it, set) => (
            <input
              type="url"
              value={typeof it === 'string' ? it : ''}
              placeholder="https://example.com/rss"
              onChange={(e) => set(e.target.value)}
              style={{ flex: 1 }}
            />
          )}
        />
      </FormSection>
      <FormSection title="Refresh">
        <SelectField
          label="How often to regenerate"
          value={v.cadence || 'daily'}
          options={[
            { value: 'daily',  label: 'Daily — one generation each day' },
            { value: 'hourly', label: 'Hourly — costs more, redraws more' }
          ]}
          onChange={(x) => patch({ cadence: x })}
          help="Cached in between, so ordinary panel wakes cost nothing. New text triggers a full colour redraw (15-26s), so daily is kinder to the battery."
        />
      </FormSection>
    </>
  );
}
