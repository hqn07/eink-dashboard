// Mirror of the dashboard widget registry. Editor uses this for default
// layouts, labels, and which legacy widgets toggle is required.
export const WIDGET_REGISTRY = [
  {
    id: 'weather_hero',
    label: 'Weather · Current',
    requires: 'weather',
    defaultLayout: { x: 0, y: 0, w: 4, h: 6 }
  },
  {
    id: 'weather_forecast',
    label: 'Weather · 3-Day Forecast',
    requires: 'weather',
    defaultLayout: { x: 4, y: 0, w: 3, h: 6 }
  },
  {
    id: 'message',
    label: 'Custom Message',
    requires: 'message',
    defaultLayout: { x: 7, y: 0, w: 5, h: 2 }
  },
  {
    id: 'todos',
    label: 'To-Do List',
    requires: 'todos',
    defaultLayout: { x: 7, y: 2, w: 5, h: 3 }
  },
  {
    id: 'calendar',
    label: 'Calendar',
    requires: 'calendar',
    defaultLayout: { x: 7, y: 5, w: 5, h: 1 }
  }
];

export const GRID_COLS = 12;
export const GRID_ROWS = 6;

export function widgetById(id) {
  return WIDGET_REGISTRY.find(w => w.id === id);
}

// Convert cfg → array of { id, x, y, w, h, enabled } for the editor.
export function resolveLayout(cfg) {
  if (Array.isArray(cfg.layout) && cfg.layout.length) {
    // Ensure every registry widget appears in the editor list, even disabled.
    const byId = new Map(cfg.layout.map(l => [l.id, l]));
    return WIDGET_REGISTRY.map(def => {
      const stored = byId.get(def.id);
      if (stored) {
        return {
          id: def.id,
          x: Number.isFinite(stored.x) ? stored.x : def.defaultLayout.x,
          y: Number.isFinite(stored.y) ? stored.y : def.defaultLayout.y,
          w: Number.isFinite(stored.w) ? stored.w : def.defaultLayout.w,
          h: Number.isFinite(stored.h) ? stored.h : def.defaultLayout.h,
          enabled: stored.enabled !== false
        };
      }
      return {
        id: def.id,
        ...def.defaultLayout,
        enabled: !!(cfg.widgets && cfg.widgets[def.requires])
      };
    });
  }
  return WIDGET_REGISTRY.map(def => ({
    id: def.id,
    ...def.defaultLayout,
    enabled: !!(cfg.widgets && cfg.widgets[def.requires])
  }));
}
