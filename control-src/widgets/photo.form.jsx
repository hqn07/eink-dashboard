import React, { useRef, useState } from 'react';

// Downscale an uploaded image to a modest max edge before storing it as a
// base64 data URI in the tile settings. Config.json holds this string, so
// keeping it small (max 640px, JPEG q0.82) avoids bloating the config with
// a multi-MB original — the server re-dithers to the tile size anyway.
function downscaleToDataURL(file, maxEdge = 640) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const longest = Math.max(width, height);
      if (longest > maxEdge) {
        const k = maxEdge / longest;
        width = Math.round(width * k);
        height = Math.round(height * k);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const hasUpload = !!(v.imageData && v.imageData.trim());

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataURL = await downscaleToDataURL(file);
      // Uploaded image wins over a URL, so clear the URL to avoid ambiguity.
      patch({ imageData: dataURL, imageUrl: '' });
    } catch {
      /* ignore — user can retry */
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <FormSection title="Image">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            onClick={() => fileRef.current && fileRef.current.click()}
            disabled={busy}
            style={{ width: 220 }}
          >
            {busy ? 'Processing…' : hasUpload ? 'Replace uploaded image' : 'Upload image…'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            style={{ display: 'none' }}
          />
          {hasUpload && (
            <button
              type="button"
              onClick={() => patch({ imageData: '' })}
              style={{ width: 220 }}
            >
              Remove uploaded image
            </button>
          )}
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            {hasUpload
              ? 'Using an uploaded image. It is dithered to 1-bit on the panel.'
              : 'Upload a file, or paste an image URL below.'}
          </span>
        </div>
        <TextField
          label="Image URL"
          value={v.imageUrl || ''}
          defaultValue={defaults.imageUrl}
          onChange={(x) => patch({ imageUrl: x })}
          placeholder="https://example.com/photo.jpg"
          help={hasUpload ? 'Ignored while an uploaded image is set.' : 'Public http(s) image link.'}
        />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Fit
          <select
            value={v.fit || 'cover'}
            onChange={(e) => patch({ fit: e.target.value })}
            style={{ width: 220 }}
          >
            <option value="cover">Cover — fill tile, crop edges</option>
            <option value="contain">Contain — fit whole image</option>
          </select>
        </label>
        <TextField
          label="Caption"
          value={v.caption || ''}
          defaultValue={defaults.caption}
          onChange={(x) => patch({ caption: x })}
          placeholder="Optional caption"
          help="Shown in Framed / Caption layouts."
        />
        <TextField
          label="Tile heading"
          value={v.title || ''}
          defaultValue={defaults.title}
          onChange={(x) => patch({ title: x })}
          placeholder="Photo"
          help="Framed layout only. Leave blank for none."
        />
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
