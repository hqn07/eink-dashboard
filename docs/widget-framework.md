# Widget Framework

CSS conventions for authoring widgets that render consistently across
bit-depth modes. Patterned on TRMNL's framework
(https://help.trmnl.com/en/articles/12386214) so widgets stay
forward-compatible if/when we add a 2-bit hardware mode.

## Body scope

`public/dashboard.html` sets `<body class="screen screen--1bit">`. The
`screen--1bit` scope picks the rendering strategy for the grayscale
primitives below. The future `screen--2bit` scope would swap dithered
backgrounds for hardware gray planes; widget HTML stays the same.

## Grayscale classes

| Class           | 1-bit rendering                  | Foreground default |
|-----------------|----------------------------------|--------------------|
| `bg--black`     | solid `#000`                     | `#fff` text        |
| `bg--white`     | solid `#fff`                     | `#000` text        |
| `bg--gray-30`   | ordered dither, ~25% white pixels (darker mid) | `#fff` text |
| `bg--gray-55`   | ordered dither, ~56% white pixels (lighter mid) | `#000` text |
| `text--black`   | solid `#000`                     | —                  |
| `text--white`   | solid `#fff`                     | —                  |
| `text--gray-30` | falls back to `#000`             | text never dithers (illegible after threshold) |
| `text--gray-55` | falls back to `#000`             | — |

The dither tiles are inline 4×4 SVG data URIs so they survive Sharp's
`threshold(128)` cleanly — every pixel is pure black or pure white
before the binary pack.

## Authoring guidance

- **Backgrounds**: prefer `bg--gray-30` / `bg--gray-55` over hex
  colors so any future bit-depth swap is global. Solid `bg--black` /
  `bg--white` remain fine when you want hard tone.
- **Text**: always use `text--black` or `text--white`. Don't try to
  dither small glyphs.
- **Photos / icons**: dither at the data layer
  (`widgets/_dither.js`), not via CSS. CSS dither tiles are for
  flat-color regions; photos need Floyd-Steinberg.

## Forward compatibility

If we adopt bb_epaper (or any 2-bit waveform) in the future, swap the
body class to `screen--2bit` and define `.screen--2bit .bg--gray-30
{ background: #555; }` etc. — widgets stop dithering and the panel
draws real gray cells.
