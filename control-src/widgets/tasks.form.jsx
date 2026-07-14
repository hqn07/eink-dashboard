import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  const source = v.source === 'ical' ? 'ical' : 'todoist';
  return (
    <>
      <FormSection title="Source">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Provider
          <select
            value={source}
            onChange={(e) => patch({ source: e.target.value })}
            style={{ width: 220 }}
          >
            <option value="todoist">Todoist</option>
            <option value="ical">iCal / Reminders feed (VTODO)</option>
          </select>
        </label>
        {source === 'todoist' && (
          <TextField
            label="Todoist API token"
            value={v.token || ''}
            onChange={(x) => patch({ token: x })}
            placeholder="paste token"
            secret
            help="Todoist → Settings → Integrations → Developer → API token."
          />
        )}
        {source === 'ical' && (
          <TextField
            label="VTODO feed URL"
            value={v.icalUrl || ''}
            defaultValue={defaults.icalUrl}
            onChange={(x) => patch({ icalUrl: x })}
            placeholder="https://…/reminders.ics"
            help="A published iCal feed that contains VTODO items."
          />
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Max tasks ({Number.isFinite(v.count) ? v.count : 6})
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
            checked={v.showDue !== false}
            onChange={(e) => patch({ showDue: e.target.checked })}
          />
          Show due dates
        </label>
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="TASKS"
          help="Optional title-bar override."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
