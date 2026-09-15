# Widget config — the plan before the rebuild

Status: **plan, agreed shape, not executed** (2026-09-15). Written because the
last change (removing the theme knob) shipped before its default was right,
and the AI widget landed black-on-white beside four inverted neighbours. The
order matters: **fix the default, confirm it, then remove the control.**

## The rule

| | Test | Verdict |
|---|---|---|
| **Data** | The system cannot know it | Keep — city, iCal URLs, tickers, username, webhook key, prompt |
| **Content** | Changes *what information* appears or how much | Keep — forecast days, headline count, zones, includeToday, showAge |
| **Cosmetic** | Decorates the *same* information | Cut — fonts, padding, theme, frame, alignment, offsets |

Variants get the same test: keep the ones that restructure content, cut
near-duplicate restyles.

## What's actually there (measured 2026-09-15)

- 32 widgets, **235 settings keys**, **99 variants**
- But **120 of those 235 keys are four keys repeated**: `variant` (31
  widgets), `fontScale` (31), `padding` (31), `title` (27). Only ~115 keys are
  genuinely widget-specific.
- `fontScale` and `padding` still sit in every `defaults()` even though stage 1
  removed their UI — dead weight in every config written since.

## Decisions — universal keys

| Key | In | Verdict | Why |
|---|---|---|---|
| `fontScale` | 31 | **Remove from defaults** | UI already gone; keeping it writes a dead key into every tile |
| `padding` | 31 | **Remove from defaults** | same |
| `theme` | — | **Done** — inverted is the default | the live config had it on every tile; `'normal'` stays as config-only opt-out |
| `density` | 3 | **Remove** | UI gone; `pickTier` already decides |
| `barShape` | 3 | **Cut** | pure decoration on the shared bar |
| `title` | 27 | **Keep** | names the tile; genuinely per-instance |
| `variant` | 31 | **Keep the key**, cut most values | see below |

## Decisions — per widget

`in use` marks what the live config pins; those variants must become the
defaults or the screen changes.

| Widget | Variants now | Keep | Own keys: keep | Own keys: cut |
|---|---|---|---|---|
| ai | — | — | prompt, cadence | — |
| aqi | trmnl, gauge, big, bar, minimal | **gauge** | showPollutants | — |
| art | hitomezashi, truchet | **both** (different art) | seed, showDate | density |
| calendar | trmnl, list, strip, strip5, month | **list, strip, month** | icalUrls, disabledFeeds, localEvents, showDayLabel, showTime | density |
| chess | diagram, board_only, coords | **diagram** | showMeta | — |
| clock | trmnl, big, thin, banner | **big** *(in use)* | format, showDate | — |
| codeactivity | trmnl | — | username | — |
| countdown | trmnl, big, detail, minimal | **big** | target, repeat, label | — |
| crypto | trmnl | — | coins, vs | — |
| eink_battery | trmnl, gauge, trend, inline, minimal | **gauge, trend** | showVoltage, showAge, showBar | barShape |
| fx | trmnl | — | base, targets | — |
| headlines | trmnl, list, compact | **list** *(in use)* | source, newsSource, hnFeed, feedUrl, feedUrls, count, showAge | — |
| mac_battery | trmnl, gauge, inline, minimal | **gauge** | showState | barShape |
| mac_nowplaying | 6 side-space options | **1** | showAlbumArt, artShape, showProgress, showSource, showSongTitle, showArtist | showStateIcon, showColTitle, headerAlign, artPosition, textAlign, textOffsetY |
| moon | trmnl, flow, disc, detail, minimal | **disc, flow** | — | — |
| onthisday | trmnl, list, feature, compact | **list** | — | — |
| photo | full, framed, caption | **all three** | imageUrl(s), imageData, imageRef, fit, dither, brightness, contrast, caption | — |
| progress | trmnl, plain, dots, pixels | **plain, dots, pixels** | spans | barShape |
| qr | caption, code | **both** | mode, data, ssid, password, auth, hidden, level, caption | — |
| quote | trmnl, serif, mark, minimal | **serif** | quotes | — |
| sparkline | trmnl, line, dots, minimal | **line** | source, semanticRed | — |
| stocks | trmnl | — | symbols | — |
| sun | trmnl | — | hour24, showDaylight | — |
| tasks | trmnl, list, compact | **list** | source, token, icalUrl, count, showDue | — |
| text | bar, card | **both** | text, subtitle, schedule, align | upper, fontFamily |
| transit | trmnl, board, compact | **board** | line, stopId, direction, count | — |
| uv | gauge, scale | **gauge** | — | — |
| webhook | auto, number, kv, template | **all four** (data shapes) | key, template, path | — |
| weather_forecast | trmnl, rows, columns | **columns, rows** *(columns in use)* | city, lat, lon, unitsOverride, forecastDays, includeToday, precipMode, hiloStyle, showIcons, showDayName | — |
| weather_hero | trmnl, classic, split, minimal | **classic, split** | city, lat, lon, unitsOverride, stats, showStats, showHourly, showSunbar, showAlerts, showDesc | — |
| word_of_day | trmnl, serif | **serif** | words | — |
| world_clock | trmnl, stack, big, dual | **big, stack** *(big in use)* | zones, format, showMeta | — |

**99 variants → ~45.** The big cut is `trmnl`, which is a variant in 23
widgets but is simply the house style now — it should be *the* render, not a
choice. The other cuts are `minimal` / `compact` / `thin`, which duplicate what
`pickTier` already does from tile size.

## Everything else

| Surface | Verdict |
|---|---|
| Modal: Visibility (`hidden`) | Keep — content |
| Modal: flush edges, border | **Cut** — cosmetic; flush is already near-universal |
| Modal: size presets (S/M/L) | Keep — content |
| Modal: "Copy from →" | Keep — cheap, saves retyping data |
| Screen: refreshMinutes, schedule, units | Keep — behaviour, not decoration |
| Screen: `layoutKind` / slots | **Decide** — primitive layouts were built but never got UI; either finish or delete |
| Global: `home` block | Keep — stages 2 and 3 of `setup-architecture.md` |
| Global: quietHours | Keep — behaviour |
| Global: alarms (scheduled ring) | **Cut** — see below |
| Buzzer audio feedback | **Keep** — firmware-only, already working |
| Palette: 32 widgets | Keep all; they cost nothing until added |

## Buzzer: feedback stays, alarms go

The buzzer is **not** being desoldered after all — it stays, but as audio
feedback only, not as an alarm clock. These are already cleanly separable:

**Keep (firmware-only, no server involvement):**
- `beepChime()` on button wake — press acknowledgement / refresh done
- `beepLowBattery()` below the low-battery threshold

Neither touches the server, so cutting alarms cannot break them.

**Cut (the schedule-a-ring feature):**
- `routes/alarms.js`, `widgets/alarms.js`, the `server.js` wiring
- `AlarmsPanel.jsx` + its Settings > Tools row, and the `control-src/api.js`
  helpers
- The `{{nextAlarm}}` token family in `widgets/_tokens.js` — check the token
  registry mirror and `check:widgets` after, since the two copies must agree
- Firmware: `fetchNextAlarm()`, the `/api/alarm/next` call and the alarm ring
  loop. Firmware already treats "no alarm scheduled" as success, so the
  server side can go first and the device keeps working until the next OTA.

Order matters here too: drop the server surface, confirm the panel still
wakes and beeps on a button press, then strip the firmware alarm loop on the
next flash.

## Rebuild order

Each step is one commit, guards + panel photo before the next.

1. **Defaults first, no removals.** — **DONE** (`cec5e99`). 17 widgets moved
   off `trmnl`; both `def.defaultVariant` and `defaults().variant` updated,
   all render non-empty at S/M/L.
2. **Panel photo.** The four live widgets must look identical to today.
   *Pre-verified locally:* rendering the exported live config against the
   commit before the flips and diffing the PNGs gives 73 differing pixels of
   384000, all of them the forecast's precipitation row (29%->31%, 2%->4%) —
   live data drift between the two renders, nothing else. The panel photo is
   still the final word, but the flips are not expected to move anything.

   **This diff technique now works and should gate steps 3-5**, which DO
   change stored behaviour:
   ```
   export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
   # render current code, then `git checkout <ref> -- control-src/widgets/`,
   # render again, diff the two PNGs, restore with `git checkout HEAD -- ...`
   ```
   Freeze the clock/weather first if an exact 0-pixel result is wanted.
3. **Cut the variants** — **DONE** (`bd3aba3`). 99 -> 43. `chess` had no
   `def.defaultVariant` at all (only `defaults().variant`), so trimming its
   picker would have resolved to null; fixed.
4. **Cut the cosmetic keys** — **DONE** (`e487cc3`). 235 default keys -> 166.
   `fontScale` + `padding` from all 31 widgets, `barShape` from three, and
   mac_nowplaying's alignment/offset knobs; plus 31 dead `Style` form
   sections. **Two entries in the table above were wrong** and were kept
   instead: `art.density` is that widget's grid fineness in px, not the
   layout knob, and `calendar.density` (rich/compact/auto) changes how much
   of each event shows — both are content by the rule. Classifying on the
   key's name is not good enough.
5. **Strip dead keys from the live config** — NEXT, and the only step that
   changes a running screen. Removes `fontScale`, `padding`, `theme`
   (now redundant — inverted is the default), and any cut variant from the
   stored tiles. Note the live tiles currently store `padding: 14`, which
   overrides the face CSS's designed `14px 16px`; stripping it is a real
   2px change, so photo after.
6. **Rebaseline** `test:visual` and re-photo.

## Risks

- **Stored values keep rendering.** Renderers still honour `theme`,
  `fontScale`, etc. Step 5 is the only step that changes a live screen, which
  is why it is last and gated on a photo.
- **The visual baseline is already stale** — inverted-by-default changed every
  matrix tile. Rebaseline needs a machine with Chrome; this one has none.
- **`trmnl` is load-bearing in 23 widgets.** Removing it as a *variant* must
  not remove it as the *render path*. Check each widget's render reads
  `ctx.variant` with a sane fallback before deleting the key.
- **ALL FOUR of the user's tiles pin a variant that is not the current
  default.** Checked, not assumed: `weather_forecast` uses `columns`,
  `clock` uses `big`, `headlines` uses `list`, `world_clock` uses `big` —
  every one of them defaults to `trmnl` today. Step 1 must flip all four, or
  step 5 silently restyles the entire live screen. This is the single most
  dangerous item in the plan.
