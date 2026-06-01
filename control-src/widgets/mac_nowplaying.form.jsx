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
  const { TextField, SelectField, ToggleField, SliderField, TypographyFields, FormSection, PresetField } = fields;
  const variant = v.variant || 'time_bookends';
  return (
    <>
      <FormSection title="Layout">
        <PresetField presets={PRESETS} onApply={(vals) => onChange({ ...v, ...vals })} />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          onChange={(x) => patch({ title: x })}
          placeholder="NOW PLAYING"
          help="Leave blank to keep the default heading."
        />
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          Variants apply on tiles big enough to stack the art above the
          title (extended/full tiers). Smaller tiles fall back to the
          standard inline layout.
        </div>
        <SelectField
          label="Side-space variant"
          value={variant}
          options={[
            { value: 'time_bookends', label: 'Time bookends (elapsed · remaining)' },
            { value: 'centered',      label: 'Centered (no bookends)' },
            { value: 'vertical_text', label: 'Vertical "NOW PLAYING" text' },
            { value: 'play_state',    label: 'Big play/pause glyph' },
            { value: 'bars',          label: 'Decorative bars' },
            { value: 'metadata',      label: 'Artist · album / source labels' }
          ]}
          onChange={(x) => patch({ variant: x })}
        />
      </FormSection>
      <FormSection title="Show">
        <ToggleField
          label='"NOW PLAYING" heading'
          value={v.showColTitle !== false}
          onChange={(x) => patch({ showColTitle: x })}
        />
        <ToggleField
          label="Song title"
          value={v.showSongTitle !== false}
          onChange={(x) => patch({ showSongTitle: x })}
        />
        <ToggleField
          label="Artist · album line"
          value={v.showArtist !== false}
          onChange={(x) => patch({ showArtist: x })}
        />
        <ToggleField
          label="Album art"
          value={v.showAlbumArt !== false}
          onChange={(x) => patch({ showAlbumArt: x })}
        />
        <ToggleField
          label="Progress bar + elapsed time"
          value={v.showProgress !== false}
          onChange={(x) => patch({ showProgress: x })}
        />
        <ToggleField
          label="Source label (via SPOTIFY / YT MUSIC)"
          value={v.showSource !== false}
          onChange={(x) => patch({ showSource: x })}
        />
        <ToggleField
          label="Play / pause glyph (▶ / ❚❚)"
          value={v.showStateIcon !== false}
          onChange={(x) => patch({ showStateIcon: x })}
        />
      </FormSection>
      <FormSection title="Position">
        <SelectField
          label='"NOW PLAYING" heading position'
          value={v.headerAlign || 'left'}
          options={[
            { value: 'left',   label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right',  label: 'Right' }
          ]}
          onChange={(x) => patch({ headerAlign: x })}
        />
        <SelectField
          label="Album art side (horizontal layout)"
          value={v.artPosition || 'right'}
          options={[
            { value: 'right', label: 'Right of text' },
            { value: 'left',  label: 'Left of text' }
          ]}
          onChange={(x) => patch({ artPosition: x })}
        />
        <SelectField
          label="Artist / song text alignment"
          value={v.textAlign || 'left'}
          options={[
            { value: 'left',   label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right',  label: 'Right' }
          ]}
          onChange={(x) => patch({ textAlign: x })}
        />
        <SliderField
          label="Text block vertical offset"
          min={-120} max={120} step={2}
          value={Number.isFinite(v.textOffsetY) ? v.textOffsetY : 0}
          onChange={(x) => patch({ textOffsetY: x })}
          format={(x) => x === 0 ? '0' : (x > 0 ? `+${x}px down` : `${x}px up`)}
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
