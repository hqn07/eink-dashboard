// React context carrying the live config down to widget forms, so a field
// can show what it INHERITS from Setup (cfg.home) instead of a blank box —
// stage 3 of docs/setup-architecture.md.
//
// Sourced from the editor's preview-data payload, which is refetched after
// every save, so it can lag a Setup edit made in the same unsaved breath.
// That only affects the label a form shows, never what gets written.
import { createContext } from 'react';

export const HomeCtx = createContext(null);
