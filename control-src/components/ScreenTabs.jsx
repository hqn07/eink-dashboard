import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { DotsSixVertical } from '@phosphor-icons/react';

// Tab bar listing every screen. Click to switch which screen the
// editor / preview panel is focused on. + adds a new screen. Drag a
// tab onto another to reorder; the order is committed via the
// onReorder(fromId, toId) callback so the parent can update cfg.
export default function ScreenTabs({
  screens,
  activeId,
  overlapIds,
  liveScreen,
  editMode,
  onSelect,
  onAdd,
  onReorder,
  canAdd
}) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  return (
    <div className="screen-tabs">
      {screens.map(s => {
        const active = s.id === activeId;
        const isLive = liveScreen && liveScreen.id === s.id;
        const overlap = overlapIds && overlapIds.has(s.id);
        const isDragging = dragId === s.id;
        const isOver = overId === s.id && dragId !== null && dragId !== s.id;
        const dragHandlers = onReorder ? {
          draggable: true,
          onDragStart: (e) => {
            setDragId(s.id);
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', s.id); } catch { /* ignore */ }
          },
          onDragOver: (e) => { if (dragId) { e.preventDefault(); setOverId(s.id); } },
          onDrop: (e) => {
            if (!dragId) return;
            e.preventDefault();
            if (dragId !== s.id) onReorder(dragId, s.id);
            setDragId(null);
            setOverId(null);
          },
          onDragEnd: () => { setDragId(null); setOverId(null); }
        } : {};
        return (
          <motion.button
            key={s.id}
            whileTap={{ scale: 0.97 }}
            className={`screen-tab ${active ? 'active' : ''} ${overlap ? 'overlap' : ''} ${isDragging ? 'is-dragging' : ''} ${isOver ? 'is-over' : ''}`}
            onClick={() => onSelect(s.id)}
            {...dragHandlers}
          >
            {onReorder && screens.length > 1 && (
              <span className="screen-tab-grip" aria-hidden="true">
                <DotsSixVertical size={10} weight="bold" />
              </span>
            )}
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
