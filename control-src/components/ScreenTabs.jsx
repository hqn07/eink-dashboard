import React from 'react';
import { motion } from 'framer-motion';

// Tab bar listing every screen. Click to switch which screen the
// editor / preview panel is focused on. + adds a new screen.
export default function ScreenTabs({
  screens,
  activeId,
  overlapIds,
  liveScreen,
  editMode,
  onSelect,
  onAdd,
  canAdd
}) {
  return (
    <div className="screen-tabs">
      {screens.map(s => {
        const active = s.id === activeId;
        const isLive = liveScreen && liveScreen.id === s.id;
        const overlap = overlapIds && overlapIds.has(s.id);
        return (
          <motion.button
            key={s.id}
            whileTap={{ scale: 0.97 }}
            className={`screen-tab ${active ? 'active' : ''} ${overlap ? 'overlap' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className="screen-tab-name">{s.name || 'Screen'}</span>
            {s.isDefault && <span className="screen-tab-flag">DFT</span>}
            {isLive && !editMode && <span className="screen-tab-flag live">LIVE</span>}
            {s.schedule?.enabled && (
              <span className="screen-tab-time">{s.schedule.from}–{s.schedule.to}</span>
            )}
          </motion.button>
        );
      })}
      <button
        className="screen-tab screen-tab-add"
        onClick={onAdd}
        disabled={!canAdd}
        title={canAdd ? 'Add new screen' : 'Screen limit reached'}
      >+</button>
    </div>
  );
}
