import React, { useEffect, useState } from 'react';

// Per-instance widget-data forms. Stage 2 ships bespoke forms for
// the high-value widgets (news, stocks, github, fx, sports, message,
// wod). Others render a placeholder until later stages.
//
// Contract: { widgetId, values, onChange }.
//  - `values` is the per-instance settings object (matches the same
//     shape the global cfg.<widget> already has, so snapshots from
//     global are drop-in).
//  - `onChange(patch)` shallow-merges the patch into values.

const PER_INSTANCE_SUPPORTED = new Set([
  'news', 'stocks', 'github', 'fx', 'sports', 'message', 'wod'
]);

export function supportsPerInstance(widgetId) {
  return PER_INSTANCE_SUPPORTED.has(widgetId);
}

// Snapshot the relevant subset of global cfg for this widget id.
// Used when the user flips "Override global" on for the first time.
export function snapshotGlobalForWidget(widgetId, cfg) {
  if (!cfg) return {};
  switch (widgetId) {
    case 'news':    return { ...(cfg.news    || {}) };
    case 'stocks':  return { ...(cfg.stocks  || {}) };
    case 'github':  return { ...(cfg.github  || {}) };
    case 'fx':      return { ...(cfg.fx      || {}) };
    case 'sports':  return { ...(cfg.sports  || {}) };
    case 'message': return { ...(cfg.message || {}) };
    case 'wod':     return { ...(cfg.wod     || {}) };
    default:        return {};
  }
}

function TextField({ label, value, onChange, placeholder, type = 'text', help }) {
  return (
    <label className="wsm-field">
      <span className="wsm-field-label">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(type === 'number'
          ? (e.target.value === '' ? null : Number(e.target.value))
          : e.target.value)}
        placeholder={placeholder || ''}
      />
      {help && <span className="wsm-field-help">{help}</span>}
    </label>
  );
}

// Comma-separated list editor with a focus/blur commit so users can
// type freely without re-tokenization on every keystroke.
function CsvField({ label, value, onCommit, placeholder, help }) {
  const joined = (value || []).join(', ');
  const [raw, setRaw] = useState(joined);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setRaw(joined); }, [joined, focused]);
  const commit = () => {
    const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
    setRaw(arr.join(', '));
    onCommit(arr);
  };
  return (
    <label className="wsm-field">
      <span className="wsm-field-label">{label}</span>
      <input
        type="text"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        placeholder={placeholder || ''}
      />
      {help && <span className="wsm-field-help">{help}</span>}
    </label>
  );
}

export default function WidgetForm({ widgetId, values, onChange }) {
  const v = values || {};
  const patch = (p) => onChange({ ...v, ...p });

  switch (widgetId) {
    case 'news':
      return (
        <>
          <TextField
            label="RSS / Atom feed URL"
            value={v.feedUrl}
            onChange={(x) => patch({ feedUrl: x })}
            placeholder="https://feeds.bbci.co.uk/news/world/rss.xml"
            help="Any RSS or Atom feed. Headlines refresh every ~15 min."
          />
          <TextField
            label="Max headlines"
            type="number"
            value={v.maxItems ?? 5}
            onChange={(x) => patch({ maxItems: Math.max(1, Math.min(20, x || 5)) })}
            help="Tile may show fewer based on size + density."
          />
        </>
      );

    case 'stocks':
      return (
        <CsvField
          label="Symbols (comma separated)"
          value={v.symbols}
          onCommit={(arr) => patch({ symbols: arr })}
          placeholder="AAPL, BTC-USD, ETH-USD"
          help="Yahoo Finance tickers. Crypto: e.g. BTC-USD."
        />
      );

    case 'github':
      return (
        <TextField
          label="GitHub username"
          value={v.user}
          onChange={(x) => patch({ user: x })}
          placeholder="torvalds"
          help="Public contribution graph for this user."
        />
      );

    case 'fx':
      return (
        <CsvField
          label="Currency pairs"
          value={v.pairs}
          onCommit={(arr) => patch({ pairs: arr })}
          placeholder="USD/EUR, USD/JPY, EUR/GBP"
          help="Format BASE/QUOTE. ECB reference rates."
        />
      );

    case 'sports':
      return (
        <TextField
          label="ESPN team ID"
          value={v.teamId}
          onChange={(x) => patch({ teamId: x })}
          placeholder="bos"
          help="Three-letter ESPN team abbreviation (e.g. bos, lal, dal)."
        />
      );

    case 'wod':
      return (
        <TextField
          label="RSS feed URL (blank = Wiktionary default)"
          value={v.feedUrl}
          onChange={(x) => patch({ feedUrl: x })}
          placeholder="https://en.wiktionary.org/w/api.php?action=featuredfeed&feed=wotd&feedformat=rss"
        />
      );

    case 'message':
      return (
        <>
          <TextField
            label="Headline"
            value={v.text}
            onChange={(x) => patch({ text: x })}
            placeholder="Today's message…"
            help="Markdown supported: **bold**, *italic*."
          />
          <TextField
            label="Subtitle"
            value={v.subtitle}
            onChange={(x) => patch({ subtitle: x })}
            placeholder="Optional second line"
          />
        </>
      );

    default:
      return (
        <div className="wsm-placeholder">
          <p className="wsm-note">
            Per-instance settings for <strong>{widgetId}</strong> aren't
            wired yet. This tile uses the shared global settings.
          </p>
        </div>
      );
  }
}
