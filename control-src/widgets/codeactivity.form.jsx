import { buildForm } from './_schema.jsx';
import { homeValue } from '../home.js';

export const FIELDS = [
  {
    type: 'note',
    text: 'GitHub contribution heatmap (last year). Public contributions only, no token needed.'
  },
  {
    key: 'username', type: 'text', label: 'GitHub username',
    // Blank inherits Setup — name whose account that is rather than showing
    // "octocat" and letting the reader assume nothing is configured.
    placeholder: (v, ctx) => homeValue(ctx && ctx.cfg, 'githubUser') || 'octocat',
    help: (v, ctx) => {
      const inherited = homeValue(ctx && ctx.cfg, 'githubUser') || '';
      return inherited
        ? `Blank uses Setup: ${inherited}`
        : 'Set one here, or in Settings > Tools > You & your place for every tile.';
    }
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: 'CODE ACTIVITY',
    help: 'Leave blank to keep the default heading.'
  }
];

export const Form = buildForm(FIELDS);
