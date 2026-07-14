// React context carrying the live token context (built from the editor's
// preview-data payload) down to token popovers, so {{temp}} in the
// autocomplete / picker shows the actual current value instead of a
// canned example. null when preview data hasn't loaded yet.
import { createContext } from 'react';

export const TokenCtx = createContext(null);
