import React from 'react';

const PRESETS = [
  { id: 'default',  label: 'Default — time bookends',
    values: { variant: 'time_bookends', showAlbumArt: true, showProgress: true, showSource: true, fontScale: 1 } },
  { id: 'minimal', label: 'Minimal — no source, centered',
    values: { variant: 'centered',      showAlbumArt: true, showProgress: true, showSource: false, fontScale: 1 } },
  { id: 'bold',    label: 'Bold — big play glyph, no progress',
    values: { variant: 'play_state',    showAlbumArt: true, showProgress: false, showSource: false, fontScale: 1.1 } },
  { id: 'art_off', label: 'No art — text-only card',
    values: { variant: 'time_bookends', showAlbumArt: false, showProgress: true, showSource: true, fontScale: 1 } }
];

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const {
    TextField, SelectField, SegmentedField, ToggleField, SliderField,
    FormSection, Collapsible, PresetField, defaults = {}
  } = fields;
  return (
    <>
      <FormSection title="Content">
        <PresetField presets={PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="NOW PLAYING"
          help="Leave blank to keep the default heading."
        />
        <ToggleField
          label='"NOW PLAYING" heading'
          value={v.showColTitle !== false}
          defaultValue={defaults.showColTitle}
          onChange={(x) => patch({ showColTitle: x })}
        />
        <ToggleField
          label="Song title"
          value={v.showSongTitle !== false}
          defaultValue={defaults.showSongTitle}
          onChange={(x) => patch({ showSongTitle: x })}
        />
        <ToggleField
          label="Artist · album line"
          value={v.showArtist !== false}
          defaultValue={defaults.showArtist}
          onChange={(x) => patch({ showArtist: x })}
        />
        <ToggleField
          label="Album art"
          value={v.showAlbumArt !== false}
          defaultValue={defaults.showAlbumArt}
          onChange={(x) => patch({ showAlbumArt: x })}
        />
        <ToggleField
          label="Progress bar + elapsed time"
          value={v.showProgress !== false}
          defaultValue={defaults.showProgress}
          onChange={(x) => patch({ showProgress: x })}
        />
        <ToggleField
          label="Source label (via SPOTIFY / YT MUSIC)"
          value={v.showSource !== false}
          defaultValue={defaults.showSource}
          onChange={(x) => patch({ showSource: x })}
        />
        <ToggleField
          label="Play / pause glyph (▶ / ❚❚)"
          value={v.showStateIcon !== false}
          defaultValue={defaults.showStateIcon}
          onChange={(x) => patch({ showStateIcon: x })}
        />
      </FormSection>
      <FormSection title="Layout">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          The variant picker above only changes tiles big enough to
          stack the art above the title (extended/full tiers). Smaller
          tiles fall back to the standard inline layout.
        </div>
        <SelectField
          label="Album art shape"
          value={v.artShape || 'square'}
          defaultValue={defaults.artShape}
          options={[
            { value: 'square',  label: 'Square (default)' },
            { value: 'rounded', label: 'Rounded corners' },
            { value: 'circle',  label: 'Circle' },
            { value: 'none',    label: 'Hide art entirely' }
          ]}
          onChange={(x) => patch({ artShape: x })}
        />
      </FormSection>
    </>
  );
}
