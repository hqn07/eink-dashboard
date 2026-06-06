// Mirror of widgets/_tokens.js TOKEN_META for the control-app UI.
// Keep in sync when adding/removing tokens server-side.
export const TOKEN_META = [
  { name: 'date',        formats: ['long', 'short', 'iso', 'day'], example: 'Saturday, June 6' },
  { name: 'day',         formats: ['long', 'short'],               example: 'Saturday' },
  { name: 'city',        formats: [],                              example: 'Brooklyn' },
  { name: 'temp',        formats: ['unit'],                        example: '72°' },
  { name: 'weather',     formats: [],                              example: 'Partly cloudy' },
  { name: 'lastRefresh', formats: ['relative'],                    example: '8:42 AM' },
  { name: 'battery',     formats: ['bar'],                         example: '84%' },
];
