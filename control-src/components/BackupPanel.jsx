import React from 'react';
import { resetConfig } from '../api.js';

// Config export / import / reset. Lives inside the Global defaults
// dropdown so the bottom Settings panel can retire while these tools
// stay one click away.
export default function BackupPanel({ cfg, onReplaceConfig }) {
  function exportJson() {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eink-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = JSON.parse(reader.result);
        if (!next || typeof next !== 'object') throw new Error('not an object');
        if (!window.confirm('Replace current config with imported file? Unsaved changes will be lost.')) return;
        onReplaceConfig && onReplaceConfig(next);
      } catch (err) {
        window.alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function doReset() {
    if (!window.confirm('Reset all settings to factory defaults? This cannot be undone.')) return;
    try {
      const fresh = await resetConfig();
      onReplaceConfig && onReplaceConfig(fresh);
    } catch (err) {
      window.alert('Reset failed: ' + err.message);
    }
  }

  return (
    <div className="gdm-backup">
      <div className="gdm-backup-title">Backup &amp; reset</div>
      <div className="gdm-backup-row">
        <button type="button" className="btn" onClick={exportJson}>↓ EXPORT</button>
        <label className="btn" style={{ cursor: 'pointer' }}>
          ↑ IMPORT
          <input type="file" accept="application/json" style={{ display: 'none' }}
            onChange={onImportFile} />
        </label>
        <button type="button" className="btn btn-danger" onClick={doReset}>↺ RESET</button>
      </div>
    </div>
  );
}
