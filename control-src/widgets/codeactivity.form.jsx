import React from 'react';
import { homeValue } from '../home.js';

export function Form({ values, patch, onChange, fields, cfg }) {
  const v = values || {};
  const { TextField, FormSection, defaults = {} } = fields;
  // Blank inherits Setup — say whose account that is rather than showing
  // "octocat" and letting the user assume nothing is configured.
  const inherited = homeValue(cfg, 'githubUser') || '';
  return (
    <>
      <FormSection title="Content">
        <div className="wsm-field-help" style={{ marginBottom: 6 }}>
          GitHub contribution heatmap (last year). Public contributions only,
          no token needed.
        </div>
        <TextField
          label="GitHub username"
          value={v.username || ''}
          defaultValue={defaults.username}
          onChange={(x) => patch({ username: x })}
          placeholder={inherited || 'octocat'}
          help={inherited
            ? `Blank uses Setup: ${inherited}`
            : 'Set one here, or in Settings > Tools > You & your place for every tile.'}
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })} tokens
          placeholder="CODE ACTIVITY"
          help="Leave blank to keep the default heading."
        />
      </FormSection>
    </>
  );
}
