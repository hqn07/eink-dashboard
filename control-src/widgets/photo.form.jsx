import React, { useRef, useState, useEffect } from 'react';
import { renderDitherPreview } from '../dither-preview.js';
import { uploadPhotoUrl } from '../api.js';

// Uploaded image source: fresh uploads sit in imageData (data URI) until
// the next save externalizes them to an imageRef file on the server.
function uploadedSrc(v) {
  if (v.imageData && v.imageData.trim()) return v.imageData;
  if (v.imageRef && v.imageRef.trim()) return uploadPhotoUrl(v.imageRef.trim());
  return '';
}

// IMPORTANT: the top-level `Form` must stay a PURE function (no hooks) —
// TabbedForm calls it directly to introspect its FormSection children. Any
// state/refs/effects live in the nested components below, which React renders
// normally, so hooks are legal there. (Calling a hook in `Form` itself throws
// "Invalid hook call" and blanks the editor.)

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

// Upload button + hidden file input (hooks live here, not in Form).
function PhotoUpload({ v, patch }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const hasUpload = !!uploadedSrc(v);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataURL = await downscaleToDataURL(file);
      // uploaded wins over URL; clear any previous externalized ref
      patch({ imageData: dataURL, imageUrl: '', imageRef: '' });
    } catch {
      /* ignore — user can retry */
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy} style={{ width: 220 }}>
        {busy ? 'Processing…' : hasUpload ? 'Replace uploaded image' : 'Upload image…'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
      {hasUpload && (
        <button type="button" onClick={() => patch({ imageData: '', imageRef: '' })} style={{ width: 220 }}>
          Remove uploaded image
        </button>
      )}
      <span style={{ fontSize: 11, opacity: 0.7 }}>
        {hasUpload
          ? 'Using an uploaded image. It is dithered to 1-bit on the panel.'
          : 'Upload a file, or paste an image URL below.'}
      </span>
    </div>
  );
}

// Live 1-bit canvas preview (hooks live here).
function DitherPreview({ v }) {
  const canvasRef = useRef(null);
  const [previewOk, setPreviewOk] = useState(true);
  const src = uploadedSrc(v) || (v.imageUrl && v.imageUrl.trim());

  useEffect(() => {
    let cancelled = false;
    if (!canvasRef.current || !src) { setPreviewOk(false); return; }
    renderDitherPreview(canvasRef.current, src, {
      algorithm: v.dither || 'atkinson',
      brightness: Number.isFinite(v.brightness) ? v.brightness : 0,
      contrast: Number.isFinite(v.contrast) ? v.contrast : 0,
      fit: v.fit || 'cover'
    }).then(ok => { if (!cancelled) setPreviewOk(ok); });
    return () => { cancelled = true; };
  }, [src, v.dither, v.brightness, v.contrast, v.fit]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <canvas
        ref={canvasRef}
        width={224}
        height={140}
        style={{ width: 224, height: 140, border: '2px solid #000', imageRendering: 'pixelated', background: '#fff', display: src ? 'block' : 'none' }}
      />
      {src && !previewOk && (
        <span style={{ fontSize: 11, opacity: 0.7 }}>
          Live preview unavailable for this URL (no cross-origin access). It will still dither correctly on the panel.
        </span>
      )}
      {src && previewOk && (
        <span style={{ fontSize: 11, opacity: 0.7 }}>Live 1-bit preview — approximates the panel.</span>
      )}
    </div>
  );
}

export function Form({ values, patch, onChange, fields }) {
  const v = values || {};
  const { TextField, TypographyFields, FormSection, defaults = {} } = fields;
  const hasUpload = !!uploadedSrc(v);
  return (
    <>
      <FormSection title="Image">
        <PhotoUpload v={v} patch={patch} />
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
          <select value={v.fit || 'cover'} onChange={(e) => patch({ fit: e.target.value })} style={{ width: 220 }}>
            <option value="cover">Cover — fill tile, crop edges</option>
            <option value="contain">Contain — fit whole image</option>
          </select>
        </label>
      </FormSection>
      <FormSection title="Dithering">
        <DitherPreview v={v} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Style
          <select value={v.dither || 'atkinson'} onChange={(e) => patch({ dither: e.target.value })} style={{ width: 220 }}>
            <option value="atkinson">Atkinson — clean, TRMNL look (best for photos)</option>
            <option value="fs">Floyd–Steinberg — fine grain, more detail</option>
            <option value="threshold">Threshold — hard B/W, no dots (logos)</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Brightness ({Number.isFinite(v.brightness) ? v.brightness : 0})
          <input type="range" min={-100} max={100} step={5}
            value={Number.isFinite(v.brightness) ? v.brightness : 0}
            onChange={(e) => patch({ brightness: parseInt(e.target.value, 10) })} style={{ width: 220 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Contrast ({Number.isFinite(v.contrast) ? v.contrast : 0})
          <input type="range" min={-100} max={100} step={5}
            value={Number.isFinite(v.contrast) ? v.contrast : 0}
            onChange={(e) => patch({ contrast: parseInt(e.target.value, 10) })} style={{ width: 220 }} />
        </label>
      </FormSection>
      <FormSection title="Style">
        <TypographyFields values={v} onChange={onChange} />
      </FormSection>
    </>
  );
}
