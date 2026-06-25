import React from 'react';

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  const mode = v.mode === 'wifi' ? 'wifi' : 'url';
  return (
    <>
      <FormSection title="Content">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Encode
          <select
            value={mode}
            onChange={(e) => patch({ mode: e.target.value })}
            style={{ width: 220 }}
          >
            <option value="url">Link / text</option>
            <option value="wifi">WiFi network (scan to join)</option>
          </select>
        </label>
        {mode === 'url' && (
          <TextField
            label="Link or text"
            value={v.data || ''}
            defaultValue={defaults.data}
            onChange={(x) => patch({ data: x })}
            placeholder="https://example.com"
            help="URL or any text to encode."
          />
        )}
        {mode === 'wifi' && (
          <>
            <TextField
              label="Network name (SSID)"
              value={v.ssid || ''}
              onChange={(x) => patch({ ssid: x })}
              placeholder="MyWiFi"
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              Security
              <select
                value={v.auth || 'WPA'}
                onChange={(e) => patch({ auth: e.target.value })}
                style={{ width: 220 }}
              >
                <option value="WPA">WPA/WPA2/WPA3</option>
                <option value="WEP">WEP</option>
                <option value="nopass">Open (no password)</option>
              </select>
            </label>
            {v.auth !== 'nopass' && (
              <TextField
                label="Password"
                value={v.password || ''}
                onChange={(x) => patch({ password: x })}
                placeholder="••••••••"
                help="Encoded into the QR. Anyone who scans it joins."
              />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={!!v.hidden}
                onChange={(e) => patch({ hidden: e.target.checked })}
              />
              Hidden network
            </label>
          </>
        )}
        <TextField
          label="Caption"
          value={v.caption || ''}
          defaultValue={defaults.caption}
          onChange={(x) => patch({ caption: x })}
          placeholder="Scan me"
          help="Shown under the code. Optional."
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="QR"
          help="Leave blank for none."
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Error correction
          <select
            value={v.level || 'M'}
            onChange={(e) => patch({ level: e.target.value })}
            style={{ width: 220 }}
          >
            <option value="L">Low (7%) — smallest code</option>
            <option value="M">Medium (15%)</option>
            <option value="Q">Quartile (25%)</option>
            <option value="H">High (30%) — most robust</option>
          </select>
        </label>
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
