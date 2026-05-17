import React from 'react';
import { motion } from 'framer-motion';

export default function SaveBar({ status, label, onSave }) {
  return (
    <motion.div
      layout
      className={`save-bar ${status}`}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
    >
      <span className="status">{label}</span>
      <button onClick={onSave} disabled={status === 'saving'}>
        SAVE &amp; PUSH
      </button>
    </motion.div>
  );
}
