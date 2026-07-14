// Uploaded photo storage. The editor used to inline uploads as base64
// data URIs inside config.json — a few photos ballooned the config (and
// every config read/write/undo snapshot with it). Uploads now live as
// content-addressed files under DATA_DIR/uploads; the tile settings
// carry only `imageRef: "<sha1-16>.<ext>"`.
//
// Refs are strictly validated on read so a crafted config can't path-
// traverse out of the uploads dir.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./store');

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const REF_RE = /^[a-f0-9]{16}\.(jpg|png|webp|gif)$/;

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif'
};
const MIME_BY_EXT = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

// data:image/...;base64,xxxx → { ref } written to disk, or null when the
// URI isn't a decodable image. Content-addressed: the same image saved
// twice dedupes to one file.
async function saveUpload(dataUri) {
  const m = /^data:([a-z/+.-]+);base64,(.+)$/is.exec(String(dataUri || ''));
  if (!m) return null;
  const ext = EXT_BY_MIME[m[1].toLowerCase()];
  if (!ext) return null;
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return null; }
  if (!buf.length) return null;
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const ref = `${hash}.${ext}`;
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  const file = path.join(UPLOADS_DIR, ref);
  if (!fs.existsSync(file)) await fsp.writeFile(file, buf);
  return ref;
}

async function readUpload(ref) {
  if (!REF_RE.test(String(ref || ''))) return null;
  try { return await fsp.readFile(path.join(UPLOADS_DIR, ref)); }
  catch { return null; }
}

function uploadMime(ref) {
  const ext = String(ref || '').split('.').pop();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

// Walk a config's screens and move any inline photo upload out to disk.
// Mutates and returns `cfg`. Called inside the config-save lock so the
// externalized refs land in the same write.
async function externalizePhotoUploads(cfg) {
  for (const screen of (cfg && cfg.screens) || []) {
    for (const item of (screen && screen.layout) || []) {
      const wid = item && (item.widgetId || item.id);
      const s = item && item.settings;
      if (wid !== 'photo' || !s) continue;
      if (typeof s.imageData === 'string' && s.imageData.startsWith('data:')) {
        const ref = await saveUpload(s.imageData);
        if (ref) {
          s.imageRef = ref;
          s.imageData = '';
        }
      }
    }
  }
  return cfg;
}

module.exports = { saveUpload, readUpload, uploadMime, externalizePhotoUploads, UPLOADS_DIR, REF_RE };
