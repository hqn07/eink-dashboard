// Panel alignment calibration target for the 3-color (B) panel.
//
// The B panel has a hardware column offset (see CLAUDE.md gotcha 10): the
// image lands rotated sideways on glass. `PANEL_SHIFT_3C_PX` compensates by
// pre-rotating the data the other way, but tuning it against a dashboard
// photo is guesswork — you can see that it's wrong, not by how much, and
// you can't tell a wrap (panel rolls the strip around) from a drop (panel
// pushes it off and shows junk/blank), which need different fixes.
//
// This draws a font-free target that answers both from a single photo:
//
//   • Sentinels — leftmost 8 columns solid BLACK, rightmost 8 solid RED.
//     Both visible = nothing is lost. Red appearing on the left = the panel
//     WRAPS. A blank/garbage strip where a sentinel should be = it DROPS.
//   • Column ruler (top) — ticks every 8 px, taller at 32, tallest at 64.
//   • Band dot-code — the image is cut into 64 px bands; band k is marked
//     with k+1 stacked dots, alternating black/red. Count the dots in the
//     first fully-visible band and you know exactly which source column is
//     sitting at the panel's left edge, i.e. the offset, in one read.
//   • Row ruler (left) — ticks every 16 rows, so a vertical offset can't
//     hide behind a horizontal one.
//   • Plane registration block — a black bar stacked directly on a red bar
//     at center. The two planes get the same shift, so any visible stagger
//     between them is a panel/firmware trait, not this compensation.
//
// Pure pixel math — no Puppeteer, no fonts, no CSS. The output is
// deterministic, so the ETag can be a constant.

const crypto = require('crypto');
const { SCREEN_W, SCREEN_H, packMonoBin } = require('./image');

const INK = 0;      // 0 = ink (black in the black plane, red in the red one)
const PAPER = 255;  // 255 = white

const BAND = 64;    // dot-code band width, px
const SENTINEL = 24; // sentinel strip width, px

function makeTarget() {
  const n = SCREEN_W * SCREEN_H;
  const black = Buffer.alloc(n, PAPER);
  const red = Buffer.alloc(n, PAPER);

  const plot = (plane, x, y) => {
    if (x < 0 || x >= SCREEN_W || y < 0 || y >= SCREEN_H) return;
    plane[y * SCREEN_W + x] = INK;
  };
  const rect = (plane, x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) plot(plane, x, y);
    }
  };

  // --- Sentinels: black on the left edge, red on the right ---
  rect(black, 0, 0, SENTINEL, SCREEN_H);
  rect(red, SCREEN_W - SENTINEL, 0, SENTINEL, SCREEN_H);

  // --- Column ruler along the top: 8 / 32 / 64 px ticks ---
  for (let x = 0; x < SCREEN_W; x += 8) {
    const h = x % BAND === 0 ? 40 : x % 32 === 0 ? 24 : 12;
    const w = x % BAND === 0 ? 2 : 1;
    rect(black, x, 0, w, h);
  }

  // --- Band dot-code: band k gets k+1 dots, planes alternate ---
  for (let k = 0; k * BAND < SCREEN_W; k++) {
    const plane = k % 2 === 0 ? black : red;
    for (let d = 0; d <= k; d++) {
      rect(plane, k * BAND + 12, 60 + d * 14, 8, 8);
    }
  }

  // --- Row ruler down the left edge: ticks every 16 rows ---
  for (let y = 0; y < SCREEN_H; y += 16) {
    rect(black, SENTINEL + 6, y, y % 64 === 0 ? 24 : 12, 2);
  }

  // --- Red row ruler, mirroring the black one a little further in ---
  // The black plane alone can't measure a RED-plane row offset: if the two
  // planes land at different heights or the red one steps sideways partway
  // down, you need a red ruler to read it against. Same tick rhythm so the
  // two are directly comparable where they overlap.
  for (let y = 0; y < SCREEN_H; y += 16) {
    rect(red, SENTINEL + 36, y, y % 64 === 0 ? 24 : 12, 2);
  }

  // --- Notch the red sentinel every 8 rows, double-wide every 64 ---
  // Turns the solid bar into a countable scale: wherever the bar jumps
  // sideways, count notches from the top edge to get the exact row.
  for (let y = 0; y < SCREEN_H; y += 8) {
    const notch = y % 64 === 0 ? 4 : 2;
    for (let yy = y; yy < y + notch && yy < SCREEN_H; yy++) {
      for (let x = SCREEN_W - SENTINEL; x < SCREEN_W; x++) {
        red[yy * SCREEN_W + x] = PAPER;   // punch a paper gap in the bar
      }
    }
  }

  // --- Plane registration: black bar stacked on a red bar, centered ---
  const bw = 240, bh = 28;
  const bx = (SCREEN_W - bw) / 2;
  rect(black, bx, SCREEN_H / 2 - bh, bw, bh);
  rect(red, bx, SCREEN_H / 2, bw, bh);

  // --- 2px frame: any cropped edge shows up as a missing side ---
  rect(black, 0, 0, SCREEN_W, 2);
  rect(black, 0, SCREEN_H - 2, SCREEN_W, 2);
  rect(black, 0, 0, 2, SCREEN_H);
  rect(black, SCREEN_W - 2, 0, 2, SCREEN_H);

  const info = { width: SCREEN_W, height: SCREEN_H };
  return Buffer.concat([packMonoBin(black, info), packMonoBin(red, info)]);
}

// Deterministic output — build once, reuse.
let cached = null;
function calibPlanes() {
  if (!cached) cached = makeTarget();
  return cached;
}

// Content hash for the ETag. A fixed ETag string would let a device that
// already drew an OLDER target 304 and keep showing it — the exact way to
// burn a calibration round trip on a stale photo. Keyed on the bytes, so
// editing the target always forces a redraw.
let cachedTag = null;
function calibTag() {
  if (!cachedTag) {
    cachedTag = crypto.createHash('sha1').update(calibPlanes()).digest('hex').slice(0, 12);
  }
  return cachedTag;
}

module.exports = { calibPlanes, calibTag, BAND, SENTINEL };
