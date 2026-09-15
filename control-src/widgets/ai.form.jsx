import React from 'react';

// Two fields, and that is the whole form. The prompt is the customization —
// everything cosmetic is the design's decision now. Cadence earns its place
// because it isn't taste: it trades money and battery (every generation is an
// API call, and new text means a 15-26s colour redraw on the panel).
export function Form({ values, patch, fields }) {
  const v = values || {};
  const { TextField, SelectField, FormSection } = fields;
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
