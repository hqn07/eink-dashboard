# E-Ink Dashboard — Handoff

> ## 2026-09-22 — D4 done: all 22 widget forms are data
> `75a5a64` → `9141276` → `e1e3abc`, plus `09f1a1a` for a bug the deploys
> themselves caused.
>
> ### What it is
> A form is now `export const FIELDS = [...]` and
> `export const Form = buildForm(FIELDS)`. `_schema.jsx` builds **exactly the
> tree the hand-written forms produced** — `FormSection` blocks holding the
> same field primitives — so `TabbedForm`'s introspection, the pill tabs and
> the per-widget section memory never knew anything changed. Nothing
> downstream can tell the difference, which is why this landed in four
> commits without a single visual baseline moving.
>
> **1,886 lines of JSX → 1,465**, and the remainder is mostly bespoke
> components that were always going to be components.
>
> ### The hook rule became structural
> `TabbedForm` CALLS the form as a plain function to read its sections, so a
> hook at a form's top level is an invalid-hook crash that blanks the editor —
> it happened, with `photo.form`, and `ErrorBoundary` exists because of it. A
> generated form cannot hold a hook: there is nowhere to write one. And
> `type: 'custom'` is handed the context and returns an **element**, which is
> the whole trick — an element is rendered by React later, so hooks inside
> that component are fine.
>
> ### Field types, in the order they were needed
> ```
> text select toggle slider csv      the first four widgets
> textarea multi list note presets   webhook / progress / daily / clock
> location                           raw onChange: LocationFields emits a
>                                    COMPLETE object, and a patch-merge would
>                                    defeat "use Setup instead", which works
>                                    by deleting keys
> slots                              N pickers writing one array by INDEX —
>                                    weather's stats grid, where "slot 3 shows
>                                    wind" is a position, not a setting
> custom                             the seven bespoke controls
> ```
> Plus `when(v)`, `section`, `collapse` groups, `toField`/`fromField` for a
> value the widget does not store (the forecast keeps a number or null; the
> picker needs `'auto'`), `owns: [...]` so a custom control declares the keys
> it writes, and functions for label/help/placeholder/options so a
> view-switching widget says the right thing per view instead of duplicating
> the field.
>
> ### The guard is the point, and it found a real bug
> `check:widgets` now checks both directions: a field key missing from
> `defaults()` is dead, a default no field exposes is unreachable. First run
> against the full set: **`photo` had `caption` and `title` in defaults and
> exposed neither.** The renderer draws a caption on the framed and caption
> variants, so the only way to set one was editing `config.json` by hand.
>
> **Six guard bugs, every one surfaced by correct code failing** — worth
> listing because each is a way static analysis lies:
> 1. comments inside `defaults()` scanned as keys (`// YYYY-MM-DDTHH:MM` →
>    `DDTHH`, `// 'wifi' = build WIFI:` → `WIFI`)
> 2. single-line `defaults: () => ({ variant: 'sun', title: '' })` parsed as
>    one key, because the scan anchored on line starts
> 3. `defaults: (ctx) =>` did not match a regex expecting `()`
> 4. merged widgets keep each view's settings in `_view-*.js`, so the parent
>    legitimately omits keys the form exposes — unioned in now
> 5. the `location` field owns city/lat/lon without naming a key, in BOTH
>    directions (weather seeds from home, sparkline just accepts one)
> 6. a widget that COMPOSES its FIELDS from other form modules (clock =
>    local + zones) declared no keys of its own
>
> I probed it before trusting it, per the standing lesson: deleting chess's
> `showMeta` field fails the build with the exact message.
>
> ### A deploy used to break any editor tab left open
> Reported from a real tab mid-session: `Failed to fetch dynamically imported
> module … WidgetSettingsModal-3XY4RAJ3.js`. Chunk names carry a content hash,
> a deploy replaces them, and the page only finds out when someone opens the
> settings modal. The card's own button called `retry()`, which re-rendered and
> refetched the same missing URL — the one control offered could not work.
>
> `retryOnStaleChunk` (`control-src/lazy-chunk.js`) wraps every `React.lazy`
> factory and reloads **once**, guarded by a sessionStorage timestamp: a reload
> fetches the new index.html and therefore the new names, so a second failure
> is a genuinely missing chunk and belongs on screen rather than in a refresh
> loop. Blocked storage counts as "already reloaded", so a page that cannot
> remember cannot loop. `ErrorBoundary` recognises the error class and says
> "This page is out of date" with a button that actually reloads.
>
> Verified by breaking it on purpose: loaded the editor, deleted the modal
> chunk from disk, opened a tile's settings — the page reloaded itself, and
> with the chunk still missing the second attempt showed the card without
> looping.
>
> ### Left hand-written: nothing
> Seven forms keep a custom control *inside* a schema — ai (feed chips),
> transit (station search writing stop + line + heading at once), headlines
> (saved feeds), text (token pairs + schedule), photo (uploader + live dither
> preview), calendar (feed rows with badge/save + active-feed switches),
> worldclock (IANA search). `clock` used to DISPATCH to whichever view form
> matched the variant; both view forms are lists now, so it concatenates them
> with a `when` per side, which also lets the guard see the whole widget at
> once.
>
> `test:api` 45/45 · `check:visual` 0.000% · both snapshots PASS ·
> `check:widgets` 22 · eink-lint clean. Live panel after the deploys: 6 tiles,
> 4 page rules, 7 type sizes all on the ladder, zero overflow, device on
> FW 1.26.0.

> ## 2026-09-22 — tiles join by subject; and the OTA closed itself
> ### The join was too narrow, and the question caught it
> Asked point-blank whether the widgets actually integrate when placed on the
> panel, the honest answer was no. D15 joined tiles of the same WIDGET, which
> in practice only ever helped the weather pair and a second clock — a calendar
> beside its task list still had a rule through it, and even where a rule was
> suppressed both halves kept their own 16px margin, leaving a **32px trough**
> down the middle of the thing that was supposed to read as continuous.
>
> The mechanism was right; the definition of "belongs together" was wrong.
> `ZONE_FAMILIES` (`control-src/widgets/_rules.js`) now resolves a tile to its
> **subject**, not its widget id:
>
> ```
> weather + outdoors      one glance out of the window
> clock + countdown       time
> calendar + tasks        agenda
> headlines + daily + ai  feed
> ```
>
> and `tileJoins()` reports which edges were joined rather than ruled, so the
> cell can halve its gutter there (`cell-join-left/right/top/bottom`). The same
> map drives SSR, the editor canvas and the preview, so a join you see while
> dragging is the join the panel draws.
>
> **Kept opinionated.** The alternative was a per-tile "group" field, which is
> the knob that taxes every add and gets set wrong. `settings.zone` still
> overrides in both directions — it can split a family or join widgets that
> share none — and has no UI on purpose.
>
> Three tests: a family pair joins while an unrelated neighbour keeps its rule;
> a partial seam is drawn for exactly the rows two tiles share (ruled against
> the clock above, joined against the forecast below); and `settings.zone`
> overrides the family both ways. `test:api` 45/45 · `check:visual` 0.000% ·
> both snapshots PASS · eink-lint clean.
>
> ### The OTA closed itself
> The device reports **FW 1.26.0**, last seen 2026-09-22T03:30Z. The thread
> opened on 09-18 — "a staged OTA never boots", then the correction "nothing was
> ever staged, the WRITE is failing" — resolved without further firmware work.
> It flashed on its own.
>
> Two things worth keeping from it. The roster is trustworthy on this now,
> because `checkDeviceAuth` refreshes `fw_version` from the `FW-Version` header
> every cycle (fixed 09-17, after the field had been frozen at the enrolled
> version for two months and made a working OTA look broken). And the
> diagnosis kit built for it — `/api/quiet-cycle` (`freeze` answers 304 to every
> image request so `checkForUpdate` runs on an unchurned heap;
> `suppressFirmware` answers 204 to the manifest) and the `/api/firmware/fetches`
> byte counter — went **unused**. Keep both: if a future release sticks, a short
> read means `Update.begin()` failed and a full read that still boots the old
> slot points at `Update.end()`.
>
> D1's DEFLATE path is also confirmed by this: 1.25.0 is what the device
> installed on the way to 1.26.0.
>
> **Next, unchanged in priority:** measure deep-sleep current on the assembled
> unit. It is still the number that decides whether any other power work is
> worth doing, and nothing since has made it easier to guess.

> ## 2026-09-21 (night) — D15: the tiles share one page
> Asked to research ways to make the widgets integrate into each other. The
> research says the tiles were never the problem — the page was, and it had no
> say over anything.
>
> ### Measured first, because "it feels like boxes" is not actionable
> One real eight-tile screen, instrumented in the browser rather than eyeballed:
>
> ```
> 32 text nodes · 11 distinct font sizes · 19 distinct baselines
> 2 of 9 tiles carried a label at all
> placeholders inset their text to 33px; everything else used 16px
> one tile clipped its own content and nothing reported it
> ```
>
> Every widget was internally tidy. That is exactly the failure mode: 22
> separately tidy widgets, each bringing its own type sizes, its own inner
> padding and its own line-height ratios.
>
> ### What the prior art says
> **TRMNL** buys consistency by *constraining composition* — eight fixed mashup
> layouts (`1Lx1R`, `2x2`, …), one `title_bar` component, and a deliberately
> tiny vocabulary of Title / Value / Label / Description / Divider that every
> plugin draws from. **Swiss editorial practice** is blunter: alignment is what
> joins things, hierarchy comes from a small type scale rather than ornament,
> and the grid *is* the design. We had the opposite — ornament (a border per
> tile) and no scale. Notably, borders were already there and the page still
> read as eight boxes, which is the tell: a border fences, it does not join.
>
> ### Four mechanisms, shipped (`e7614a6`)
> **1. Rules belong to the page.** `control-src/widgets/_rules.js` computes the
> seams BETWEEN tiles from the layout and draws them once in a layer over the
> grid; `.body-ruled .cell` draws no border of its own. Two tiles in the same
> zone — `settings.zone`, else the widget id — get no rule at all, so a weather
> hero beside its own forecast now reads as one L-shaped module. **Partial
> seams work, which a per-cell border cannot express**: a 9-wide tile against a
> 3-tall one gets a rule for exactly the rows they share. A seam is also drawn
> ONCE now; cells used to draw right AND bottom, thickening every interior
> crossing. One computation feeds SSR, the editor canvas and the preview.
>
> **2. One type ladder.** 11/13/16/20/25/32/40/50/64/80/100/128, ~1.25x steps,
> floor at the 11px the 1-bit render can hold. `autofit` snaps its binary-search
> result DOWN to a rung — only ever down, so a snapped element fits wherever the
> searched one did. The weather hero's per-tier constants (54/72/86/96, four
> sizes no other widget could ever match) became rungs. Then 64 declarations
> across 20 CSS partials and 7 widget modules were moved onto the ladder by
> script, because rounding down cannot overflow a box that already fit.
> Demo screen 11 sizes → 6. Whole widget matrix: 265 off-ladder text nodes → 0.
>
> **3. One inner margin, one label band.** The cell owns the inset; `.tr-card` /
> `.tr-body` stop insetting again (that double padding is why the same text
> started at x=16 in one tile and x=42 in the next). The three title systems
> that had drifted apart — `.tr-titlebar`, `.col-title`, `.widget-title` — are
> one band. The placeholder joins the same grid instead of floating in its own
> bordered card, and since it no longer paints its own white ground, the
> white-on-white title bug from this morning cannot recur.
>
> **4. `cell-short`.** Tiles ≤3 rows tighten their chrome rather than clip.
>
> ### Two bugs the measurements turned up
> **`.fc-icon .icon` hardcoded 38px**, overriding the width/height ATTRIBUTES
> the forecast render emits per tile height. Its 26/28/30/32/34/38 ladder had
> been dead for as long as the rule existed, every icon drew at 38, and on a
> 3-row tile that pushed the low temperature 21px past the edge where the panel
> clipped it. **The fix is to DELETE the declaration, not to set `auto`** — an
> attribute is a presentational hint that any stylesheet rule beats, `auto`
> included, and these SVGs carry no intrinsic size, so `auto` collapsed the
> icons to nothing. I shipped that wrong version to a render and caught it on
> the image. Sibling of the presentation-attribute gotcha in 015.
>
> **The forecast still overran by 4px afterwards**, which is what `cell-short`
> exists for.
>
> ### Verification
> Zero overflowing cells across all **153** matrix cells (there was one on the
> demo screen alone before), **1038** text nodes all on the ladder, both
> polarities rendered and read. `test:api` 42/42 · `check:visual` 0.000% ·
> both snapshots PASS · `check:widgets` 22 · eink-lint clean. All three
> baselines re-captured: the drift is the 4px padding change and seams now
> centred on the boundary instead of sitting inside one neighbour.
>
> **Left deliberately open:** `settings.zone` has no UI, so joins are automatic
> by widget id; and the two-role model (hero tiles carry no label, module tiles
> carry one) is a convention the renderers follow rather than a contract. D4's
> schema-driven forms would be the place to enforce it.

> ## 2026-09-21 (night) — "light/dark does not work", and why the migration could not save it
> **Confirmed working on the live panel after `4560582`.** Three commits to get
> there, and the interesting part is the order in which the diagnosis was
> wrong.
>
> ### The switch was real, the config outranked it
> `3e757d3` shipped `cfg.faceTheme` with tile-then-panel resolution: an explicit
> `settings.theme` wins, an unset one follows the panel. Correct design, and it
> left the live config unable to use the feature — because the OLD per-tile
> checkbox stored its value **both ways**. Running a black-on-white panel meant
> unticking it on every tile, so every tile carried `theme: 'normal'`, so every
> tile ignored the switch.
>
> **It was the production render that said so, not a test.** After deploying I
> fetched `/display.png` from Railway and got a black-on-white face, which is
> impossible under a `dark` panel unless the tiles are overriding it. The
> fixtures could never have shown this: they carry no per-tile themes.
>
> ### v12, first attempt: right instinct, wrong value (`f39f256`)
> v12 already dropped `'inverted'` (it is what an unset theme means, so removing
> it cannot change a render). I had kept `'normal'` on the reasoning that it is
> "the one value nobody writes by accident" — **wrong: the checkbox wrote it for
> them.** Stripping it blindly would have flipped a working panel to its
> opposite on the next render, so v12 now *lifts* instead: when every tile on
> every screen says `'normal'` and the panel states no theme, that one decision
> becomes `faceTheme: 'light'` and the copies go. Render-identical, all-or-
> nothing, and a mixed config keeps every explicit value.
>
> ### …and it still did not fire, because the config was already half-changed
> Reading the live config through `/api/config?token=` settled it:
>
> ```
> gridVersion: 12 | faceTheme: dark | tiles: 8 | {"normal": 7, "(unset)": 1}
> ```
>
> `faceTheme` was set — the switch HAD been used — and one tile had no theme at
> all, so the lift's "every tile agrees" precondition failed. **A migration can
> only rescue a config it recognises, and a half-broken feature produces shapes
> it does not.** Worth remembering the next time a migration looks like the
> whole answer.
>
> ### So the control took responsibility (`4560582`)
> Setting the panel colour now **clears every per-tile theme override in one
> action**, which is what "one click, not every widget" has to mean. Destructive,
> so it reports what it did ("cleared 8 tile overrides"), undo covers it, and the
> tile modal's three-way re-pins a genuine odd-one-out afterwards — a deliberate
> act rather than a leftover.
>
> ### Two bugs found while verifying that
> - **Every toast in the editor was silent.** `showToast()` set state and NO JSX
>   consumed it — there was no toast renderer in `App.jsx` at all. The tidy
>   result ("3 tiles did not fit and were left out"), the duplicate
>   confirmation, and worst the delete-with-UNDO pattern, whose whole safety net
>   is an action button on a toast nobody could see. Rendered now, actionable
>   variant included. Unknown how long it had been dead.
> - **Mine:** the cleared-override counter was incremented INSIDE the `setCfg`
>   updater, which React runs on its own schedule, so `showToast` read 0 and the
>   message silently dropped the number. Count before you set.
>
> `test:api` 42/42 · `check:visual` 0.000% · both snapshots PASS ·
> `check:widgets` 22. Verified in a browser against a config in the production
> shape (seven `'normal'` tiles + one unset, `faceTheme: dark`): one click flips
> the whole canvas and reports the count. Then confirmed by the user on the
> real panel.
>
> **Deploy note.** Four pushes in ~25 minutes produced three `REMOVED`
> deployments — each build cancelled by the next, exactly gotcha 15's shape.
> They were harmless only because each superseding commit was a later commit on
> the same branch. Verification was `/static/dashboard.css` carrying a string
> added in that commit, plus the Railway deployment's own status; `/health`
> would have said nothing.

> ## 2026-09-21 (later) — the settings UI, and the migration the invert switch needed
> The panel-wide polarity switch shipped earlier today exposed a problem it
> could not fix on its own, plus a settings surface that had drifted: two
> device-wide settings were filed under screen-shaped headings, and a per-tile
> control started lying the moment the panel gained a setting of its own.
>
> ### v12 — old tiles could not hear the switch
> `settings.theme` on a tile outranks `cfg.faceTheme`, which is right for a
> deliberate odd-one-out and wrong for the tiles that carry `theme: 'inverted'`
> only because the old per-tile checkbox wrote back the value it was already
> displaying. Those tiles would have ignored the new switch entirely — which is
> exactly the visit-every-widget chore the switch exists to remove.
>
> **v12 drops `'inverted'` and keeps `'normal'`.** Dropping it cannot change how
> anything renders today, because an unset theme already means inverted; it only
> lets the panel switch reach the tile. `'normal'` stays because it is the one
> value nobody writes by accident. Idempotent by construction — after one pass
> there is nothing to remove, and a tile pinned deliberately after the config has
> been stamped v12 is never fed to it again. Both seeds went into the
> `migrations are idempotent` list and there is a dedicated test.
>
> ### The tile modal's Appearance section was a checkbox that lied
> It read "inverted" from an ABSENT theme, which now means "whatever the panel
> is" — so on a light panel it claimed a tile was white-on-black while the tile
> was rendering black-on-white. Three states now, because there are three:
> **Match the panel** (no key — the absence IS the state), **Always white on
> black**, **Always black on white**. The "match" label names the panel's
> current setting, and the help text points at where to change it.
>
> ### Where a setting lives
> - **Screen settings** — name, units, **tile style (dividers / cards)**,
>   refresh interval, schedule. Tile style used to be a toolbar button whose
>   tooltip called it a prototype; it is a property of the screen, like its
>   units, so it sits with them.
> - **Settings → Panel** — Colours (the polarity switch) and **Quiet hours**.
>   Quiet hours is device-wide and was living under the schedule timeline,
>   which is about screens; CLAUDE.md had been telling people to look in
>   Settings for a year, and now that is true.
> - **The toolbar keeps actions** — TIDY / 1-BIT / CLEAR / DUPLICATE, plus the
>   polarity button because one click is the whole point of it.
>
> Both settings rows carry their current value on the right (`.settings-row-value`):
> a row that says "white on black" or "follows the sun" answers the question
> without being opened.
>
> `test:api` **41/41** · `check:visual` 0.000% · `check:widgets` 22 ·
> eink-lint clean · editor snapshot re-captured (leaner toolbar).
>
> Checked in a real browser at desktop and 375px: the menu fits the viewport at
> both, the quiet-hours block expands inside it, and the canvas follows the
> polarity switch live while the save bar is still dirty.

> ## 2026-09-21 — the face: dividers that were black on black, and a panel-wide invert
> Three fixes, all found by rendering a realistic eight-tile screen through
> `/display.png` instead of trusting the fixtures. The fixtures are
> deterministic on purpose, which also means they show almost nothing about
> how the face reads.
>
> ### An unconfigured tile was a blank white rectangle (`c8340cb`)
> `markets`, `headlines` and `tasks` with no config came back as empty white
> cards with one black blob in the corner. Two colour assumptions, both the
> same class as the `.face-art` rule:
>
> - `.widget-placeholder` paints its own white background but never declared
>   its own ink, so inside a `cell-inverted` tile it inherited `color: #fff`
>   from `.cell.cell-inverted *` and the title rendered **white on white**. At
>   `ph-sm` (h ≤ 3) the hint and the badge are deliberately dropped, so the
>   title is the only text there is — those tiles said nothing at all, on the
>   default theme, for as long as the tier has existed.
> - `.cell.cell-inverted .ph-icon svg { filter: invert(1) }` applied the
>   *cell's* polarity to an icon sitting on the *card's* white background.
>   That made the blob. It also survived the first fix — correcting the
>   fill/stroke just gave the filter black strokes to invert back to white,
>   and the icon vanished entirely. The placeholder is the one thing in an
>   inverted cell that keeps its own background, so it now opts out of the
>   invert and defends its inline SVGs against the white-repaint rule instead.
>
> ### Tiles had no separation (`3e757d3`)
> `.cell` has always drawn the grid lines as `border-right/bottom: 2px solid
> #000`, and `.cell.cell-inverted *` repaints DESCENDANT borders white but
> never the cell's own. Inverted is the default, so **every divider on the
> panel was black on black.** `.cell.cell-inverted { border-color: #fff }`.
> Only the colour: the edge-suppression rules set `border-*: none`, which
> kills the style, so the page edge and the footer still have no duplicate
> line. Card mode needs the same override in its own partial because its
> `border` shorthand is later and equally specific.
>
> ### One click to invert the whole panel (`3e757d3`)
> `cfg.faceTheme` (`'dark'` | `'light'`, default dark) flips every tile on
> every screen from a toolbar button next to 1-BIT. Before this the only
> control was per-tile `settings.theme`, so changing the look meant opening
> every tile in turn.
>
> Resolution is **tile-then-panel**: an explicit `theme: 'inverted'` or
> `'normal'` still wins, so a deliberate odd-one-out survives the flip, and an
> unset theme follows the panel. Default `dark` is exactly what an unset theme
> already did — no config changes meaning, no migration.
>
> Threaded as an argument through `cellClasses` / `tileCellClasses` rather than
> a module-level global, and the editor surfaces read it off `previewData.cfg`
> — the object that already carries live cfg edits, so the canvas flips while
> the save bar is still dirty. All four surfaces (SSR, canvas, modal preview,
> form preview) go through the one helper; that is the `193b74b` parity path.
> The grid container also gets `body-dark` / `body-light`, because uncovered
> grid area and every card-mode gap would otherwise stay white while the tiles
> around them are black. The editor canvas carries the same class.
>
> Also fixed: the weather hi/lo line wrapped mid-pair on a narrow column
> (`hero-split` puts the icon beside the text), orphaning `LOW 70°` on its own
> row. Two nowrap spans in a flex row now, and the `·` separator is gone —
> **CSS cannot tell that a line wrapped**, so the dot would have been left
> dangling at the end of the first row. A wider `column-gap` reads correctly in
> both states.
>
> `test:api` 40/40 · eink-lint clean · `check:widgets` 22 · all three visual
> baselines re-captured (the dividers are a deliberate 0.94% of the page).
>
> **Unverified on glass:** everything here is from `/display.png`, not a photo
> of the panel. The dividers in particular are worth a look — 2 px of white
> between every tile is a real change in how the face reads.

> ## 2026-09-18 — DEFLATE on the wire, a staleness mark, and an OTA that still will not write
> **State at the end of the night: FW 1.26.0 is built and published, and the
> device is still on 1.24.0.** The OTA write — not the boot selection — is the
> open thread, and the last commit is a correction to the two before it. Read
> the OTA section before touching `checkForUpdate`.
>
> ### D1 — the panel image DEFLATEs, 96000 → ~2055 bytes (`cf9d8c3`, FW 1.25.0)
> The image fetch is 6–9 s of radio at 100–300 mA and is almost entirely
> transfer. The two-plane binary is mostly runs of identical bytes: **46.7×** on
> a typical frame. (The vault recorded 16.1× for gzip at the default level; raw
> DEFLATE at level 9 does better on this data.)
>
> **Not `Content-Encoding: gzip`, deliberately.** The device would have to parse
> a gzip header before inflating, and that header is variable-length with
> optional FNAME/FEXTRA; raw DEFLATE has no header at all. And
> `Content-Encoding` is a negotiation any intermediary may decode, re-encode or
> strip — **Railway sits in front of this** — while a private header nothing
> else understands passes through untouched, which is what a body read off the
> raw socket needs. The contract is ours end to end: the device sends
> `X-Accept-Deflate`, a server that honours it answers `X-Body-Deflate: 1` plus
> `X-Raw-Length`, and a server that has never heard of the header returns the
> raw body. It degrades in both directions; neither side needs the other's
> version.
>
> `Content-Length` still describes the bytes actually on the wire, so **gotcha
> 10 stays closed**, and `test:api` asserts it on a raw socket for the
> compressed response too, including that it inflates byte-identical to the
> uncompressed request. That check is worth more here than on the identity path:
> a chunk header landing inside a compressed stream corrupts the entire frame
> rather than shifting it sideways.
>
> Firmware uses the ESP32 ROM's **miniz (tinfl)** — the whole decoder costs
> 1,444 bytes of flash. The body is buffered and inflated in one shot rather
> than streamed: it is a few KB, and this is the path that draws to the panel
> off a raw socket, where a partial-input state machine is exactly the kind of
> thing that cost two sessions last time.
> `TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF` lets tinfl back-reference into the
> 96000-byte frame buffer instead of allocating a 32 KB window, and the ~11 KB
> decompressor goes on the **heap** — `tinfl_decompress_mem_to_mem()` puts it on
> the stack and the Arduino loop task stack is 8 KB, so it would smash it.
>
> **Fails safe.** Any inflate problem increments an RTC-backed counter and
> returns nullptr; after 2 strikes the device stops sending `X-Accept-Deflate`
> entirely. `downloadImage` retries up to 3× per cycle, so a server that cannot
> produce an inflatable body costs one cycle and the third attempt already draws
> raw bytes. A success resets the counter. Worst case is losing the compression,
> never the panel. **Still unverified on glass: the inflate itself.** The
> fallback is what made it acceptable to ship unverified.
>
> ### D6 — let a frozen panel admit it (`dd31e7e`)
> An e-ink screen showing yesterday's weather is indistinguishable from one
> showing today's. If background re-renders keep failing the device is handed
> the same cached frame and the panel looks perfectly healthy. The audit's
> ceiling on stale-while-revalidate stops the frozen-for-days case, but inside
> that window the display still could not say that what you are reading is old.
>
> Past `IMAGE_STALE_MARK_MS` (10 min, env-tunable) a dashed rule is composited
> along the bottom edge — red on the B panel, black on mono. **The signal is a
> FAILED re-render, not age.** An old frame nobody asked to refresh is fine; the
> thing worth putting on glass is "we tried and could not". The failure is
> recorded on the cache entry, and a successful render replaces the entry
> wholesale, so it clears itself — there is no reset path to forget to call.
>
> **Drawn into the PACKED bytes, not the HTML**, on purpose: the whole situation
> is that rendering is broken, so anything needing Puppeteer is exactly what is
> unavailable. This works on the bytes already in cache.
>
> The ETag forks to `…-stale` when marked — otherwise a device that already drew
> the clean frame 304s and never sees the warning, which is the one case where
> the warning matters. It flips exactly twice (clean → stale → clean) rather
> than encoding the age, because a per-minute ETag would spend a 26 s colour
> refresh every wake, for as long as the outage lasted, to say the same thing.
> `X-Image-Stale-Seconds` / `-Failures` carry the detail for anything reading
> headers. The dash is byte-aligned, 8 px on 8 px off, so each row byte is
> wholly ink or wholly gap; gap bytes are written white so the rule reads as
> deliberate. Bit conventions matter: in both planes bit 0 is ink and a red
> pixel is "no black, yes red", so the bar writes `0xff` into plane 0 and `0x00`
> into plane 1. The calibration target is synthetic and never marked.
>
> ### The OTA, in three wrong-then-right steps
> **`832ddff` (FW 1.26.0) — restart after a successful write.** 1.24.0 set
> `rebootOnUpdate(false)` so an update could be staged and picked up by the next
> natural wake. The device disproved it: `b-1.25.0.bin` downloaded at 03:36, the
> device woke at 04:17 still running 1.24.0 and downloaded the same binary
> again. It would have done that forever. The reasoning at the time was that
> ESP-IDF's bootloader caches the boot partition in RTC retain memory and on a
> deep-sleep wake boots it directly without consulting otadata — a deep-sleep
> wake is a reset, but not one that re-runs partition selection. So: restart
> explicitly once the write succeeds, still at the END of the cycle, after the
> draw. The second refresh it looks like it costs does not happen, because
> `g_lastEtag` is `RTC_DATA_ATTR` and survives a software reset, so the
> post-reboot cycle sends `If-None-Match` with the ETag it just drew and gets a
> 304. Restarting in the `HTTP_UPDATE_OK` case rather than via
> `rebootOnUpdate(true)` keeps the log line and the flush before it.
> **Also: OTA failures now queue a device log.** They were Serial-only, which is
> why this stayed invisible for two cycles — the only symptom reachable from
> here was the same binary appearing twice in Railway's HTTP log.
>
> **`ae34b8d` — quiet cycle, so the button hold is usable.** The firmware's
> staged button-hold ends in `ESP.restart()`, which was the only way to boot an
> OTA 1.24.0 had staged but could not switch to. But the hold's 2-second timer
> starts only AFTER `runCycle` returns, and `runCycle` is ~35 s because the
> tri-colour panel takes ~26 s to draw, plus ~15 s more re-downloading an update
> it will never apply. Asking someone to hold a button for a minute, through a
> beep that sounds like completion, is not a recovery procedure. Both costs are
> server-side decisions, so the server drops them: the manifest answers 204 and
> the image answers 304. `GET/POST/DELETE /api/quiet-cycle`, admin auth,
> **deadline-bound with a 30-minute ceiling and in-memory so a redeploy clears
> it** — while it is on the panel is deliberately frozen, so a flag that could
> be left set is precisely the confidently-stale display D6 exists to catch.
>
> **`357f4b8` — CORRECTION: nothing was ever staged.** The device rebooted via
> the portal at 05:23:12 and still came up on 1.24.0. A software reset *does*
> consult otadata, so the boot selection was never the problem — **the OTA write
> is failing.** The likely cause is the other half of what 1.24.0 changed:
> `checkForUpdate` moved to AFTER the draw. `downloadImage()` allocates the
> 96000-byte frame buffer, `pushImage()` draws, then it is freed — so the OTA now
> runs in the most fragmented heap state of the cycle. The file already warns
> about exactly this ("the handshake allocates ~40 KB, so a 96000 contiguous
> malloc AFTER it often fails … heap fragments"), which is why the buffer is
> reserved before TLS. The OTA went on the wrong side of it.
>
> That is fixable from the server without touching firmware, because a 304
> returns before `downloadImage` allocates anything and skips the draw entirely,
> so `checkForUpdate` runs on an unchurned heap. Quiet cycle therefore split
> into two independent switches:
>
> ```
> freeze            304 every image request -> no big alloc, no draw
> suppressFirmware  204 the manifest        -> no download at all
> ```
>
> **The recovery combination is `freeze` ON, `suppressFirmware` OFF**: keep
> offering the update, but let it be written under good conditions. `freeze` now
> answers 304 even with no `If-None-Match` — a button wake deliberately clears
> its stored ETag to force a redraw, so gating on the header exempted exactly
> the cycle that needed to stay short, which is why the first attempt still did
> a full 26 s draw on the button press.
>
> `/firmware/:file` is instrumented with a byte counter, readable at
> `GET /api/firmware/fetches`. `httpUpdate` calls `Update.begin()` before
> draining the body, so **a `begin()` failure shows up as a short read, while a
> full read that still does not boot points at `Update.end()`**. The counter
> measures bytes Node wrote; on loopback the kernel buffers everything and it
> always reads complete, so it is only meaningful against a real device over
> WiFi.
>
> `test:api` 40/40 · `check:visual` 0.000% · eink-lint clean.
>
> **Where this stands:** the recovery combination has not been run against the
> device yet. Next session: turn quiet cycle on with `freeze` ON /
> `suppressFirmware` OFF, wait a wake, then read `/api/firmware/fetches` and
> `/api/logs` — short read means `Update.begin()`, full read that still boots
> 1.24.0 means `Update.end()`.

> ## 2026-09-17 (night) — four firmware releases, and a roster that lied about all of them
> **The device was never stuck.** It reported FW `1.20.1` in `/api/devices`
> and in every line of `/api/logs`, two releases behind, for two months. It was
> actually running the current build the whole time. `fw_version` was written
> ONLY by `/api/setup` at enrollment, and `enrollDevice()` is a no-op once the
> device holds an api key, so it never ran again — the field froze at whatever
> the unit first enrolled with, and `routes/devices.js` reads `dev.fw_version`
> first so the log feed inherited the same stale value.
>
> That is worse than showing nothing. It made a *working* OTA look like a
> broken one, and I spent a real stretch hunting a phantom OTA failure —
> checking `addToken`'s `?`/`&` handling, heap pressure against
> `httpUpdate`, `activeServerBase` selection — before checking the one thing
> that settles it.
>
> **Ground truth for "did it flash?" is Railway's HTTP log, not the roster.**
> `httpUpdate` fetches the binary with user-agent **`ESP32-http-Update`**,
> distinct from `ESP32HTTPClient` on every other request. One line with that
> UA is proof; the version field is hearsay. Also note each Railway deployment
> has its OWN log stream — a cycle that happened against the previous
> deployment is invisible unless you query that `deploymentId` directly. The
> first OTA of the day only turned up that way: deployment `374b7a28` was live
> for **three minutes** and the device woke inside that window.
>
> Fixed: `checkDeviceAuth` now passes the `FW-Version` / `FW-Board` headers
> (already sent on `/display-3c.bin` every cycle) into `touchDevice`, which
> refreshes the record alongside `last_seen_at`. Sanitised — trimmed, rejected
> if empty, >32 chars, or not printable ASCII.
>
> ### 1.22.0 — a full battery never slept
> `VBAT_USB_THRESHOLD 4.10f` inferred "on USB" from battery voltage. The
> comment argued a TP4056 holds VBAT at ~4.2 V while charging and a
> disconnected cell "drops to ~3.7 V soon after" — but **a LiPo straight off
> the charger RESTS at 4.15–4.20 V**. Same reading. So a freshly charged
> device on battery took the stay-awake branch and burned ~125 mAh (~2 h at
> ~60 mA) after every single charge before self-discharging past the
> threshold.
>
> Battery voltage *cannot* separate the two cases, so this was NOT replaced
> with a better threshold — it became a build-time `DEV_STAY_AWAKE` flag,
> default 0. The honest runtime fix is a VBUS sense wire to a spare RTC GPIO;
> noted in the vault hardware note. Found while writing up the deep-sleep
> measurement, which it would have silently invalidated: charge the unit, put
> a meter on it, and you measure the active loop rather than deep sleep.
>
> ### 1.23.0 — the dead alarm loop
> `1759fd7` removed the scheduled-alarm feature server side on 09-15 and said
> the firmware loop "comes out on the next flash". Until now every wake still
> called `/api/alarm/next` **twice**, both 404. Removed `fetchNextAlarm`,
> `runAlarm`, `drawAlarmScreen`, `struct NextAlarm` and both defines. KEPT
> `beepChime` / `beepLowBattery` (that commit was explicit the buzzer stays)
> and `syncTime()` — its comment claimed it existed to anchor the alarm check,
> but `time(nullptr)` still stamps `g_lastGoodAt`, which would otherwise read
> 1970 on the fail screen.
>
> ### 1.24.0 — seamless OTA
> `checkForUpdate` ran BEFORE the draw and rebooted on success, so finding an
> update cost ~33 s of flash + reboot before the ~26 s redraw the user was
> waiting on. That is why button wakes skipped OTA — the skip was treating the
> symptom, and timer wakes paid the same cost unwatched.
>
> Now it runs at the END of `runCycle`, after the panel is already correct,
> with **`rebootOnUpdate(false)`**: httpUpdate stages and validates the
> inactive slot, marks it bootable, returns, and the device deep sleeps.
> Waking from deep sleep is a CPU reset, so the bootloader brings up the new
> build on the next natural wake — no visible reboot, and no second 26 s
> redraw an immediate reboot would force. An interrupted flash never gets
> marked bootable, so the old slot keeps booting. It also runs when the draw
> FAILED — a device that cannot render most needs to update itself.
>
> **Zero extra requests.** `/display-3c.bin` now carries `X-Firmware-Latest`
> for the caller's `FW-Board`, on the 304 path too (unchanged image is the
> common case). The device caches it and skips the manifest entirely unless
> the advertised version is newer. The manifest stays authoritative — it hands
> out the URL — this is only a hint deciding whether to ask, and its absence
> falls back to asking, so it can only save a request. Server side it is a
> 60 s TTL cache over `findNewestFirmware`, because that endpoint serves from
> the image cache in ~0.6 ms and must not grow a readdir per request.
>
> Measured on the real device: cycle went from 5 requests to **3**, wake →
> redraw from **2m 23s** (the last old-style flash) to **~9 s**. A button
> press at 18:40 UTC produced two image fetches (the `do/while` re-refresh,
> second one a 26 ms 304) and **zero OTA traffic** — the check happened and
> cost nothing.
>
> ### The GxEPD2 trap, and a wrong call I nearly shipped
> The sketch stopped compiling locally: 111 errors, all rooted in
> `GxEPD2_750c_GDEY075Z08` being undeclared. I concluded GxEPD2 had removed
> the class and proposed swapping to `GxEPD2_750c_Z08`. **Backwards.** That
> class lives in GxEPD2 `src/gdey3c/` and was **added in 1.6.7**; CI pins
> **1.6.9** and builds fine. The local copy was **1.6.5** — older than the
> class, not newer. `GxEPD2_750c_Z08` is `epd3c` / GDE**W**075Z08, a different
> panel's driver, and the workflow's own comment warns a silent change there
> "can move the image on glass".
>
> Two things saved it. The git history showed `c540d6e` had already made that
> exact swap and `6362225` reverted it two days later — chasing a ~1.5-column
> offset that turned out to be the chunked-framing bug, not the panel. And CI
> had just built the same source successfully, which is impossible if the repo
> were broken. **A local compile failure on a file CI builds is a toolchain
> drift, not a code bug.** Fix is `arduino-cli lib install "GxEPD2@1.6.9"`.
>
> Also: GxEPD2's directory held **180 macOS `<name> 2.cpp/h` duplicates** under
> `src/`, left by an in-place version replace. They fail with "no declaration
> matches" errors that read like library bugs. Moved aside, not deleted.
>
> ### Smaller things
> - Client `GRID_VERSION` realigned 10 → 11 (`c269925`). Not load-bearing —
>   the client migrator only implements v1–v4 and `saveConfig` stamps the
>   server's version — but it is the exact constant behind `16958d0`.
> - `.gitignore` now covers `esp32/*/build/`.
> - **Firmware ships by CI.** A push touching `esp32/**` builds both boards and
>   commits `public/firmware/<board>-<version>.bin` back to main with
>   `[skip ci]`. Bump `FW_VERSION` and push; do NOT build and commit a `.bin`
>   yourself — I did once and raced the bot for the same filename.
> - Build with `PartitionScheme=min_spiffs`. At 1.24.0 the sketch is
>   1,304,039 B = **66% of the 1.9 MB OTA slot**. A 97% figure means you built
>   against the default 1.2 MB scheme, which this board does not run.
>
> `test:api` 38/38 · `check:visual` 0.000% · device confirmed on 1.24.0 via
> `ESP32-http-Update` in the Railway log.
>
> **Still unproven:** the staged-flash path itself. `rebootOnUpdate(false)`
> does not exercise until there is a 1.25.0 to install — the 1.23→1.24 hop was
> performed by 1.23.0's old code. Watch the next release for a wake with no
> visible reboot.

> ## 2026-09-17 (evening) — the world clock silently became a second local clock
> **Found on the panel, by eye, not by any test.** A Saigon tile showing
> 9:01 PM came back after a refresh as 10:02 AM — an exact duplicate of the
> local clock beside it. Fixed in `16958d0`, verified live: the panel now reads
> `10:08 AM · THU SEP 17` ‖ `9:08 PM · SAIGON`.
>
> **The chain.** The editor runs its own hand-mirrored `migrateConfigToScreens`
> and stamps its own `GRID_VERSION`, which had drifted to **4** while the
> server reached **10** — the constant literally carries a comment saying "keep
> both in sync". Saving from the browser wrote `gridVersion: 4` over an
> already-migrated config. The next load re-ran **v5**, whose frozen
> `V5_LIVE_VARIANTS.clock = ['big']` is correct for v5-era clocks — but v5 runs
> **before v9**, and v9 is what creates `clock/zones`. So v5 judged a v9-era
> tile by v5-era rules and deleted the variant. The `zones` ARRAY survived, so
> the tile still looked configured and fell through to `VIEWS.big`.
>
> **The general lesson, and it is the important part:** the migration chain
> runs on every config load and is never written back, so it is permanently fed
> its own output. **Idempotency is therefore a correctness requirement, not a
> nicety.** It was not idempotent — pass 2 lost the variant and every pass
> after kept it lost. The audit earlier the same day wrote down "every
> migration must be idempotent and stable forever" as prose and did not test
> it. One test asserting a fixed point would have caught this before it reached
> the panel. **That test now exists** (`migrations are idempotent`) and it
> fails on the old code.
>
> **Three independent barriers now:**
> - `POST_V5_VARIANTS` (lib/screens.js) — variants that LATER migrations create
>   for a widget that already existed at v5. `V5_LIVE_VARIANTS` stays frozen.
>   **Any future merge that gives an old widget id a new variant must be added
>   here**, or the strip will eat it.
> - `saveConfig` stamps the SERVER's `GRID_VERSION` on every write
>   (lib/config-store.js). A client is not the authority on the server's
>   schema; whatever it sends, what lands on disk is what this server migrated
>   to. Verified: disk went 4 → 10 → 11 and stayed.
> - The client constant is realigned and no longer load-bearing.
>
> **Plus a repair, v11.** Fixing the code does not bring back a variant already
> deleted from disk. `repairStrippedZoneClocks` fills it in when a `clock` tile
> carries a non-empty `zones` array — unambiguous, because the local clock view
> never reads `zones` and `clock`'s `defaults()` do not include it, so nothing
> else produces that shape. One zone → `zones_big` (large single place),
> several → `zones` (label/time rows). Idempotent; never overrides an existing
> variant.
>
> `test:api` 38/38 · both visual snapshots 0px · `check:visual` 0.000%.
>
> ## 2026-09-17 (later still) — D2, sun-driven quiet hours
> `cfg.quietHours` gains `mode: 'fixed' | 'sun'`. Sun mode sleeps from
> sunset+60min to sunrise-60min instead of a fixed clock window, because the
> window you want is "while the panel is unreadable" and that moves by hours
> across the year.
>
> **Measured: 48 → 31 wakes/day, 35% fewer** (43% December, 28% July), wake
> energy 19.3 → 12.6 mAh/day. Ships **disabled**, default mode `sun`, so no
> existing device changed behaviour.
>
> **`lib/sun.js` computes sunrise/sunset locally** — NOAA equation, no network,
> no async. The `sun` widget's Open-Meteo fetch is deliberately NOT reused: a
> cadence decision must not depend on an upstream being up, and
> `quietMinutesRemaining` is synchronous. Verified against published times for
> London, New York, Gainesville and **Tokyo** — Tokyo specifically, because the
> sign of the `lon/360` term is what implementations get backwards and a flip
> is nearly invisible near Greenwich while being ~9 h wrong at 140°E. I tested
> both conventions numerically rather than trusting the formula.
>
> The whole path works in **epoch ms**, which removes timezone arithmetic
> entirely. Nights are found by scanning day −1/0/+1 so the UTC day boundary
> never matters at any longitude. Polar day/night returns null and the feature
> just does not engage.
>
> **New safety rail: `QUIET_MAX_SLEEP_MIN` (240) caps a single quiet sleep in
> BOTH modes.** The device is unreachable while asleep, so a bad window — wrong
> timezone, clock skew, an arithmetic slip — silently takes the panel off the
> air for however long it was told. The cap means the worst case is one extra
> wake. Fixed mode previously could hand out 1440 minutes.
>
> No firmware change needed: `X-Refresh-Seconds` already accepts [10, 86400]
> and casts to `uint64_t` before the µs multiply. Verified end to end with a
> Tokyo config at 22:53 JST → `X-Refresh-Seconds: 14400`, and `/status` reads
> `240 min · quiet hours (sun) · sunset 17:47 → sunrise 05:25`.
>
> **Both of my tests were wrong first**, and the reasons generalise:
> - Fixed mode goes through `localMinutesNow`, which reads `new Date()` —
>   stubbing `Date.now` does not affect it, so the test silently read the wall
>   clock and would fail outside 01:00–06:00 UTC.
> - The "offsets swallow the night" case used a ~12 h September night that
>   2×180 min cannot swallow. Now uses a ~5.2 h midsummer night at Oslo.
>
> `test:api` 36/36 · both visual snapshots 0px · `check:visual` 0.000%.
>
> ## 2026-09-17 (later) — the whole audit, fixed
> A deep scan found 20 bugs/inefficiencies; all are now fixed or deliberately
> closed with the reason recorded. Commits `efdc1a9` · `18f8d00` · `06af986` ·
> `66dcc19` · `240b97a` · `117dd55`. Full writeup lives in the Obsidian vault
> (`EInk Modular — Audit 2026-09-17`), which is now the project's main context
> channel alongside this file.
>
> **The worst finding was a chain, not a bug.** `sharp@0.33.5` carried
> high-severity libvips/libheif CVEs, and the bytes it decodes come from
> `photo` widget `settings.imageUrl` → `fetchPublicUrl` (whose SSRF guard
> checked only the FIRST url, then let `fetch` follow redirects anywhere) →
> `arrayBuffer()` (uncapped). Three findings that each read as moderate alone.
> All three links are closed: sharp 0.35.4, per-hop redirect validation, and a
> byte-counting size cap in `_fetch.js`.
>
> The sharp bump was **verified byte-identical before applying** — libvips
> 8.15.3 → 8.18.6, and `sha1(display.bin)` / `sha1(display-3c.bin)` match
> exactly on both versions. That is what the visual suite is for.
>
> **Auth:** `/api/auth/login` had inherited the general 300/min limiter — a
> number raised from 60 *because the editor is chatty*. A 4-digit PIN fell in
> ~33 minutes. Now a dedicated 10/15min limiter plus a persisted failure
> counter with doubling backoff, checked BEFORE the PIN compare so a locked-out
> caller cannot use the response as an oracle. Changing the PIN now rotates
> `sessionSecret`, which it did not: every cookie issued under the old PIN
> stayed valid for 30 days.
>
> **Two bugs the FIXING introduced, both caught by tests rather than review:**
> - **CSP `script-src 'self'` silently blocked the inlined autofit pass.** Text
>   rendered at fallback metrics and the panel moved **0.347%** — under
>   `check:visual`'s 0.50% threshold, so it would have shipped as a real
>   regression that only the pixel diff could see. Inline scripts are now
>   hashed (`lib/csp.js`); **wrap any new inline script in `allowInlineScript()`
>   or it will be blocked.** Back to 0.000%.
> - **The first bounded cache deleted expired entries on read**, which removed
>   the serve-last-good-on-upstream-failure fallback at exactly the moment it
>   is needed. `BoundedMap` is now a Map subclass that only bounds *size*; each
>   fetcher keeps its own TTL logic untouched.
>
> **And two tests that passed for the wrong reason**, worth remembering as a
> class: a redirect test whose server was on loopback was blocked at hop 0 and
> followed zero redirects; and an assertion that an under-declared
> `content-length` would overrun the cap, when HTTP framing truncates at the
> declared length so it cannot. Both rewritten to assert the real behaviour.
>
> Also: `atomicWriteFile` was atomic but not durable (no fsync — a power loss
> could leave the zero-length config.json that `loadConfig` correctly refuses
> to recover from); one failed render called `killBrowser()` out from under a
> concurrent one; stale-while-revalidate had no ceiling so a permanently
> failing re-render served the same frame forever while the panel looked
> healthy; thirteen widget caches never evicted; the AI prompt's label map had
> rotted to describing 10 of 22 widgets; and `dev.last_seen_at` was bumped in
> memory only, which misled the token-rotation debugging earlier the same day.
>
> Left alone on purpose: `normalise()`'s content-dependent threshold (real, but
> the fix costs contrast and nothing has misbehaved), and persisting migrations
> (`loadConfig` runs inside `withConfigLock` in four places and the lock has no
> reentrancy — the constraint is now documented at the top of `lib/screens.js`).
>
> **`npm audit` still reports 4 high, on purpose.** All are `extract-zip` via
> `@puppeteer/browsers`, reachable only when puppeteer downloads and extracts a
> browser — which this project never does (`PUPPETEER_SKIP_DOWNLOAD=1` +
> nix chromium in `nixpacks.toml`, system Chrome locally). `puppeteer@25.11.0`
> clears them and passed all three snapshots at 0 px, but it was **reverted**:
> production renders against nix's chromium at an unknown version, puppeteer 25
> speaks a newer CDP, and a mismatch means every render fails and the panel goes
> dark — to fix code that never executes. Do it when someone can watch the
> deploy.
>
> **Local install gotcha found while reverting:** `npm ci` fails on this machine
> because puppeteer's postinstall tries to download Chrome and trips over a
> half-downloaded `~/.cache/puppeteer/chrome-headless-shell` directory. Use
> `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` (and delete that cache dir if it is already
> broken). Related to CLAUDE.md gotcha 1.
>
> `test:api` 33/33 · both visual snapshots 0px · `check:visual` 0.000% ·
> `check:widgets` 22 · `eink-lint` clean.
>
> ## 2026-09-17 — QR, chess, moon and the world clock all rendered blank
> `check:visual` had been failing at ~91% and I'd written it off as a stale
> baseline. It wasn't only that. The fixture's QR was a solid white square,
> and chasing that found one CSS rule breaking four widgets on the DEFAULT
> theme.
>
> **`015-body-grid-system.css`:**
> ```css
> .cell.cell-inverted svg rect { fill: #fff; stroke: #fff; }
> ```
> It paints every shape in an inverted cell white. Correct for a monochrome
> glyph, fatal for an SVG carrying its own two tones — and **presentation
> attributes (`fill="#000"`) lose to any stylesheet rule**, so the widget
> cannot defend itself in markup. Casualties: the QR's backing square and its
> data modules are both `<rect>` (blank white block, unscannable); the chess
> board lost its squares and its pieces; the moon lost its disc.
>
> Fix is opt-out, not a pile of exceptions: the rule is now
> `svg:not(.face-art)`, and an SVG that means its own colours tags itself
> `.face-art`. qr / chess / moon do. A glyph that wants inverting keeps ONE
> fill colour, so "paint everything white" stays the right answer for it.
>
> **The world clock's night glyph needed the other half of that rule.** It was
> a black disc with a `#fff` disc painted over it — it assumed the panel
> background was white, so on an inverted tile the bite vanished into the
> disc. `.face-art` would have frozen it black-on-black instead. Rebuilt as a
> single `fill-rule="evenodd"` path, one colour, no assumption about the
> background. **First attempt was wrong**: the bite circle (r5 at 10.5,5.5)
> pokes outside the r6 disc, and even-odd fills any region covered an odd
> number of times, so the overhang painted a second sliver of moon. Bite is
> now r4 at (9.41,6.59) — offset 2, so 2+4=6 and it is internally TANGENT.
> Verified with `path.isPointInFill()` at six probe points rather than by
> eyeballing a 14px glyph.
>
> **Why no guard caught it.** `test:visual` renders every widget at every
> size — but from `def.defaults()`, and qr ships `data: ''` while chess has no
> puzzle without a fetch. Both rendered their SETUP placeholder, so the
> artwork was never compared. `_pool_demo.js` now has frozen payloads for
> both, which puts them under the matrix.
>
> Both baselines re-captured. check:visual is **OK at 0.000%** — it had been
> failing long enough that it was telling nobody anything; the white-page
> baseline also predated inverted-on-black becoming the default.
>
> **Process note, third time this has cost me:** two of my "after" renders
> were byte-identical to the "before" because the server hit EADDRINUSE and a
> stale process kept serving. Kill, then `until [ -z "$(lsof -ti :PORT)" ]`,
> then grep the fresh log for EADDRINUSE before trusting a single pixel.
>
> **And a second sequencing trap:** `npm run test:visual --update` captures
> the EDITOR snapshot from `public/control-app/`, the built bundle. I updated
> the baseline and then ran `npx vite build`, so the next run failed on a QR
> that had just started rendering correctly. **Run `npx vite build` BEFORE
> capturing the editor baseline** whenever a widget module changed.
>
> ## 2026-09-17 — the weather pair merged; size ladders moved onto variants
> **Widget count 23 -> 22.** `weather_hero` + `weather_forecast` are now one
> `weather` widget with four views: `now`, `now_split`, `forecast`,
> `forecast_rows`. Config migration **v10** — but the rewrite lives in
> `WIDGET_ID_MIGRATIONS` (lib/screens.js) rather than behind a version gate,
> because that table also runs on the pre-screens legacy path and
> `weather_hero` is old enough to appear there.
>
> **The thing that unblocked it was not the merge.** This pair was held back
> at v9 with a measured objection: hero runs `8x4..24x12`, a tall showpiece;
> forecast runs `6x8..24x6`, a wide outlook. One `sizes` would have had the
> pool card, add-to-canvas and `tidy()` all seed a forecast tile at the hero's
> shape. So the contract changed instead: **a variant may declare its own
> `sizes` / `defaultSize` / `minSize`, and it wins for tiles drawing it.**
> Def-level values stay the DEFAULT variant's, so every consumer that has only
> a widget id still gets a sensible answer without asking.
>
> `control-src/widgets/_sizes.js` is the resolver — `variantOf`, `sizeSpec`,
> `sizeSpecFor`, `resolveSize`, `growToMin`. Every size call site goes through
> it: `widgets.js` sizeFor/makeInstance, `autolayout.js` candidateSizes +
> layoutFromWidgetIds, EditorGrid's pool card / showcase / RGL minima /
> keyboard resize, WidgetForm's variant thumbnails, and the matrix.
> `lib/layout.js` restates the rule in CJS (one lookup with a fallback — it
> loads synchronously and cannot import the ESM module).
>
> **Switching view now resizes the tile** when it has to: `growToMin` raises
> w/h to the incoming view's minimum and slides it back onto the grid. Only
> GROWS, only on an actual variant change. Applied twice on purpose — in the
> modal so the preview shows the real shape, and again in EditorGrid's
> `onSave` against the LIVE item, because that handler deliberately does not
> copy geometry from the draft (the tile may have been dragged meanwhile).
> Verified end to end: an 8x4 `now` tile switched to `forecast` persisted as
> **8x6**.
>
> **The matrix now iterates variants OUTSIDE sizes** (`lib/ssr.js`), so each
> variant is rendered on its own ladder. Rows are variant-major now, which is
> why the baseline moved 20% — re-captured, back to 0px. `weather` produces
> `XS..XL x {now, now_split}` + `S..XL x {forecast, forecast_rows}` = 18 rows.
>
> **`npm run check:visual` was already failing before this work** — 90.95%,
> a stale baseline from before inverted-on-black became the default, plus a QR
> that renders blank in that fixture. Confirmed by stashing and re-running on
> clean `main`. Untouched here; it needs its own look.
>
> The merged form shows Data (location + units, shared) and then only the
> active view's fields — the two old forms were 9 and 10 fields, the worst
> pair in the September audit. Both renderers are untouched; the view modules
> are `_view-weather-now.js` / `_view-weather-forecast.js` and each still owns
> its own ladder, which `weather.js` reads off them so no shape is written
> twice.
>
> ## 2026-09-17 — DEVICE_TOKEN rotated; panel unaffected
> New 48-char `DEVICE_TOKEN` in Railway, in this Mac's `.env`, and in both
> `esp32/*/secrets.h` (all gitignored). **Panel verified fine after the
> rotation**: 04:04 wake did `/health` 200, `POST /api/battery` 200, manifest
> 204, `/display-3c.bin` 200. No 401s, and no `/api/setup` call — it
> authenticated with its per-device api_key throughout.
>
> **A wrong diagnosis worth recording, because the trap it points at is
> real.** Before rotating I read the roster's `last_seen` as 2026-07-07 while
> the device had just completed a clean wake, and concluded it must be riding
> the fleet token — which would have meant the rotation bricked it, since
> `/api/setup` is gated behind that same token and there is no USB reflash.
> Wrong: `checkDeviceAuth` does `dev.last_seen_at = Date.now()` **in memory
> without persisting**, so after any redeploy the roster shows the last value
> that was actually written. Stale `last_seen` is NOT evidence of
> fleet-token auth. (A genuine signal would be a `/api/setup` call in the
> HTTP logs, or the `[auth] unknown X-API-Key` warning.)
>
> **`ENROLL_RECOVERY_MAC` (`c8fa9c5`) was built for that scenario and is
> now OFF.** It names one MAC that may enroll without the fleet token, so a
> device whose compiled token no longer matches can still get a per-device
> key. It was not needed here, but the trap it addresses is real for any
> device that IS on the fleet token. Verified in production both ways:
> named MAC 200 while set, 401 once cleared.
>
> The old token is unrecoverable — Railway redacts variable values to the MCP
> connection, so rotation is one-way. The new value is in this session's
> transcript, because setting a Railway variable requires the literal in the
> API call.
>
> ## 2026-09-16 (late) — semantic red was INVISIBLE on the BW panel
> User caught it on a Markets tile: a falling stock lost its ▼ AND its
> percentage, so down and flat rendered identically. Not cosmetic — data gone.
>
> **Cause.** `--face-red: #d32f2f` greyscales to 82; the mono pipeline is
> `greyscale -> linear(1.6,-77) -> normalise -> threshold(128)`, so it lands
> at 54 → black. Fine on a white tile. But the 2026-09-15 redesign made
> INVERTED the default for every tile, and black-on-black is nothing. Every
> semantic red was affected — AQI, battery, countdown, calendar TODAY,
> weather precip — not just markets.
>
> **Fix.** `.cell.cell-inverted` redefines the TOKEN (`--face-red: #ff7a7a`),
> so borders, SVG strokes and fills follow automatically — everything reads
> `var(--face-red)`. `isRedPixel()` in `lib/image.js` widened from g,b<110 to
> <130 so the lighter shade still lands on the red plane; safe because a grey
> pixel fails `r-max(g,b)>45` at any ceiling.
>
> **Measured on real renders, not by hand:** BEFORE 683 white px in the change
> column, AFTER 1050 — exactly +367, and 367 is the red-pixel count in the
> 3-colour render. Red plane unchanged at 367 before and after, so the B panel
> loses nothing.
>
> **Two false results on the way, both worth knowing:**
> 1. A synthetic swatch said `#ff5252` would work. It does not: `normalise()`
>    stretches an image with no true white, so a swatch of black+red flatters
>    the colour. On a real render #ff5252 lands at 113 — still black. **Test
>    face colours through `/display.png`, never a synthetic patch.**
> 2. Three "before/after" comparisons came back byte-identical because the
>    server restart had silently failed with EADDRINUSE and a stale process
>    kept serving, its Chrome holding the old CSS. `public/dashboard.html`
>    also pins the stylesheet at `?v=N` (now 20), so a CSS edit does not bust
>    the render cache on its own. **Wait for the port to free and confirm
>    "listening" before trusting a render comparison.**

> ## 2026-09-16 (night) — history scrub DONE, main rewritten
> `main` is rewritten: the wifi password and the token-bearing firmware
> binaries are gone from every commit.
>
> **The catch that nearly broke the panel.** The first scrub removed
> `public/firmware` from ALL commits — including the tip, which ships the
> five bins the device OTAs from. Force-pushing that would have 404'd
> `/firmware/:file` for a device in the field. The six current files are
> CI-built and were verified secret-free, so they are restored on top of the
> purged history. **Final trees are byte-identical to the old main**, which is
> why Railway SKIPPED the redeploy — the rewrite changed history only, not one
> current file.
>
> **What was actually exposed, measured rather than assumed:**
> - The wifi password was live at the TIP, quoted by the handoff entry that
>   recorded the scrub as not-done. Removed forward first.
> - The fleet token is in no text file. It was compiled into **27 historical
>   firmware binaries**, which is why the path is dropped wholesale.
> - That token is the one in this Mac's `.env` and it already 401s against
>   production, so it had been rotated server-side. The second token in those
>   bins is unverified and must be assumed live.
>
> **A rewrite is not remediation.** Anything ever pushed should be treated as
> disclosed — forks, clones and caches do not get rewritten. **Rotate
> `DEVICE_TOKEN`** (Railway -> this Mac's `.env` -> `esp32/*/secrets.h`) and
> reflash/OTA: a device still holding the old fleet token falls back to it.
>
> **Leftovers to clean when you are satisfied:**
> - `pre-scrub-backup` — LOCAL branch pinning the old history, secrets and all.
> - `origin/history-scrub` — now redundant.
> - Any other clone of this repo is orphaned and must be re-cloned.
>
> Verified after the rewrite: 23 wired, test:api 28/28, vite builds,
> `/health` 200, firmware still present at the tip.
>
> ## 2026-09-16 (evening) — UX program: P1-P11 all resolved, 30 -> 23 widgets
> Ten proposals shipped, one ruled out, two of my own claims retracted by
> measurement. **Nothing since the last panel photo has been seen on glass.**
>
> **Widget count 30 -> 23.** Four merges, all converting rather than dropping:
> markets (stocks+crypto+fx, v8), outdoors (sun+uv+aqi), daily
> (quote+wordofday+onthisday), clock (+world_clock) — the last three in v9.
> The renderers were NOT rewritten: each view keeps its module as
> `_view-*.js`, underscore-prefixed so the palette ignores it, and the parent
> picks one. Rewriting eight proven renderers to save nothing would have been
> pure regression risk.
> **`weather_hero` + `weather_forecast` were deliberately NOT merged** even
> though the proposal said 5 -> 1. Markets merged cleanly because its three
> shared a size ladder; hero runs 8x4..24x12 and forecast 6x8..24x6 — a tall
> showpiece and a wide outlook. One ladder would mis-serve both.
> *(SUPERSEDED 2026-09-17 — see the top entry. The objection was answered by
> letting a variant carry its own ladder, not by overruling it.)*
>
> **Editor is canvas-first** (P1): the Live preview pane is gone. Its only
> differentiator, the 1-bit threshold view, turned out never to have had a
> live control — the CSS was in the stylesheet and the only toggle ever
> written lived in `components/Preview.jsx`, imported nowhere. The canvas has
> it now. Screen settings moved to a disclosure bar; the mobile FAB + drawer
> went with the sidebar they existed for.
>
> **`tidy()`** (`control-src/autolayout.js`) shelf-packs tiles in reading
> order, only ever SHRINKS a tile, and returns what would not fit instead of
> deleting it. First version sorted sizes largest-first and one weather_hero
> claimed 12x12, dropping half the screen. The first-run wizard now asks what
> you want to see and builds from the answers with the same packer, sizing
> for the SET (try L, then M, then S) so everything picked actually appears.
>
> **A pre-existing bug the wizard work exposed:** the wizard's mount gate was
> `firstRun !== false && !homeCoords(cfg)`, re-evaluated every render — so the
> moment the location step saved a city the wizard unmounted itself. Nobody
> had ever reached the layout or PIN steps on a real first run. It latches
> open now.
>
> **Two of my own claims were wrong and are retracted:**
> 1. "Tile headers vary per widget" (P9). `.tr-titlebar` covers 26 of 30 and
>    the other two idioms already carry an identical type spec. Nothing to
>    unify. The `#000` hard-codes are not an inverted-tile bug either —
>    `.cell.cell-inverted *` overrides border-color with `!important`.
> 2. "Canvas tiles render blank at 375px". Re-measured: `.live-tile-scale`
>    applies `scale(0.43875)` and every tile renders. The original reading was
>    taken after a viewport change without a reload, before the
>    ResizeObserver had resized the canvas.
>
> **Keys live outside the exportable config** (P8): `DATA_DIR/secrets.json`,
> 0600, never merged into cfg, because Backup > Export is a
> `JSON.stringify(cfg)` in the browser. `test:api` asserts the key never
> reaches `/api/config`, probed by making the endpoint leak deliberately.
> NOT encryption at rest — the file is on the same volume.
>
> **Guard thresholds tightened twice.** The editor snapshot allowed 2500px
> while real changes measured 1823 and 2029 — they PASSED as "no change".
> Now 250px, verified stable at 0px.
>
> **Still open:** the git history scrub (wifi password + two fleet tokens in
> old commits) — destructive, needs an explicit decision. And the Mac's
> `.env` DEVICE_TOKEN is still stale.

> ## ✅ 2026-09-16 — ALL OF TODAY VERIFIED ON GLASS
> User photographed the panel after the last deploy: **everything works.**
> That covers setup stages 2 and 3 (weather tiles now inherit `cfg.home`,
> migration v6 dropped the duplicated tile location), the AI cadence
> options, the Mac-agent removal (v7 dropped its tiles), and the two
> visual-guard fixes. Nothing on the panel regressed.

> ## 2026-09-16 (later) — Mac push agent removed
> The agent had been POSTing `/api/mac-state` every 30s and getting **401**
> since at least 14:00: the `DEVICE_TOKEN` in the Mac's `.env` (file dated
> May 30) no longer matches production's. The route was never the problem —
> `checkAdminAuth` does accept `DEVICE_TOKEN`. Rather than re-key it, the
> user chose to remove the agent.
>
> Gone: `mac-agent.js`, `widgets/macnowplaying.js`, `widgets/macbattery.js`,
> `widgets/_mac_state.js`, `routes/mac-state.js`, `MacAgentBadge.jsx`, and
> both widget modules + forms. **32 → 30 widgets.** Also the `now_playing`
> screen preset (it existed only for that tile), the Settings menu's whole
> Status section, the Device card's "Mac agent" row, the `mac-agent` npm
> script, the Mac block in `.env.example`, and ~50 dead CSS rules.
> The launchd job is unloaded and its plist moved out of `~/Library/
> LaunchAgents` (kept in this session's scratchpad if it is ever wanted).
> **Config migration v7** drops `mac_nowplaying` / `mac_battery` tiles so no
> config is left pointing at a widget that no longer exists. It is a FIXED
> id list, not "anything unknown" — a widget missing because its module
> failed to load is a bug to fix, and silently deleting the user's tile
> would destroy the evidence.
>
> **The visual guard earned its keep**: it went 500 on
> `DEMO_ARTWORK_B64 is not defined`. The base64 demo image was introduced
> for now-playing album art but the **`photo` widget reuses it**, and the
> grep that cleared it excluded the file it was defined in. Restored, and
> the comment no longer calls it album art. Worth remembering that
> "unused after I delete X" needs checking INSIDE the defining file too.
>
> Shared CSS needed the same care: the battery variant rules are written as
> `.eink-batt-inline, .mac-batt-inline { }`, so the dead selectors came out
> of the lists rather than the rules being deleted.
>
> `V5_LIVE_VARIANTS` in `lib/screens.js` still names both widgets. That is
> correct and must stay — it is frozen history, and a migration has to give
> the same answer whenever it runs.
>
> Verified: 30 wired, `test:api` 24/24, both baselines re-captured (matrix
> 45.8M → 43.6M px) and passing 0px, server boots clean, `/dashboard` 200,
> `/api/mac-state` now 404. Editor bundle 343 → 328 kB.

> ## 2026-09-16 — setup stage 2 + the visual guard was lying about 2/3 of the matrix
> **`fullPage` screenshots are tiled at 16384px, and the tiles don't line
> up.** The matrix page is ~50892px. Past the first boundary, content came
> back displaced by a few hundred px, by a DIFFERENT amount per run — so
> everything below y=16384 (two thirds of the matrix) was never really being
> compared; the baseline just held whatever that run's tiling produced.
> Found by forensics on an intermittent 1299px diff: the changed rows
> repeated at *exactly* 16384px intervals. `scripts/visual-regression.mjs`
> now captures 4000px clips and stitches them with sharp (`2cc064a`).
> Verified three ways: 3 consecutive runs identical, slice heights
> 3000/4000/8000 agree to ~20px of seam AA, vs ~10.2M px of disagreement
> with fullPage. It also waits on `window.__autofitDone` — the signal
> `lib/render.js` already used — instead of sleeping 500ms and hoping.
> **Earlier the same day:** the matrix baseline went red within a day of
> every capture because `?demo=1` froze the DATA but not the CLOCK, and 13
> render modules plus the token parser read `new Date()` directly. Fixed by
> freezing at the render choke point (`lib/timefreeze.js`, `48d04fb`) rather
> than threading a `now` through 13 modules: `renderPage` is fully
> synchronous, so swapping `global.Date` around it cannot leak into another
> request. `FrozenDate` delegates `Symbol.hasInstance` because
> `calendar.js` branches on `ev.start instanceof Date`, which a subclass
> answers false for. Frozen at Mon 15 Jun 2026 10:30 EDT.
>
> **Setup stage 2 shipped** (`b27561c` read side, `95a2273` panel).
> `homeValue(cfg, key)` reads `cfg.home` first, falls back to the legacy
> top-level key, rewrites nothing. **The fallback is deliberately not
> `??`** — defaults ship `home:{city:"",lat:null}`, so a live config with a
> top-level `city` would have resolved to `""` and sent weather to NO DATA.
> Absent means empty, not just null. `timezone` was included rather than
> deferred: it was read in eight places and routing only some would let the
> scheduler and the widgets disagree about what time it is.
> Hand-mirrored CJS/ESM like `_tokens.js`; `check:widgets` compares them by
> BEHAVIOUR over fixtures (probed by breaking the mirror).
> Settings > Tools > **"You & your place"** = location / timezone / GitHub
> user / About you; the old "Setup" row is now "Setup wizard".
> `cityLabel` is gone — SetupWizard was its only writer and nothing read it.
> Verified in a browser on a throwaway DATA_DIR: picking a city writes
> `home.*` only, and the server then fetched weather from a config with no
> top-level coordinates.
>
> **AI cadence** (`9823957`): daily / 12h / 6h / 3h / hourly. The window is
> measured from the last generation, not clock-aligned, so generation time
> drifts forward by up to one wake interval per cycle.
>
> **Calendar feeds are in the panel, export unchanged** — user's call: the
> same URLs already ship in an export from per-tile calendar settings, so
> redacting one copy while shipping the others is theatre, and redaction
> would break backup round-trip. The field says so. Note these feed the AI
> briefing and `{{nextEvent}}` ONLY: a calendar tile with no feeds of its
> own resolves to [] by contract and does NOT fall back here
> (`lib/widget-data.js` case 'calendar'). Tiles inheriting is stage 3.
> Typing into the feed rows verified in a browser — the `replaceRow` bug
> class (`3289942`) is not present.
>
> **Stage 3 shipped too** (`aeb724e`). A weather tile with no location of
> its own used to render **NO DATA forever** — `resolveLoc()` returned null
> and a comment defended that as the self-contained-settings contract.
> Inheriting a *location* doesn't breach it: the tile still gets its own
> fetch and its own slot. Proven against HEAD — two tiles with `settings:{}`
> render `--` before, 83°F after. Forms show "Using Setup: GAINESVILLE" +
> Override; Override seeds city AND coords so it starts as an exact copy
> (city alone silently costs the tile its severe-weather alerts).
> **Migration v6** drops a tile location that merely restates Setup,
> equal-only, comparing PLACES not strings — the wizard wrote
> `Gainesville,Florida,US` and the tile autocomplete wrote
> `Gainesville, Florida, US`, so the live config's one duplicate would have
> survived on a space. **Found while testing: "Use Setup instead" did
> nothing** — all three `LocationFields` call sites merged
> (`{...v, ...loc}`), so clearing by deleting keys could never take. Same
> merge-where-a-replace-is-needed bug as `replaceRow`. That makes three in
> this codebase; suspect it wherever a child emits a whole object.
> **⇒ Wants a panel photo** — this is the first change that alters what a
> weather tile fetches.
>
> **Open:**
> `control-src/components/LocationPanel.jsx` (344 lines) is dead code —
> imported nowhere since the wizard replaced it.

> ## 2026-09-15 (late) — widget refresh pass + two guard holes closed
> **The visual guard was decorative.** Two independent defects, both found by
> probing rather than reading:
> 1. `/widgets-matrix` built its cell class BY HAND (`class="cell cell-${id}"`)
>    instead of calling `cellClasses()`, so since inverted became the default
>    the snapshot protected a rendering that does not ship — every widget
>    black-on-white in the guard, white-on-black on the panel. The exact
>    hand-rebuilt-at-a-call-site failure of CLAUDE.md gotcha 7.
> 2. Its threshold was a PERCENTAGE on a 45.8M-pixel canvas: 0.05% tolerated
>    ~22,900 changed pixels. An underline across 11 tiles moved 1245 px and
>    the guard said PASS. Now fails on an absolute count too (120 px matrix,
>    2500 px editor — the editor is a live viewport and jitters).
> **Always probe a guard before trusting it**: change something deliberately
> and confirm it goes red.
>
> **Widget refresh.** With the matrix finally showing what ships, a scan for
> descendants extending past their cell found **7 widgets spilling outside
> their tile** — on a fixed panel that draws over the neighbour. `.tr-card`
> now clips as a backstop, and the row budgets were corrected where
> multi-line rows were counted as single-line (headlines/tasks/transit drew
> 3 rows into ~2.3; calendar and onthisday are two-line rows). 7 -> 3, and
> the 3 left are clipped, not spilling.
> **All seven fixed** (`d18609c`). Two were bugs in shared machinery, not in
> the widget showing the symptom:
> - **autofit never fitted single-line text.** It bailed on
>   `clientHeight <= 0` — what a one-line element reports before its font is
>   set — and measured `clientWidth`, the element's OWN width. A nowrap flex
>   item sizes to its content, so every size "fit" itself. Now capped by the
>   parent box, with auto height treated as unbounded for non-wrapping text.
>   Affects every autofit element.
> - **calendar** budgeted events but not the TODAY/LATER headings.
> - **weather_hero** full tier ran 55px over; 56px of the stack was
>   inter-block spacing, so full-tier-only spacing rules + 26px off the art
>   fixed it without dropping content.
> - **world_clock** zone labels now ellipsize instead of cutting mid-letter.
>
> **Scanning for clipped text needs care:** `scrollWidth > clientWidth` is
> NORMAL on an element that is ellipsizing correctly. Only count it when the
> computed `text-overflow` is not `ellipsis`, or you chase four false
> positives like I did.
>
> **World clock face moved into CSS.** `.wclock-time` carries
> `var(--face-grotesk)` (Inter, self-hosted) so every world-clock tile reads
> as a different instrument from the serif local clock. It was a per-tile
> `fontFamily: 'system'` on exactly one tile, with no UI to recreate it, and
> `system-ui` resolved to whatever sans the render container shipped.
> `fontFamily` consequently rejoined migration v5's strip list.
>
> **`scripts/contact-sheet.mjs`** clips tiles out of the matrix into labelled
> sheets — reviewing 43 variants in one 50892px image is not possible. It
> clips from the matrix rather than rendering widgets standalone because
> `/preview/widget` skips autofit and produces nonsense.
>
> ## 2026-09-15 (evening) — config rebuild done, VERIFIED ON GLASS
> The whole `docs/widget-config-plan.md` pass shipped and was photographed:
> **235 settings keys -> 166, 99 variants -> 43, 12 per-tile knobs -> 1.**
> Panel shows every tile inverted (including `ai`), both clock faces intact
> (serif local / sans SAIGON), forecast and spacing clean.
> - Order was **defaults first, then removals** — the inverse of the theme
>   mistake earlier the same day. Step 1 flipped 17 `defaultVariant`s with
>   nothing deleted; proven a no-op by rendering the live config against the
>   previous commit and diffing (73 px, all live weather drift).
> - Step 5 is `gridVersion` migration **v5** in `lib/screens.js`, not a hand
>   edit of the volume. Its variant map is FROZEN on purpose — a migration
>   must give the same answer whenever it runs.
> - **`fontFamily` is excluded from the strip at the user's request**: the
>   world clock uses it for a face distinct from the serif clock, and with
>   the font picker gone it could not have been restored from the UI. That
>   tile is now the only one with a font override and it is effectively
>   frozen — if it is ever deleted and re-added the face goes with it. The
>   durable fix is moving it into the world_clock widget's CSS.
> - Two plan entries were wrong from classifying on the key NAME:
>   `art.density` is grid fineness in px, `calendar.density` is
>   rich/compact/auto. Both are content; both kept.
> - `chess` declared its default only in `defaults()` while `buildTileCtx`
>   reads `def.defaultVariant` — trimming its picker would have resolved to
>   null. Caught by assertion, not by reading the diff.
> - **Alarms removed server-side**; the buzzer stays as firmware-only
>   feedback (beepChime on button wake, beepLowBattery). Firmware treats a
>   missing alarm as success, so its alarm loop can come out on any flash.
> - **Local Puppeteer works again.** Its bundled Chrome is unsigned and arm64
>   macOS refuses it (`spawn Unknown system error -88`), which had been
>   misread as "no local Chrome" for months. Point
>   `PUPPETEER_EXECUTABLE_PATH` at `/Applications/Google Chrome.app/...`:
>   **test:api 23/23** (was 20/22) and the visual harness runs. Both
>   baselines regenerated and passing.
>
> ## 2026-09-15 (later) — AI widget + central-setup stage 1
> - **`ai` widget (32nd).** Prompt + the dashboard's own data -> a few lines.
>   Provider-agnostic over plain `/chat/completions` (OpenAI and DeepSeek are
>   the same shape), so switching is `AI_BASE_URL`. No vendor SDK.
>   **Live on the panel and working.** Env: `AI_API_KEY`, `AI_BASE_URL`,
>   `AI_MODEL` (no default on purpose). User runs `deepseek-flash`.
> - **Cadence is the design.** Generation is time-based (daily default,
>   hourly opt-in), cached on disk under DATA_DIR, so ordinary wakes cost
>   nothing and the ETag only moves when the text does. A failed call keeps
>   serving the last good text.
> - **Two bugs found by photographing it**, both fixed: DeepSeek runs
>   thinking mode BY DEFAULT, so a 200-token ceiling went entirely on
>   reasoning and returned empty `content` (now `thinking: {type:'disabled'}`
>   for DeepSeek, ceiling 800); and the tile said "Generation failed" instead
>   of the provider's actual words.
> - **It restated the forecast beside it** — and disagreed with it, since its
>   "today's high" is the current-conditions daily max while the forecast tile
>   renders its own. Now told what else is on screen and asked for judgement
>   rather than data. The underlying figure mismatch is untouched and
>   pre-existing.
> - **Central setup stage 1** (`docs/setup-architecture.md`): `cfg.home` block
>   + "About you" free text (Settings > Tools), which the AI puts first in its
>   context. Also DECLARES `city`/`lat`/`lon`/`githubUser`, which were read by
>   fetchers and written by SetupWizard but appeared in no schema. Stages 2
>   (read helper + Setup panel) and 3 (widgets inherit) deliberately not
>   started — they change how every location-aware widget reads data.
> - **Simplification stage 1** shipped earlier the same day: the eleven
>   per-tile typography knobs and the layout-density control are gone from the
>   modal (UI only — stored values still render, so nothing restyled itself).
>   The user's own config was the argument: 4 tiles, all `theme: inverted`,
>   4 of 99 variants used, one real typography override across the whole
>   screen. Rule refined by the user: keep controls that change WHAT
>   information appears (forecast days, headline count, zones), cut ones that
>   only decorate it.
>
> ## 2026-09-15 — panel offset SOLVED + VERIFIED ON GLASS
> Fix confirmed on the physical panel: with `Content-Length` shipping and
> `PANEL_SHIFT_3C_PX=0`, the calibration target lands correctly —
> sentinels flush to both edges, diagonals straight, planes registered.
> Not a panel trait. `/display.bin` and `/display-3c.bin` answered with
> `res.end(bin)` and no `Content-Length`, so Node framed the body as
> `<hex size>\r\n` + data + `\r\n0\r\n\r\n`. The firmware reads
> `http.getStreamPtr()` — the raw socket — which does not strip chunk
> framing, so it drew the framing as pixels: `"17700\r\n"` is 7 bytes =
> **56px** of shift on the whole image, and each further chunk boundary
> over TLS inserts ~8 bytes = **64px** more, partway down.
>
> **How it was found.** `lib/calib.js` + `CALIB_3C` serve a measurement
> target instead of the dashboard (no Puppeteer, no fonts, so it renders
> even where Chrome is missing). Three consecutive draws were identical —
> deterministic — and showed the black plane uniformly ~56px right, the red
> plane ~56px down to about row 175 and ~120px below it. 7 bytes, then 8
> more at ~65536 bytes in. Confirmed on a raw socket: the response body
> literally begins with ASCII `17700\r\n`.
>
> Why nobody caught it: a whole-image rotation can't fix bytes inserted at
> two different points in the stream, so `PANEL_SHIFT_3C_PX` could be tuned
> forever without converging — and the "swap the GxEPD2 panel class" tests
> in `fc1066d` / `542482d` were judged against a dashboard photo, which
> can't distinguish this from a hardware offset.
>
> **Fixed:** `ccb7a56` sets `Content-Length` on both device binaries (fixes
> the fleet with no reflash) + a `test:api` case asserting the framing on a
> raw socket. `3efdb4f` = firmware **1.21.0**: `ImageBufferSink` lets
> `HTTPClient::writeToStream()` decode chunked straight into the image
> buffer, used only when `Content-Length` is missing so the well-tested raw
> loop still handles the normal case.
>
> **`PANEL_SHIFT_3C_PX` must now be 0.** It was compensation for this bug;
> any non-zero value actively misaligns the panel. Same for clearing
> `CALIB_3C` once verified.
>
> Left alone deliberately: the BW sketch has the identical raw-stream
> weakness, but that panel is **physically broken**, so it ships no
> untested change. Its CI matrix entry is now dead weight.
>
> ## 2026-08-23 — PROD OUTAGE: Chromium zombie leak (fleet down)
> `fd7f624`. The Aug-13 idle-close change launched + killed a fresh
> Chromium per render; each one spawns a `chrome_crashpad_handler` that
> re-parents to PID 1 on browser death. Container ran bare `node` as
> PID 1 — never reaps — so hourly wake churn piled zombies until the PID
> table was exhausted: `posix_spawn … Resource temporarily unavailable
> (11)` / `fork: EAGAIN`, and every render endpoint (panel,
> `/display.png`, `/display.bin`) 500'd `internal_error`.
> Three layers, redeploy clears the backlog (fresh container):
> 1. **tini as PID 1** (nixpacks pkg + `tini -g -- node server.js`) —
>    reaps orphans. Root fix.
> 2. `BROWSER_IDLE_MS` back to **0 = resident browser** (the pre-Aug-13
>    model that ran stable for months). Re-enable idle-close via env
>    only once tini is confirmed live.
> 3. `--disable-crash-reporter` / `--disable-breakpad` so the handler
>    never spawns.
> **Lesson:** any per-render process churn in a container needs an
> init that reaps. Don't re-enable idle-close without checking PID
> count on the box.
>
> ## 2026-08-13 — cloud RAM/CPU trim (this caused the above)
> `51c8c82`. Railway bills per-minute actual usage; the render path held
> one Chromium resident 24/7 and re-rendered every 5 min for a fleet that
> wakes every 15-30 min (~450 MB idle + renders nobody reads).
> - **A. Idle browser close** (`lib/render.js`): track in-flight renders,
>   arm a `BROWSER_IDLE_MS` timer on the last finish → `killBrowser()`;
>   `getBrowser()` relaunches on demand (+1-2 s cold). Image cache is
>   separate bytes and survives, so devices still serve from cache — only
>   the background revalidate pays. `killBrowser()` nulls the handle
>   synchronously before awaiting close so a racing render relaunches
>   cleanly. **Now defaults 0 (off) after `fd7f624`.**
> - **B. `PRERENDER` now opt-in (`=1`)** — stale-while-revalidate already
>   warms the device cache on wake, so the 24/7 interval render was waste
>   on an infrequently-woken fleet. Opt back in for a shared always-on
>   host with many frequent wakes. Startup logs both states.
>
> ## 2026-07-19 — `.tr-bar` shape variants
> `41860b7`. Per-tile `barShape` on the shared progress/fill bar, five
> shapes over the default rect: `pill`, `ticked` (hairline ink notches at
> 25/50/75%), `segmented` (10 cells split by paper gaps), `battery`
> (rounded body + right tip nub), `notched` (segmented + tip). Pure CSS —
> `::before` draws ticks/segments, `::after` the tip, radii ride the solid
> frame; 1-bit safe. `barShapeClass(settings)` in `_shared.js` appends the
> modifier; wired into `eink_battery`, `mac_battery`, `progress`. Other
> bar users (weather_hero, aqi, uv, moon, now-playing) can opt in by
> threading the same helper.
>
> ## 2026-07-17 — editor batch (widget count now 31)
> - `16d8117` **per-tile layout variants finished.** Universal Layout
>   **Density** control (Detailed / Auto / Minimal) in the settings modal
>   — the `item.density` lever already fed `pickTier` (±1 size tier) and
>   was dirty-tracked but had no UI. Plus **chess variants** (diagram /
>   board-only / with-coords), the last widget without `def.variants`.
> - `7a0a551` **palette bug + search.** The grouped pool iterated only the
>   hardcoded `POOL_CATEGORIES`, but `POOL_META` assigned `Fun` (art,
>   chess) and `Money` (stocks) — those 3 counted in the badge and were
>   **unreachable from the add-widget pool**. Added both categories, and
>   the render now appends any stray category after the known ones so a
>   mis-categorised widget can't silently vanish again. Also: `keywords`
>   synonym string per widget (music/spotify → now-playing, rss/hn →
>   headlines, btc → crypto) folded into pool search, + sticky category
>   filter chips.
> - `bebda0c` **palette keyboard + recents.** Enter-to-add the top match
>   (highlighted with an inset ring, badge swaps to `↵ <label>`), Escape
>   clears the query then closes the pool; `addToCanvas` records the type
>   to a capped localStorage recents list shown as a quick-add chip row in
>   the default browse view. Pool is now type → Enter drivable.
> - `7ea5316` **lazy-load on-demand surfaces.** `WidgetSettingsModal`
>   (drags in WidgetForm + every `form.jsx` + TokenPicker + Radix Tabs),
>   `SetupWizard`, `ShortcutsHelp` → `React.lazy` behind their existing
>   conditional renders. Render modules stay eager (canvas/palette need
>   them). Initial index chunk **384 → 344 kB** (gzip 111 → 101).
> - `a044bea` **dead density knob hidden.** `art` / `codeactivity` /
>   `mac_battery` / `weather_forecast` never read `ctx.density` (they size
>   off cellW/cellH), and on `art` it collided with that widget's own
>   numeric `density` grid-fineness setting. `usesDensity: false` on those
>   four defs; modal gates the section on `def.usesDensity !== false`.
>
> ## 2026-07-07 (later) — hardware slim-down + widget batch
> - HW: user cutting buzzer + button. fw 1.20.2/1.14.2 add buttonless WiFi
>   recovery (portal self-opens on 3rd consecutive fail, then ~daily/6-hourly).
>   Desolder only AFTER roster shows 1.20.2. Alarms now pointless (no buzzer).
> - NEW widget `uv` (28th): Open-Meteo keyless, gauge + WHO-band scale
>   variants; peak-today in foot, moves to titlebar meta on short tiles.
> - `progress` variants: `dots` (10 steps/span, step follows rounded pct)
>   + `pixels` (year day-grid, portrait→vertical orient, compact meta <8w).
> - Gap fixes: gauge must sit DIRECTLY in .tr-body (aspect-ratio chain);
>   WHO band on rounded uv; ▼ literal not &#9660; (eink-lint hex-color FP).
>
> ## 2026-07-07 — open-sourcing POSTPONED (user call)
> Prep done + kept: CI builds secret-free bins (empty wifi/token — captive
> portal + per-device api keys), 40 token-bearing bins removed from tip,
> github.com/hqn07 profile live w/ showcase. NOT done: history scrub
> (the wifi password + two fleet tokens still in old commits —
> bins in history too), visibility still PRIVATE, local secrets.h reverted
> to match Railway. To resume: mirror clone → git-filter-repo
> (--invert-paths --path public/firmware + --replace-text) → force push →
> rotate DEVICE_TOKEN (Railway + secrets.h) → flip public. ~30 min.
>
> ## 2026-07-06 session (Fable 5) — all pushed
> - **Panel offset bug FIXED (server-side):** B panel displays image rotated
>   right ~64px (hardware trait — GDEY075Z08 vs Z08 class swap changed
>   nothing, both reverted). `/display-3c.bin` now pre-rotates left by
>   `PANEL_SHIFT_3C_PX` env (bit-accurate row rotation in `lib/image.js`
>   `shiftPlanesLeft`; etag suffixed so recalibration busts 304s). **Set
>   `PANEL_SHIFT_3C_PX=64` in Railway, photo panel, tune ±8. No reflash.**
> - **Dither tiles:** ramp g37/g62/g87 + textures diag/hlines/vlines/cross
>   + rdiag (`215-dither-tones.css`). weather_hero bars: humidity=checker,
>   cloud=diag. progress bars: per-span weave (day/week/month/year =
>   checker/diag/vlines/cross).
> - **Remote firmware log:** fw 1.20.0 (needs flash) buffers last failure in
>   RTC, POSTs /api/log on recovery; GET /api/logs (admin) reads. 
> - **Per-device screens:** PATCH /api/device/:id {screen} → that device
>   renders the assigned screen (query param still wins).
> - **Webhook widget:** POST JSON → /api/webhook/<key> (device token auth)
>   → widget renders payload; template mode `{{path}}` per line or auto
>   key/value grid. New widget wired all 5 spots; 20 api tests green.
> - **Stale-enrollment fix (gap found in prod):** roster was empty with a
>   live panel — device NVS held an api_key the server lost, auth fell
>   through to fleet token forever. Server now sends `X-Enroll-Stale: 1`
>   on unknown keys; fw 1.20.1 (b) / 1.14.1 (bw) clear NVS + re-enroll.
>   CI auto-ships bins; B panel OTAs itself, roster repopulates on its own.
> - Polish: webhook cache-bust only on changed payload; progress bars
>   degrade to fit (S=1/M=3/L=4, .tr-l/.tr-v unstyled-outside-.tr-lv bug
>   fixed); visual-regression harness no longer orphans its server.
> - `PANEL_SHIFT_3C_PX=64` LIVE on Railway (etag `-s64` confirmed).
> - Visual baseline refreshed (was stale since the 5-widget batch).
> - Two GxEPD2 copies on disk (libraries/GxEPD2 1.6.5 + misnested
>   libraries/libraries/GxEPD2 1.6.9) — cleanup candidate, not urgent.


> ## ▶ RESUME HERE (2026-09-16, end of day)
> Everything is on `origin/main` and deployed (`dd75d9e`). Guards on this
> machine: `check:widgets` **30 wired**, `check:css` in sync, `lint:eink`
> clean, `test:api` **24/24**, both visual snapshots **0 px**.
> **Set `PUPPETEER_EXECUTABLE_PATH` before running anything visual** —
> `export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
>
> **Panel is photographed and good.** No verification debt outstanding.
>
> **Open, in rough priority order:**
> - **The Mac's `.env` `DEVICE_TOKEN` is stale** — it no longer matches
>   production, which is what killed the agent. Nothing depends on it now,
>   but any future local tool that talks to prod will 401 until it is
>   re-copied from the Railway dashboard. Railway's MCP returns variable
>   values REDACTED, so this needs a human or the Railway CLI.
> - **`BROWSER_IDLE_MS` must stay 0.** The service builds with RAILPACK, so
>   `nixpacks.toml` is inert and tini never shipped. The resident browser is
>   what is holding prod up; idle-close without a reaper is the Aug-23
>   fleet-down configuration.
> - **`railway.json` is inert too** — watch paths must be set in the Railway
>   dashboard, or docs pushes keep rebuilding the image.
> - **The AI tile needs a prompt worth its space**, and "About you"
>   (Settings > Tools > You & your place) is still empty — without it the
>   model knows the weather but not the reader. Editing the prompt is also
>   the only way to bust the daily cache. Cadence now offers 3h/6h/12h.
> - **Setup stage 3 leftovers**: `home.tickers` / `home.feeds` were never
>   added (nothing reads them), and `timezone` is read through `homeValue()`
>   everywhere but new writes still go to the top level for it alone.
> - **`GET /api/weather-check` (`routes/geocode.js`) is now unreferenced.**
>   Its only caller was `LocationPanel`, deleted 2026-09-16; the client
>   helper went with it. The route still works and is admin-gated — left in
>   place deliberately in case a "test this location" button wants it, but
>   nothing calls it today.
> - **Open-sourcing history scrub** — wifi pass + two fleet tokens are still
>   in old commits; repo still private. Recipe in the 2026-07-07 entry.
> - **Firmware 1.21.0** was built by CI; confirm the device actually OTA'd
>   (check `/status`). Its alarm loop can come out on the next flash.
>
> **Workflow per unit:** `build:css` → `lint:eink` → `check:widgets` →
> `test:visual` (compare; `:update` only when the drift is intended) →
> `vite build` (editor changes) → `test:api` (server). Commit + push each
> unit (auto-push is on). New widget = wire every spot
> `scripts/check-widgets.mjs` guards (see `reference_widget_wiring` memory):
> render module + `form.jsx` + `_registry.js` + `_ssr.js` + `widgets.js`
> palette — plus a `POOL_META` category that exists in `POOL_CATEGORIES`.
>
> **Three lessons that keep repeating:**
> 1. **Merge where a replace is needed.** `ListEditor` string rows need
>    `replaceRow`; `LocationFields` call sites had to stop doing
>    `{...v, ...loc}` or "Use Setup instead" could never clear a key.
>    Suspect it wherever a child emits a whole object.
> 2. **Probe a guard before trusting it.** Change something deliberately and
>    confirm it goes red. Two harness holes and one useless threshold were
>    found this way.
> 3. **"Unused after I delete X" must be checked inside the defining file
>    too** — `DEMO_ARTWORK_B64` was still used by the `photo` widget.
>
## 2026-07-01 session (all pushed)

- Gauge + heatmap primitives — `gaugeHtml()` / `heatmapHtml()` in
  `control-src/widgets/_shared.js`; `225-trmnl-gauge-heatmap.css`. aqi
  has a `gauge` variant. heatmap: `orient:'h'|'v'`, empty cells white.
- **Space-aware fit ladder** (calendar/world_clock/onthisday): dotted—no,
  accent bar on `.tr-row-inner` (hugs text, not the grown band);
  `.tr-clamp`+`--fit-lines` wrap-before-clip; `.tr-rows-fill` fills
  under-full lists; `fillRowFont()` grows title text to fill big tiles.
- **Moon** (`widgets/moon.js`): fixed inverted polarity (lit=light,
  shadow=dark); lit face is a real dithered **PD NASA** photo
  (`_moon-image.js`, SVS 5187) clipped to the terminator; `flow` variant
  = flat **phase timeline** (today centred, ⅛-cycle step so neighbours
  are distinct + directional). Cover-flow 3-D was tried + dropped (round
  discs → coins).
- **Dotted dividers** on TRMNL cards (was dashed).
- **Code Activity** widget — GitHub contribution heatmap, no-token
  jogruber API, per-tile `username` (user = `hqn07`). Fills portrait
  tiles via vertical orientation.
- **Editor placement fix** — removed the `<motion.div layout>` FLIP that
  fought react-grid-layout (tiles flickered on drop / reverted on resize).
- **Autofit unified** — 4 copies → `control-src/autofit.js` (React
  imports; server injects at `<!--__AUTOFIT__-->`).

Everything below is historical session log, newest first. Read the RESUME
block above + `CLAUDE.md` + the memory pointers at the end of this file
before touching anything.

## 2026-06-29 session

### Quality pass (SaaS-readiness, single-tenant)

- **Endpoint tests**: `npm run test:api` (node:test + fetch, zero deps) —
  boots a server on a temp DATA_DIR, covers auth gating, config-body
  validation, refresh/battery-aware/quiet/push-now headers, enroll+delete,
  battery validation. 12 tests ~2s. Separate from deploy `prebuild` (boots
  Puppeteer). Docs in CONTRIBUTING.
- **Error visibility**: `console.error` wrapped into a 50-entry ring,
  surfaced on `/status` (Errors count + Recent errors section). Cleared on
  restart.
- **Config guard**: `POST /api/config` rejects non-object body / non-array
  screens (was spreadable → corruptible).
- **Visual baseline** rebaselined (was stale since `afbf62e`; guard had
  been silently failing on dimensions). `test:visual` PASS 0px.
- **RESET_PIN** lockout-recovery env hatch (clears forgotten PIN on boot;
  only `1/true/yes/on` trigger, `0/false/unset` = off). `/control-classic`
  PIN-gate fixed. `/api/setup` token-gated.
- Remaining quality items (not done): first-run security gate (force
  PIN+token on fresh deploy).



### Multi-tenant / SaaS architecture doc — WRITTEN (not built)

User confirmed the eventual target is SaaS (other people run their own
devices off one instance), still parked behind hardware validation. Full
design in `docs/multitenant-architecture.md`: Supabase schema
(accounts/screens/devices), device claim-code flow, per-device request
resolution (no firmware change — device already sends its api_key),
caching at scale, file→DB build sequence, single-tenant guardrails.
**Keystone = config file→DB; the only expensive-to-retrofit piece.** Also
pointed at from `CLAUDE.md` and the `project_eink_multitenant` memory.

Security note (single-tenant, now): going public = set a Control PIN
(immediately, or someone could claim the first-run set-pin) AND a
`DEVICE_TOKEN` in Railway. That locks editor + settings writes.
`/api/setup` is now gated behind `DEVICE_TOKEN` too (was open) — closes
the mint-a-key-then-read-image gap; firmware `enrollDevice()` sends the
token via `addToken()`. Already-enrolled devices are unaffected; a device
that loses NVS needs firmware with the addToken enroll change (flashed
1.15.0 does NOT have it yet — reflash before relying on auto re-enroll).
`/control-classic` PIN-gate bug fixed.

### Header → single Settings menu

Consolidated five header controls (Mac-agent status, Setup, Panel view,
Lock/PIN, Tools) plus the `?` keyboard-shortcuts button into one gear
**Settings** dropdown (`control-src/components/SettingsMenu.jsx`).
Layout is sectioned (Option A): STATUS / DEVICE / SECURITY / TOOLS, every
row iconed, Mac status shows a broadcast icon + label, and Alarms +
Backup collapse behind expandable rows. `PanelPreview` and `PinButton`
gained a `block` prop (render trigger as a menu row, keep their own
modal/popover). `ToolsButton.jsx` deleted (folded in). Mobile
screen-settings FAB icon changed Gear → `SlidersHorizontal` so it no
longer clashes with the Settings gear.

### Railway persistent volume (config now survives redeploys)

User upgraded to Railway **Hobby**. Mutable state already routes through
`DATA_DIR` (server.js; default `./data`, seed defaults in `data-defaults/`
so a volume doesn't shadow them — all writes funnel through
`atomicWriteFile`). To persist across deploys:

- Set env var `DATA_DIR=/data` on the service.
- Attach a Railway **Volume** mounted at **`/data`** (right-click service
  → Attach Volume, or Cmd+K → Volume). **Mount path MUST equal
  `DATA_DIR`** — keep both `/data`, not `/app/data`.
- A fresh volume starts empty → server seeds from `data-defaults/`, so the
  pre-switch live config is lost. Export config first (Settings → Tools →
  Backup → EXPORT), then IMPORT after the volume is live.

Code/docs pushed (`.env.example` documents `DATA_DIR`). Volume + var are
configured in the Railway dashboard, not in the repo.

### Background pre-render (warm cache for device wakes) — DONE

`server.js` image cache is now **stale-while-revalidate**: once an entry
exists, `getCurrentImage` returns it instantly and refreshes stale
entries (`>IMAGE_CACHE_MS`, 60s) in the background — only a cold cache
renders inline. A boot warm + `setInterval` (`warmActiveImage`,
`PRERENDER_INTERVAL_MS` default 5 min, `unref`'d) keeps the active
variant fresh; `invalidateImage()` re-warms right after a config save.
Disable with `PRERENDER=0`. Net effect: the ESP32 wake no longer waits
on a ~2-3s cold Puppeteer render. Verified locally — first `/display.bin`
hit served warm in ~1.7ms (48000 B). Relies on Hobby always-on; if the
service ever sleeps the first wake after idle is cold again.

### Push now (fast-refresh window) — DONE (server+UI; firmware optional)

Deep-sleep ESP32 can't be woken remotely, so push-now opens a server
fast window rather than a true push. `effectiveRefresh()` / `pushNow()` /
`fastWakeUntil` in server.js: while the window is open the device is told
to poll every `FAST_INTERVAL_SECONDS` (env `PUSH_INTERVAL_SECONDS`, def
20) for `PUSH_WINDOW_MS` (def 5 min), then back to normal. Honored by
`/display.bin`, `/display-3c.bin`, `/sleep`. `POST /api/wake` (admin)
opens it, re-renders + re-warms, returns `maxLatencyMinutes` (one current
interval — the device must wake once to enter the window). "Push now"
button lives in the Settings menu → Device.

**B firmware flashed `1.15.0`** (2026-06-29): now sleeps in seconds and
reads `X-Refresh-Seconds`, so a push-now window polls at the exact server
cadence (20s) not the 1-minute floor. Repo `weather_station_b.ino` synced
to match the flashed device. BW (`weather_station`) firmware NOT converted
— still minute-based; apply `esp32/PUSH_NOW_FIRMWARE.md` if that board is
ever revived. Inherent ceiling unchanged: latency to *enter* fast mode =
current sleep interval (device must wake once); can't beat that on battery
deep-sleep without always-on radio.

### Battery-aware refresh — DONE (no reflash)

`effectiveRefresh(cfg, battPct)` raises the refresh-interval floor as the
battery drains (`batteryRefreshFloor`: <35% →60min, <20% →120, <10% →240).
Only raises a floor — never shortens below the configured interval — and
push-now fast windows still override it. Reads the `Battery-Pct` header the
firmware already sends (so no flash); `/sleep` + the warmer fall back to the
cached `_batteryState.pct`. `battSaver` flag exposed on `/sleep`. Disable
with `BATTERY_AWARE=0`. Precedence in `effectiveRefresh`: fast window >
battery floor > config interval. Verified locally (5min base → 60/120/240
at 30/15/5%).

### /status explanations + device cleanup — DONE

Per-row click-to-expand "i" explanations on `/status` (flat battery = fine,
blank weather key = fine since default is Open-Meteo, what "stale" means,
etc.). Live-render link now carries `?token=` (was returning "bad token").
Devices table marks rows >2d stale and has a "remove" action (`DELETE
/api/device/:id`, admin, matches friendly_id or MAC) to prune old
enrollments; a live device re-adds itself on next wake. Board strings:
`b` = 3-colour firmware, `bw` = black/white. The two `bw`/1.13.x rows were
pre-reflash enrollments — removable; the reflashed B device shows board
`b` / FW `1.15.0` once it next checks in.

### /status enrichment — DONE

`/status` now shows the device-cadence state: **Refresh now** (effective
interval + reason: FAST push window / battery-saver vs base), **Pre-render**
(warmer on/off + cadence), **Push window** (active countdown / idle), and
**Battery trend** (drain %/h, rough time-to-empty, block-char sparkline of
recent %). Helpers `batteryTrend()` + `sparkline()` added above the route.

### Quiet hours — DONE (no reflash)

Global `cfg.quietHours = { enabled, from:'HH:MM', to:'HH:MM' }` (tz-aware,
wrap-aware). `quietMinutesRemaining()` → during the window `effectiveRefresh`
returns minutes-until-window-end (capped 1440), so the device wakes once at
the end instead of all night. Precedence: push-now > quiet > battery floor >
config. `quiet` flag on `/sleep`; "quiet hours" reason on `/status`. Editor
control `QuietHours.jsx` in the schedule-collapsible. Default (disabled) in
`config.default.json`. Verified: /sleep 5min → 1288min inside a covering
window.

Still-open options (no reflash needed): Puppeteer `MAX_PAGES` bump. Custom
domain — user wants LAST. Firmware sub-minute push-now — parked, write-up in
`esp32/PUSH_NOW_FIRMWARE.md`.

## What shipped in the 2026-06-16 session (HEAD on `origin/main`)

A visual-regression harness, a variant-thumbnail fix, and **six new
widgets** — all no-key. Pushed `196c9c5` → `afbf62e`. Widget count
8 → 14. Every widget rides the contract-v2 scaffold (def.variants +
defaultVariant + degrade, render(ctx) reads ctx.variant) and is covered
by the new visual-regression test.

### Visual-regression test (`88182ad`)

`npm run test:visual` boots the server, screenshots
`/widgets-matrix?demo=1`, and pixel-diffs (via sharp — no new deps,
matches the eink-lint script idiom) against a committed baseline
(`test/visual-baseline/widgets-matrix.png`). `test:visual:update`
rebaselines. Exit 1 on drift + writes a red-pixel diff PNG (gitignored).

- New `?demo=1` on the matrix route skips the live fetch so every tile
  renders from frozen demo data → output is **byte-identical** (0 px on
  an unchanged render). A single spacing-token nudge trips it.
- Threshold 0.05%; baseline is **machine-specific** — regenerate with
  `--update` on a new machine. **Rebaseline whenever the matrix changes
  on purpose (every new widget / layout edit), or the test fails.**

### mac_nowplaying variant thumbnails (`edf790b`)

Its variants only change stacked (extended/full) tiles, so the settings
picker rendered every thumbnail identically. Added `def.variantThumb
{ w, h }` (the picker renders thumbnails at that size instead of the
live tile) + seeded `demoCtxForWidget` into `PresetCard` so thumbnails
have data even when live is absent. Reusable for any tier-specific
variant.

### Six new widgets (all no-key)

| commit | widget | data | notes |
|--------|--------|------|-------|
| `1067162` | **aqi** | Open-Meteo air-quality (no key) | server fetcher `widgets/aqi.js`; reuses weather's geocoder; variants big/bar/minimal; severity = filled scale + word, never color |
| `1b5a9b6` | **countdown** | pure compute | no fetcher; reads ctx.now (frozen demo) else Date.now(); variants big/detail/minimal |
| `03cff6f` | **moon** | pure compute | synodic-month phase; disc is a 1-bit SVG (limb semicircle + half-ellipse terminator) **verified at all 8 phases** before wiring |
| `7c1380e` | **world_clock** | pure compute | Intl.DateTimeFormat; zones as `LABEL\|IANA` strings; variants stack/big/dual |
| `dd6cdcb` | **quote** | built-in set | rotates by day-of-year; optional custom list; uses autofit `multiline` so long quotes wrap (not clip) |
| `afbf62e` | **onthisday** | Wikipedia REST (no key) | server fetcher `widgets/onthisday.js`; **needs a descriptive User-Agent or 403**; variants list/feature/compact |

**Adding a widget — the wiring (all six followed this):**
1. `control-src/widgets/<id>.js` (def + render) + `<id>.form.jsx`.
2. Register in THREE places:
   - `control-src/widgets/_registry.js` (import + MODULES array + FORMS entry)
   - `control-src/widgets/_ssr.js` (import + MODULES array)
   - `control-src/widgets.js` → `WIDGET_REGISTRY` (`{ ...migratedDef('<id>') }`)
   **The last one is the editor palette's source of truth.** Miss it and
   the widget renders server-side + in the matrix but never shows in the
   add-widget pool (the `+ ADD WIDGET` badge count = WIDGET_REGISTRY
   length). This bit all six 06-16 widgets — fixed in `4eceed1` after the fact.
3. Demo data in `control-src/widgets/_pool_demo.js`
   (`demoCtxForWidget` case) — frozen so the matrix stays deterministic.
4. A `control-src/face-css/0NN-<id>.css` partial (numeric-ordered;
   `build:css` concatenates).
5. Data widgets only: a `widgets/<id>.js` CommonJS fetcher + `server.js`
   plumbing (`wantX` gate → Promise.all → buildWidgetData return →
   `...data` → `ctxBase` + the destructure at the top of
   `buildPageBodyHtml`).
6. `npm run build:css && npm run test:visual:update`, verify on the
   matrix, commit.

Note: legacy `cfg.*` keys (aqi/quote/photo/news/github/iss/etc.) are
pre-redesign scaffolding; the new widgets don't read them.

## What shipped in the 2026-06-13 → 06-15 sessions

Widgets-refresh **W2** (per-widget variant contract) finished, plus a
small TRMNL-parity pass **W3**. All pushed to `origin/main`

Widgets-refresh **W2** (per-widget variant contract) finished, plus a
small TRMNL-parity pass **W3**. All pushed to `origin/main`
(`70fc191` → `196c9c5`).

### W2 — every widget onto contract v2 (one variant model + one picker)

Contract v2 (defined in `control-src/widgets/_registry.js` header):
a widget declares `def.variants { <name>: { label } }` +
`def.defaultVariant` + advisory `def.degrade { <tier>: [dropped] }`;
`buildTileCtx` resolves `settings.variant` → `ctx.variant`; the
settings modal auto-renders the shared visual variant picker for any
widget with `def.variants` (no hand-rolled `<select>`). Render fns take
`render(ctx)` and read `ctx.variant`.

Batches (one commit each, panel-checked between):
- `40725a7` **W2-B1** weather pair — `weather_hero` (classic/split/
  minimal) + `weather_forecast` variants.
- `70fc191` **W2-B2** clock + battery pair — `clock` (big/thin/banner),
  `eink_battery` + `mac_battery` (gauge/inline/minimal, shared layout so
  the two batteries read as a pair). Legacy `settings.style` maps
  forward to a variant. Also: `/widgets-matrix` fills no-live-data slots
  (clock/batteries/now-playing) with frozen demo data via
  `demoCtxForWidget` (`control-src/widgets/_pool_demo.js`) so rows show
  layouts, not SETUP NEEDED.
- `14df252` **W2-B3** `mac_nowplaying` onto contract v2 — its six
  side-space options (time_bookends/centered/vertical_text/play_state/
  bars/metadata) became `def.variants`; dropped the hand-rolled select.
  NOTE: these variants only re-fill the bookend slots on **stacked
  (extended/full) tiers**, so picker thumbnails read alike at small
  sizes — expected.
- `af4d4f8` **W2-B4** `calendar` onto contract v2 — `viewMode`
  (list/strip/month) became `def.variants`; legacy `viewMode` maps
  forward (variant → viewMode → default). **calendar is grid-based on
  purpose** (month/strip are CSS grid, not flex). Also fixed a matrix
  bug: the per-row settings merge let `def.defaults()` clobber demo-data
  settings (calendar's empty `icalUrls` overwrote the demo feed → four
  SETUP NEEDED rows). Now demo settings win over defaults, per-row
  variant re-pinned last. `/widgets-matrix` renders 0 placeholders.

All eight widgets (calendar, clock, eink_battery, mac_battery,
mac_nowplaying, text, weather_forecast, weather_hero) now share the
contract. Verified each: `build:css` + `lint:eink` + `vite` clean,
`/widgets-matrix` 200, variants render distinct (screenshots).

### W3 — TRMNL framework parity (partial)

Audited TRMNL's framework (trmnl.com/framework) for primitives we
lack. Plan + read-only codecheck in `docs/plan-framework-hardening.md`.

- `196c9c5` **shipped**: a face-namespaced spacing scale
  `--face-gap-2…20` in `005-*` design tokens; 39 hardcoded `gap:` values
  swapped to `var()` refs across the partials. Tokens map **1:1** to the
  face's existing rhythm (2/4/6/8/12/16/20 — NOT TRMNL's 5/7/30/40,
  which never appear here), so the swap is a visual no-op with one
  source of truth. One-offs (1px, 14px) left bare.
- **Dropped — tabular numerals.** Looked obvious (numbers jitter as
  digits change) but measured `tabular-nums` directly on the self-hosted
  woff2: **zero effect** on DM Serif Display + Oswald (the gstatic Latin
  subsets carry no `tnum` table; JetBrains Mono is already monospaced).
  Would've been dead code. Number-jitter fix parked pending a
  tnum-enabled font build or a mono-digit decision.
- **Dropped — `.columns` primitive.** The three "column" consumers
  (forecast / hourly / cal-strip) use *different* layouts (flex /
  flex+space-between / CSS grid), so a shared primitive earns ~nothing.
- **Parked (not started):** `title_bar` unification, `.item > .icon`
  slot, layout alignment utilities. Skipped as N/A to a 1-bit fixed
  800×480 face: responsive prefixes, view mashups, 16-shade grayscale.

### Font audit (no defect found)

Investigated whether bold was broken (Oswald/JetBrains weights share
woff2 files). Measured: Oswald 700 renders genuinely heavier than 400
(278.9 vs 253.9px @100px) — variable-font weight axis works; shared
files are normal for variable fonts. DM Serif Display `font-weight:700`
is inert but that's correct (single-weight display face). Only real
font limitation = no `tnum` table (see W3 above). Nothing to fix.

## What shipped in the 2026-06-09 session

One long CAVEMAN-ULTRA pass spanning four big areas:
**token system**, **chrome removal**, **calendar overhaul +
settings-component upgrades**, and **main-page UI rebuild** (8
sub-stages G/H/J/I/F/#3/K + a SaveBar/+ button fix). Plus a
reliability sweep on the server. Every change rebuilt + verified
locally; `/display.png` re-checked at the visual milestones.

### Reliability sweep (server.js)

- Process-level `unhandledRejection` + `uncaughtException` handlers
  log instead of crashing the dashboard renderer.
- `atomicWriteFile` for battery state file (write to `*.tmp` →
  rename) — partial writes can't corrupt the snapshot.
- `jsonFetch` wraps every outbound fetch with
  `AbortSignal.timeout(10000)` — no hangs against dead upstream APIs.
- LRU trim on `geocodeCache` at 500 entries.
- Puppeteer page semaphore (`MAX_PAGES = 2`) — concurrent dashboard
  renders queue instead of OOMing Chrome.
- `withConfigLock()` serializes the read-merge-write cycle on
  `data/config.json` — concurrent PATCHes can no longer drop fields.

### Token system + chrome retirement

New `widgets/_tokens.js` exposes a logic-less TOKENS registry
(`date`, `day`, `city`, `temp`, `weather`, `lastRefresh`, `battery`)
and a `renderTokens()` parser for `{{token|format|default:VALUE}}`.
Multi-pipe parsing; missing values fall back to `—` em dash.

`server.js#buildWidgetData` now assembles a `tokenCtx` per render
and exposes it to all widgets. `/api/alarm/next` runs labels
through `renderTokens()` so alarm labels can interpolate.

The hard-coded dashboard **header + footer were removed**. The
replacement is a new user-controlled `text_bar` widget
(`control-src/widgets/text_bar.js`) with full token support and
view-tier awareness (subtitle drops below 2 rows; dashed
empty-state). `_chrome.js` collapsed to just `typographyCss` +
`scaleWrap` + `cellClasses`.

`public/dashboard.css` got a new TRMNL-inspired `.item` primitive
(meta / content / trailing slots + emphasis + `--allday` modifier)
and all `.hdr*` / `.ftr*` rules deleted. `.cell-flush` now strips
padding only — borders preserved (commit `aa42f5f`).

### Album-art dither polish

`widgets/_dither.js` runs `.normalize().gamma(1.2).linear(1.15,
-20)` before Floyd–Steinberg. Output dropped to 240 px to match
the extended-tier render 1:1 — fixes the visible noise band on
mac_nowplaying.

### Calendar — 3 view modes + presets

`control-src/widgets/calendar.js` now supports three view modes:
- `renderList` — agenda list (existing).
- `renderStrip` — 7-day horizontal strip (auto when ≥ 7×2).
- `renderMonth` — full month grid w/ event titles + dynamic row
  trim (auto when ≥ 7×4).

`control-src/widgets/_ical_presets.js` ships 18 iCal feeds grouped
**Countries / Religions / Sky** (Vietnam + Buddhism included on
user request). The form picks them via the new SearchableSelect,
and each preset card declares its own `viewMode` so the four
presets actually look different in the preview.

### Settings-component upgrades

Seven additions land under `control-src/components/`:

- `SearchableSelect.jsx` — cmdk-style grouped picker, keyboard
  nav, no external dep.
- `TokenInput.jsx` — typing `{{` opens a floating completion
  popover; arrow / enter / tab to accept.
- `UrlBadge.jsx` — dot indicator on URL rows (valid / invalid /
  empty).
- `TimeField.jsx` — HH:MM input mask, auto-colon, red-border on
  invalid (used in alarm + message schedules).
- `WidgetForm.jsx` — accordion swapped for **pill tabs**
  (`TabbedForm`); canonical 4-tab taxonomy
  `['Data', 'Content', 'Layout', 'Style']`. Always-visible
  "Edited" pill in `FieldLabel`. Slider thumb bubble. Drag-grip
  on `ListEditor` rows. `onHoverPreset` wired through
  `PresetContext` for live hover-preview.
- `WidgetSettingsModal.jsx` — `hoveredPresetValues` overlay so
  hovering a preset card live-applies its values to the preview
  pane.

### Main-page rebuild — stages G H J I F #3 K

(Sub-stage letters were the chat shorthand; commit order ≈ same.)

| Stage | Commit | What |
|-------|--------|------|
| G | `8172419` | Schedule timeline collapses by default; state in localStorage. |
| H | `8b927aa` | New `--accent-warm` ochre `#b68a3c` replaces the saturated web-app green. |
| J | `7ef38de` | Micro-interactions: button hover-lift, field-flash, slider bubble, framer-motion presence transitions. |
| I | `6074cf8` | Global keyboard shortcuts + `?` help overlay (`ShortcutsHelp.jsx`). |
| F | `7eaa424` | Always-on **Live preview** pane at ≥ 1200 px; ResizeObserver-driven CSS scale. |
| #3 | `f5d338c` | Pre-save validation scrolls to + flashes the first invalid field. |
| K | `e232460` | Mobile / tablet responsive: `@media (max-width: 760px)` collapses sidebar to a bottom-sheet drawer behind a FAB. |

Header rebuilt as a 3-zone layout with an inline `SyncPill` status
indicator + `?` shortcut button. `ScreenTabs.jsx` switched to pill
style with HTML5 drag-reorder + grip handle (no `dnd-kit` dep).
`SetupWizard.jsx` got a Stripe/Vercel-style numbered
`StepIndicator`. `SaveBar.jsx` rewritten as a floating pill with
slide-in `AnimatePresence`; hidden when `synced` / `syncing`.

### Final two fixes (commit `baa5bcb` + follow-up)

- `+ ADD SCREEN` glyph re-centered: `font-size: 18px;
  min-height: 30px; display: inline-flex; align-items: center;
  justify-content: center`.
- SaveBar lingered after a successful save → first attempt added
  an auto-fade timer (`saved` → `synced` after 1.5 s).
- Second pass found the *real* bug: `App.jsx` was passing
  `statusDef.cls` (not raw `status`) into `<SaveBar>`. Both
  `synced` and `saved` mapped to `cls: 'saved'`, so the bar's
  visibility check `VISIBLE_STATES.has(status)` was permanently
  true. Fix: pass raw `status`.

### Cross-cutting CSS additions (`control-src/styles.css`)

`SyncPill`, save-bar pill, schedule-collapsible, `--accent-warm`,
button hover-lift, slider bubble, edited pill, mobile drawer, FAB,
preview pane, field-flash keyframe, shortcuts modal, the 760 px /
980 px / 1200 px breakpoints.

### Post-stage polish (commits `91fd5d3`, `193b74b`)

- **Rounded corners pass** (`91fd5d3`). User flagged sharp edges
  on main-page cards. Added `border-radius: 6px` to: `section.card`,
  `.screen-tabs`, `.timeline-wrap`, `.editor-wrap`, `.preview-stage`,
  `.trash-zone`, `.palette`, `.palette-toggle`. Matches the existing
  `.preview-pane` radius. Roundness scale is now consistent across
  the main page.
- **Preview-pane parity bug** (`193b74b`). `<LiveDashboard>` was
  building each widget's render ctx as
  `{ ...data, cellW, cellH, density }` — missing the per-item slot
  + `item.settings`, and skipping `scaleWrap` / `typographyCss` /
  `cellClasses`. Editor canvas (`EditorGrid.jsx:398`) and SSR
  (`server.js:1086`) both include all four, so widgets in the
  preview pane fell back to defaults (clock → SETUP NEEDED,
  weather_hero → extended-tier FEELS panel) while the canvas
  rendered correctly. Mirror the ctx + chrome wrap so
  **preview pane = editor canvas = server render**. Added a small
  `cssDeclToStyleObj()` helper so `typographyCss`'s declaration
  string (which carries the `--w-font` custom property) survives
  the bridge into a React `style` object.

### Verified

- `npx vite build` — clean across every commit in the session.
- `/api/preview-data` curl confirms tokens resolve end-to-end.
- `import('./control-src/widgets/calendar.js')` smoke-tested per
  view mode.
- `/display.png` re-rendered at each visual milestone.

### Open / next-session candidates

- **Visual regression** — preview-pane bug was caught only by the
  user spotting the FEELS panel. A small playwright snapshot of
  `/control-app/` after a known config would have caught it
  pre-push. Still un-built.
- **Bundle size** — vite warns the JS chunk is > 500 kB. Likely
  candidates for `manualChunks`: framer-motion, phosphor icons,
  the react-grid-layout cluster, and the `_pool_demo` PNG strings.
- **Editor canvas + preview-pane drift risk** — two places now
  build the same widget render ctx. Worth extracting a single
  `buildTileCtx(item, data)` helper used by both `EditorGrid` and
  `LiveDashboard`. Memorialised here so the next drift bug doesn't
  require another user catch.
- **Hardware reality check** — 2026-06-08 was Stage 0 (validate on
  physical e-ink). Several of the visual polish items in this
  session were tuned against the PNG preview; re-run on the
  e-ink panel to catch dither / contrast issues that the LCD
  hides (memory: `project_eink_hardware_delay.md`).

---

## What shipped in the 2026-05-31 → 2026-06-02 session (`92bd733` → `4942c1b`)

Customization roadmap finishing pass + Radix UI integration + a
two-step preview architecture exploration that ended back at "fast
+ close" instead of "perfect + slow".

### Phase D — per-tile title override (commit `3399632`)

Hardcoded headings (`NOW PLAYING`, `MARKETS`, `UPCOMING`, `MAC
BATTERY`, `N-DAY OUTLOOK`) replaced with `settings.title`. Blank
falls back to the original default. Closes the last open variant
phase from the customizability roadmap.

### Inverted theme fixes (commits `72e2c9e`, `7649fc1`, `71af033`)

Three follow-ups to the `theme: 'inverted'` knob added in Phase F.
Sevesalm SVGs shipped with explicit `style="background-color:
white"` + `fill="white"` on the root — under `filter: invert(1)`
that became a solid black rectangle on the inverted tile, hiding
the temperature number below. Stripped the inline background-color
from all 21 SVGs; weather + battery glyphs now render as white
outlines on the black tile. `.mac-np-art-empty` (the album-art
fallback when no artwork is loaded) gains a `.cell-inverted`
override so the black tile doesn't surface a white square.
mac_nowplaying gains `showStateIcon` to hide the giant centered
play / pause glyph entirely.

### mac_nowplaying position knobs (commits `4332229`, `32b4924`)

Substantial layout-control pass driven by user requests:

- `showColTitle` toggle on the "NOW PLAYING" heading.
- `headerAlign` (left / center / right) on that heading.
- `artPosition` (left / right) for the horizontal layout — flips
  which side the album cover sits on via flex-direction.
- `textAlign` (left / center / right) on the artist + song block.
- Split the meta-block visibility into two toggles: `showSongTitle`
  and `showArtist` so users can hide the artist line independently
  of the title.
- `textOffsetY` slider (±120 px via `transform: translateY`) so the
  user can pull the text block up against tall art (e.g. close the
  gap below cover art on extended/full tier).

CSS: `.mac-np-head-{left|center|right}`, `.mac-np-text-{...}` (also
cascades into `.mac-np-stacked-text`), `.mac-np-body-art-{left|
right}`. mac_nowplaying.form.jsx gains a Position section with the
three SelectFields + the slider.

### Widget pool — hover preview + demo data (commits `cfa14fb`, `bb2cbc9`)

Widget pool used to render every card with live previewData, which
meant a brand-new install showed SETUP NEEDED placeholders for
half the widgets. Two changes:

- **Hover-card preview (Radix UI)**: each palette card wraps its
  thumbnail in `HoverCard.Trigger`. Hovering for 250 ms opens a
  popover at the widget's "showcase" size (clock / mac_battery →
  S, weather_forecast / message / calendar / stocks → M,
  weather_hero / mac_nowplaying → L). Popover capped at 480×280
  with hard-shadow editorial styling.
- **Frozen demo data**: new `control-src/widgets/_pool_demo.js`
  ships a generic dataset per widget — 82°F partly cloudy, 7-day
  forecast, Crumb · Empty Seats with a stylised PNG placeholder
  for album art (generated via Sharp at b/w-only so it threshold-
  safe), AAPL / NVDA / BTC sparklines, a calendar week with
  "Mom's birthday" so all-day badges + sections both fire.
  Thumbnail + popover both render the same demo so the pool reads
  as "this is what each widget will look like fully configured".

### Tabbed widget settings (Radix UI) (commit `d769017`)

Modal form rewritten with Radix `Tabs.Root` driven off the existing
`<FormSection>` blocks. `TabbedForm` walks the rendered form's
React tree, splits out the FormSection elements, and rebuilds each
as a `Tabs.Content` keyed by its title. Pure-render-function
constraint on `<id>.form.jsx` makes the direct call safe. CSS
matches the editorial palette: solid-black underline on active,
muted color on inactive, dashed focus ring, 140 ms fade-in.

Removed the legacy top-of-modal Layout section (Flush edges +
Density) in commit `42bf45d` — both were duplicates / vestigial
once per-widget Layout tabs landed.

### Battery + album-art polish (commit `46cc599`)

Two e-ink threshold cleanups:

- mac_battery charging indicator was U+26A1 ⚡ which Chrome
  rendered through the colour-emoji font as a yellow glyph
  — threshold rounded it inconsistently and the dark theme
  couldn't invert it. Replaced with inline SVG `<path>` filled
  `#000`, flips to `#fff` on `.cell-inverted` via the existing
  global SVG rule.
- Pool demo Now Playing widget gains a 160×160 base64 PNG of
  nested rotated diamonds (palette: 2, b/w only) so the hover
  popover doesn't render the empty-fallback square.

### Settings modal preview — two-step architecture exploration

The user reported the modal preview's MITSKI vertical position
drifted vs the live editor canvas. The root cause: the modal's
`dangerouslySetInnerHTML` mount skipped the autofit binary-search
pass the live dashboard runs, plus cell pixel dimensions differed
between the two contexts. Two paths:

1. **Hybrid iframe + 1-bit PNG (commits `7bb1b00`, `204b3ff`,
   `5079ac1`, `41fe001`)** — new server endpoints:
   - `GET /preview/widget?widget=…&w=…&h=…&settings=<b64>` renders
     a single widget through the SSR pipeline. New `preview` mode
     in `buildPageBodyHtml` collapses the html / body / .page from
     800×480 down to the widget's pixel size so an iframe at the
     same dimensions matches 1 : 1 (no cropped corner of the full
     dashboard).
   - `POST /api/preview-render` Puppeteer screenshots the same
     URL, runs the threshold + 1-bit palette pipeline /display.bin
     uses, returns a bit-identical PNG. Concurrency capped at 2
     in-flight so slider drags don't queue 50 simultaneous
     screenshots.
   Modal stacked an iframe (instant feedback) under a debounced
   PNG (bit-fidelity once the 600 ms idle timer fires).

2. **Revert: instant client render + autofit (commit `4942c1b`)** —
   The user said the preview latency was unacceptable: iframe
   reload on every keystroke + 600 ms PNG debounce + 1-2 s
   Puppeteer queue made sliders flicker. Reverted to the original
   `dangerouslySetInnerHTML` mount but added a post-mount autofit
   pass that runs the same binary-search the dashboard's
   `<script>` block runs. Close-to-pixel-perfect, instant.

   The `/preview/widget` + `/api/preview-render` endpoints stay
   in place — cheap to keep, useful for future "Save preview"
   PNG-on-demand or external tooling.

`5079ac1` was a hooks-order fix: the new preview hooks lived
*after* the `if (!open || !draft) return null` guard so the first
open from a closed modal tripped React's "more hooks than last
render" check and unmounted the whole app — visible to the user as
a fully blank /control page. Hoisted the hooks above the guard.

### Misc

- `cellClasses(settings)` now flows through the single-widget render
  path (preview + dev) so theme: inverted reflects correctly in
  both modes (`41fe001`).
- `WidgetForm` extracts a `PresetField` primitive plus a
  `FormSection` wrapper so widget forms can group fields into
  sections — Tabs feed off the same structure.

## What shipped in the 2026-05-30 → 2026-05-31 session (commits `e96c77f` → `90204c7`)

> **Customization phases A–F complete** (commits `50bc1f7` + `90204c7`).
> See `project_eink_widget_customizability_roadmap.md` for the full
> per-widget knob catalog and open follow-ups.


## What shipped in the 2026-05-30 → 2026-05-31 session (commits `e96c77f` → `90204c7`)

Long customization session — finished the per-tile knob roadmap and
fixed a pile of 1-bit threshold + auth gotchas surfaced along the way.

### Customization roadmap — phases A through F shipped

Modal form rewritten per the TRMNL plugin editor + HA mushroom-card
pattern (research summarized in commit `90204c7`'s body).

- **Phase A (commit `50bc1f7`):** Each per-widget Form groups fields
  into named `FormSection`s — `Data / Content / Layout / Show / Style`.
  Flat 8-field columns scaled poorly; sections cap perceived complexity.
  Pure restructure, no field added or removed.
- **Phase B (in `90204c7`):** Every widget gains flat `show_X` toggles
  for sub-elements. mac_nowplaying gets showAlbumArt / showProgress /
  showSource; weather_hero gets show {Desc, Stats, Alerts, Sunbar,
  Hourly}; weather_forecast gets showDayName / showIcons; calendar
  gets showDayLabel / showTime; stocks gets showSpark / showChange.
  Defaults preserve prior rendering; toggles only ever HIDE.
- **Phase E (in `90204c7`):** New `PresetField` primitive plus per-widget
  preset lists (3–4 each) so users can "pick a look" without fiddling
  individual knobs — `editorial / minimal / wind / sun` for weather,
  `default / minimal / bold / art_off` for now-playing, etc.
  Picker resets after applying so the user can keep tweaking.
- **Phase F (in `90204c7`):** Universal `theme: 'inverted'` knob in
  TypographyFields. New `cellClasses(settings)` helper on
  `widgets/_chrome.js` returns extra classes for the .cell wrapper —
  consumed by the SSR pipeline, the editor preview, AND the modal
  preview from a single source. `.cell-inverted` flips to solid
  black tile + white ink, including SVG fills and raster-image inversion.
- Variant pass earlier in the session (commits `e96c77f`, `41f469a`,
  `5bc0af4`, `d1a0a24`) shipped concrete variant knobs:
  - mac_nowplaying side-space: `time_bookends` (default) /
    `centered` / `vertical_text` / `play_state` / `bars` / `metadata`
  - weather_hero `stats[4]` slot picker — feels / humid / wind / gust /
    cloud / rise / set / cloud_or_rise
  - weather_forecast `precipMode` (auto/always/never) +
    `hiloStyle` (stack/inline/arrows)
  - calendar `density` override
  - stocks `layout` (hero_watch / list_only / hero_only)

### Mac-agent freshness badge (in `d1a0a24`)

New `MacAgentBadge.jsx` in the /control header reads `GET /api/mac-state`
every 15 s and shows "MAC AGENT: 7s ago" coloured green / orange / gray /
red for fresh / stale / never / endpoint-down. Tooltip points the user
at `/tmp/eink-mac-agent.log` so a dead launchd job is obvious without
SSHing in.

### Mac-state hardening (commit `87a62ad`)

Post-mortem audit found three issues with the original Mac-on-cloud
write path:
- `_lastTrackKey` race when two pushes raced — fixed with a
  single-slot Promise chain (`_macStateChain`).
- Orphan `data/mac-state.json.tmp` from a writer crash — `loadSync`
  now unlinks it on startup.
- `invalidateImage()` fired on every push even when nothing changed,
  trashing the 60 s image cache. New `sameMacState()` compares the
  new payload (5-second elapsed bucket) to the previous and skips
  the invalidation when render output wouldn't differ.

### Firmware 1.11.x — cloud-only + actionable fail screen + battery curve

- **1.11.0 (commit `1434c27`):** `selectServerBase()` is cloud-only;
  the LAN base + probe were removed now that the Mac-side agent
  pushes state through the cloud. ESP32 stays on the Railway base
  permanently — no more LAN ↔ cloud dance.
- **1.11.1 (commit `8ab5e55`):** Fail screen surfaces the underlying
  HTTP code (`Could not fetch image (HTTP 401)`), a per-code one-liner
  tip (`Tip: DEVICE_TOKEN mismatch (server vs firmware)` for 401,
  similar for 404/-1/-11/5xx), WiFi RSSI, local IP, friendly_id, and
  "LAST OK: 2h ago" backed by an RTC_DATA_ATTR timestamp that survives
  deep sleep.
- **1.11.2 (commit `7955614`):** Battery percent now uses a nonlinear
  LiPo curve (4.10 V → 100 %, 3.30 V → 0 %) so a fully-charged cell
  actually reads 100 %. The old linear formula maxed out at 88–97 %
  because the 1 MΩ+1 MΩ divider + ESP32 ADC nonlinearity cap real
  readings around 4.10 V.

### Server-side auth softening (commit `6a3aab0`)

`checkDeviceAuth` used to reject any request that carried an unknown
`X-API-Key` outright. That bricked devices that had enrolled against
the local server and then were repointed at the cloud — the api_key
in their NVS wasn't known to the cloud's `devices.json`. Now: unknown
X-API-Key falls through to the fleet `?token=` check, so the legacy
credential still rescues the device.

### Build pipeline noise (commits `b564d4c`, `5540d61`, `e881d43`)

Railway log aggregator flags npm stderr at severity=error, so an
otherwise harmless `npm warn config production` looked like a build
failure. Fixed by:
- `npm install --include=dev` so devDependencies (vite + plugin-react)
  are present for the build phase.
- Wrapping npm in `env -u NPM_CONFIG_PRODUCTION` so the deprecated
  legacy config var isn't visible to npm.
- New `Procfile` (`web: node server.js`) bypasses `npm start`
  entirely on launchers that prefer Procfile over nixpacks `[start]`.

### Misc polish

- `1007f83`: Settings modal locks `html`/`body` overflow on open so
  wheel/touch gestures don't scroll the editor underneath the panel.
- `e65a906`: mac_nowplaying state glyph swapped from Unicode ❚❚ to
  inline SVG — Sharp's threshold pass was clipping the thin bars.
  Also bumped `.mac-np-source` from 10 px / #555 / wide-letter-spacing
  to 13 px / weight 700 / pure black; the old style dithered into
  noise on the panel.
- `96a570f`: `typographyCss` emits `zoom: <scale>` for fontScale so
  every widget visibly scales (not just message + mac_nowplaying that
  multiplied the value themselves). WidgetSettingsModal cellHtml now
  passes the typoStyle into the live preview so font/scale/padding
  changes are visible while editing.

## What shipped in the 2026-05-29 → 2026-05-30 session (commit `72b0b2e`)

Two shipped items, both validated end-to-end against the live ESP32 + Railway:

### Phase B / SSR — dashboard render consolidated server-side

`public/dashboard.html` collapsed from ~1010 lines to ~47. The body
grid is now built in `server.js` from the same per-widget render
functions the React editor uses, so there's no longer a separate inline
mirror to keep in sync.

- Each widget moved to a `<id>.js` (def + render, no React) +
  `<id>.form.jsx` (React Form) pair under `control-src/widgets/`.
  Server dynamically imports the `.js` half via cached `await
  import()` so JSX never enters Node's import graph.
- New `control-src/widgets/_chrome.js` owns header/footer/typography
  helpers — shared by server SSR + React editor.
- New `control-src/widgets/_ssr.js` is the Node-side aggregator
  (renderers + chrome re-exports).
- `widget-render.js` is now a thin dispatcher + re-export of
  `_chrome.js` so React editor import paths stay stable.
- `server.js` gains `buildPageBodyHtml` + `renderPage` + cached
  `loadSsr()`. `/dashboard`, `/widgets-matrix`, `/dev/widget/:id`
  all share the same shell-injection path.
- `_shared.js` picks up the `msg` placeholder glyph;
  `_weather_shared.js` picks up `alertBanner`. Folding these in
  restores alert banners in the editor preview too.

Net: -1900 / +290 lines. Adding a new widget = one new file pair +
one line in `_registry.js`/`_ssr.js`. Adding a variant knob = a
single render-function edit. No more triple-sync.

### Mac-on-cloud — push-based agent kills LAN-base dance

ESP32 used to fall back between LAN (the Mac running `npm start`) and
cloud (Railway), depending on which was reachable, so the Mac widgets
only worked when the device picked LAN. Now ESP32 hits cloud-only and
a Mac-side agent pushes state.

- `widgets/_mac_state.js` — atomic-write on-disk cache at
  `data/mac-state.json`. 5-minute staleness window.
- `widgets/macnowplaying.js` + `widgets/macbattery.js` — read from
  the cache whenever `MAC_FROM_CACHE=1` or the process isn't on
  darwin. Stale = "MAC OFFLINE".
- `server.js` — `POST /api/mac-state` (auth via `DEVICE_TOKEN`).
  Server dedupes album art by `trackKey`; the agent can omit
  `artworkBase64` when the song hasn't changed and the server
  preserves the previously stored frame. Companion `GET` for
  debugging.
- `mac-agent.js` + `npm run mac-agent` — polls local Mac every 30 s
  (configurable via `MAC_AGENT_INTERVAL_MS`), hashes
  `title|artist|album`, POSTs to `CLOUD_URL`. ~50 MB/mo bandwidth
  with realistic listening.
- launchd plist at
  `~/Library/LaunchAgents/com.huynguyen.eink-mac-agent.plist`
  (RunAtLoad + KeepAlive). Survives reboot, auto-restarts on crash.
  Logs to `/tmp/eink-mac-agent.log`.
- `.env.example` documents `CLOUD_URL` + `MAC_AGENT_INTERVAL_MS` +
  `MAC_FROM_CACHE`. `.gitignore` covers
  `data/mac-state.json{,.tmp}` + `data/devices.json`.

ESP32 deep-sleeps and hits only the Railway base — no more LAN
re-probe failures killing the Mac widgets when DHCP shuffles or the
Mac sleeps mid-day. Validated on hardware: agent push → cloud cache
→ /display.bin render → physical e-ink screen showed Mac widgets the
first refresh after deploy.

### Bonus

Dropped now-unused `jsonForScript` helper. Added `_shared.js` `msg`
placeholder + `_weather_shared.js` `alertBanner`. `widgets/package.json`
sets `{"type":"module"}` to silence Node's MODULE_TYPELESS warning when
the SSR dynamic-import loads the ESM widget files.

## What shipped in the 2026-05-28 → 2026-05-29 session

Long marathon session covering TRMNL-inspired tooling, per-widget
customization, and a brutal WiFi-reliability arc.

### Hardware / firmware (BW sketch is now 1.10.5)

- **1.6.0** — setup-once / loop-many refactor + auto-detect USB vs.
  battery. Battery mode uses `esp_light_sleep_start()` (keeps WiFi
  associated, skips the per-cycle re-join); USB mode just `delay()`s.
- **1.7.0** — adaptive refresh: device sends `Battery-Voltage`,
  `Battery-Pct`, `RSSI`, `FW-Version`, `FW-Board` as request headers
  on `/display.bin`; server returns `X-Refresh-Rate` so the per-tile
  refreshMinutes flows back without a separate `/sleep` round-trip.
  `/sleep` + `POST /api/battery` stay alive for legacy firmware.
- **1.8.0** — WiFiManager captive portal + 5 s long-press factory
  reset. *Did not work* — see 1.10.0.
- **1.9.0** — per-device MAC enrollment via `POST /api/setup`,
  `X-API-Key` header on every authenticated request, NVS-backed
  `api_key` + `friendly_id`. `data/devices.json` holds the registry;
  fleet-wide `DEVICE_TOKEN` stays as fallback.
- **1.9.1 → 1.9.3** — WiFi tuning thrash: `setSleep(false)` +
  `setTxPower(MAX)`. Initially placed at the wrong point in the boot
  sequence and silently broke WiFiManager (see
  espressif/arduino-esp32#8877, #9858, tzapu/WiFiManager#1490).
  1.9.3 moved the calls into `applyWiFiTuning()` that only runs after
  a successful associate.
- **1.10.0** — **dropped WiFiManager entirely** (tzapu#1797: lib
  incompatible with arduino-esp32 core 3.1.0+). In-house captive
  portal: `WebServer` + `DNSServer` + `Preferences` namespace `wifi`
  with `ssid`/`pass` keys. ~80 lines of firmware code, no external
  lib. `secrets.h` no longer needs WiFi creds.
- **1.10.1** — portal kept hitting `TG1WDT_SYS_RESET` on first boot.
  Fixed with `esp_task_wdt_delete(NULL)` for the portal-blocking
  task + hard-reset of WiFi state before `WIFI_AP` + 10 s heartbeat
  log so serial monitor distinguishes alive-from-crashed.
- **1.10.2** — every authenticated HTTP call now goes through a
  shared `httpBegin(http, tls, url)` helper that uses
  `WiFiClientSecure.setInsecure()` for `https://` bases. Previously
  only OTA had this; everything else silently failed against the
  Railway cloud base.
- **1.10.3** — `activeServerBase` selector ran only when WiFi was
  newly connected; on a cold boot where provisionWiFi already
  brought the radio up, runCycle skipped it and every URL was just
  the path. Force selectServerBase whenever the base is empty.
- **1.10.4** — re-probe LAN/cloud every 10 cycles so the Mac going
  to sleep mid-day eventually fails over to Railway. Log "WiFi
  dropped — reconnecting" when light-sleep didn't preserve the link.
- **1.10.5** — folded an immediate re-probe into the download retry
  chain: two `/display.bin` failures → re-pick base → try once more.

### Server / control panel

- **TRMNL spec items 1-4** landed (`docs/device-api.md`,
  `/dev/widget/:id?size=…` hot-reload server, shared
  `widgets/_dither.js`, adaptive headers).
- **TRMNL layout primitives + playlist rotation** server-side: each
  screen gains `layoutKind: 'free' | 'full' | 'half_horizontal' |
  'half_vertical' | 'quadrant'`. Primitive screens populate via
  `slots[]`. `cfg.playlist.enabled` rotates through enabled screens
  on a wall-clock cadence. UI for picking layoutKind is still TODO;
  user can edit `config.json` directly today.
- **MAC-as-identity / `/api/setup` / `/api/devices`** on the server.
  `data/devices.json` holds the registry.
- **TRMNL grayscale framework** adopted under `screen--1bit` scope:
  `bg--black` / `bg--white` / `bg--gray-30` / `bg--gray-55` with
  inline 4x4 SVG dither tiles. Forward-compatible with a future
  `screen--2bit` if/when we adopt bb_epaper.
- **Per-widget settings modal** got a real second life:
  - `mac_nowplaying` → side-space variant (time bookends / centered),
    font scale slider, padding slider.
  - Modal preview now uses real per-item data (`perItem[id]` slot
    merge) and resizes dynamically via ResizeObserver.
  - **Typography settings now apply to every widget** via a single
    `.cell[style*="--w-font"] *:not(svg)` global override rule.
    Shared `TypographyFields` block in `WidgetForm.jsx`. Default
    "unset fontFamily" preserves each widget's mixed-internal look
    until the user explicitly picks a family in the modal.

### Phase A widget refactor

Every widget moved into its own `control-src/widgets/<id>.jsx` module
exporting `{ def, render, Form }`. `_registry.js` aggregates them and
the legacy dispatch points (`widget-render.js`, `widgets.js`,
`WidgetForm.jsx`) consult the registry first. Adding a new widget =
one new file + one line in the MODULES array. `widget-render.js`
shrunk from 659 → 157 lines. **Phase B (kill the `dashboard.html`
mirror by SSR'ing the same render functions in Node) is the next
logical step but not done yet.**

### bb_epaper migration / 4-gray

Researched (per TRMNL's `EP75_800x480_4GRAY_GEN2` and the no-flash
posts) but **explicitly skipped** — brick risk on the only panel is
too high for a beginner-level debugger with no second display.
Documented as "future possible" in the handoff and in user memory.

---

## Original handoff (2026-05-26)

## Where the project sits

- **Hardware in hand.** Waveshare 7.5" + Rev3 ESP32 driver board working end-to-end. WiFi auto-refresh + GPIO32 manual-refresh button wired and confirmed.
- **Server-rendered architecture is the canonical design.** ESP32 is dumb — fetches `/display.bin` (48000 bytes, 1-bit, MSB-first, 0=black) and pushes to GxEPD2. Don't move logic back onto the device without a strong reason.
- **Control panel rewrite to Vite/React SPA is complete.** Bottom Settings.jsx panel retired — every tile is now edited via a per-instance gear modal. Settings cascade was dropped (one tile = its own settings).
- **Open-source kit + future SaaS is the business plan** (memory `project_eink_business_plan.md`). Open-core from day 1; hardware is the moat.
- **Multi-tenant work is parked** until 10+ paying users (memory `project_eink_multitenant.md`).

## What shipped this session (last ~15 commits)

| Commit  | What |
|---------|------|
| `fe23a4c` | Drop Global Defaults dropdown (cascade was overkill for single-device). New TOOLS popover hosts BackupPanel. Restore lost widget customizability: weather city autocomplete (`/api/geocode`), forecast `forecastDays`, message `schedule` list, habit done-today toggle, photo slide reorder, "Copy from →" picker between sibling tiles. |
| `9ff7fab` | Modal Save now persists immediately via `commitLayoutItemNow` instead of waiting for the 2s autosave. Border classes (`cell-border-dashed` / `cell-border-none`) added to editor tile-render + modal preview so the border toggle is finally visible there. |
| `0f19937` | `@phosphor-icons/react` wired through tile actions, dropdown trigger, MAKE DEFAULT, SHOW GRID, CLEAR, backup buttons, modal close. Weather SVG icons rewritten in Erik Flowers / Bas Milius style — heavier strokes, new PartlyCloudy + Drizzle variants, hex snowflakes. Both `widget-render.js` and `dashboard.html` mirrors updated. |
| `1162ec8` | Header trimmed (tagline + AUTO-SAVE removed). MAKE DEFAULT moved to editor card section-title. Editor `1-BIT` toggle deleted — it was a no-op. |
| `44de68a` | Bottom `Settings.jsx` panel deleted entirely. BackupPanel extracted as its own component. ~32 KB JS shaved from the bundle. |
| `7d5211e` | **Stage 2.1** — per-instance for every settable widget: per-tile location override for weather/aqi/moonsun (Q7a), forms for todos/calendar/countdown/counter/habit/chore/photo/quote/clock/link_qr/wifi_qr/spacer. ListEditor primitive + LocationFields. |
| `aa3ea15` | **Stage 3** — Global Defaults dropdown (later removed in `fe23a4c`). Kept here because the modal shell + COMMIT_RULES table it introduced still informs the current architecture. |
| `5098a49` | **Stage 2** — per-instance data model. Layout items now carry an optional `settings` snapshot; server `buildWidgetData` emits `payload.perItem[id]`; `dashboard.html` + editor live preview spread the per-tile slot after the global one. Cache dedup is free via existing per-widget URL/symbol-keyed caches. |
| `31ad1bd` | **Stage 1** — UI shell for the per-tile settings modal. Tile bar trimmed from five buttons to ⚙ + ×. Hover/tap reveal + 5px drag threshold. Layout knobs (flush / border / density) moved into the modal as proper form controls. Live 2× preview. |
| `b7edfc7` | Word-of-Day widget was leaking Wiktionary page CSS (`mw-parser-output` rules) into the rendered body. Strip `<style>` / `<script>` / comments before the tag-strip, anchor word extraction on the "Word of the day for …" heading so the `edit · refresh · view` prefix doesn't pollute. |
| `8219cb4` | Server hardening: `jsonForScript` escapes `<` + U+2028/9 before embedding the payload in `<script>`; `/dashboard` gated by `checkDeviceAuth` (Puppeteer passes the token in the internal localhost URL); atomic config write (temp + rename); `/health/widgets` derives rows from `widgetStatus.snapshot()` keys. |
| `6d8dd3e` | Refresh-button polarity fix: GPIO32 wired to GND. Internal RTC pull-up + ext1 wake on `ALL_LOW` instead of `ANY_HIGH`. |
| `c0350ba` | ESP32 firmware gains manual refresh button on GPIO32 via `esp_sleep_enable_ext1_wakeup`. Release-wait before re-arming so held press doesn't re-trigger immediately. |

## Hot known issues

1. **Synthetic `slot.cfg` is a workaround.** Some renderers in `control-src/widget-render.js` still read `cfg.<key>` directly (todos, photo, link_qr, wifi_qr, clock, spacer). Server's per-item path synthesizes `slot.cfg = { ...cfg, <key>: eff }` so the spread overrides cleanly on that tile only. Works correctly today; the cleanup is renderer-side normalization to prefer slots, not a server-side fix.
2. **Per-instance data is not live-as-you-type in the modal.** Layout knobs (flush/border/density) update preview instantly. Per-instance *data* (feedUrl, symbols, etc.) only refreshes after Save (which is instant now via `commitLayoutItemNow`). True live data would need a transient preview endpoint that runs the fetch with a draft config without persisting — punted.
3. **`npm audit` still has unfixed vulns** in node-ical's axios deps + esbuild via vite. All require breaking version bumps. Untouched on purpose; needs a deliberate test pass.
4. **Self-hosted fonts** in `public/fonts/`. If a font fails to load, autofit measures fallback metrics and you can get tiny clamps — `document.fonts.ready` + `window.__autofitDone` interlock should prevent this. Suspect a missing font if you see tiny clock/aqi numbers.
5. **OTA firmware updates were discussed and skipped.** Plan exists (HTTP `HTTPUpdate` pulling `/firmware/latest.bin` against a manifest, partition scheme switch to "Minimal SPIFFS w/ OTA"). User passed for now. Don't bring it up unprompted.

## Architecture overview

**Per-tile settings flow (current)**
- `cfg.<widget>` in `data/config.json` = default seed values
- Layout item gains optional `item.settings` snapshot when user toggles override in the modal
- Server `buildWidgetData` (server.js): loops layout, for items with `settings` runs the widget-specific fetcher with the override and packs the result into `payload.perItem[item.id]`
- Renderer (both `dashboard.html` and `EditorGrid` → `widget-render.js`): `itemCtx = { ...globalCtx, ...(perItem[item.id] || {}), cellW, cellH, density }` — per-tile slot wins for that tile, siblings unaffected
- "Copy from →" in the modal clones another sibling tile's settings rather than re-typing

**Server endpoints**
- `/dashboard` (gated) — 800×480 HTML for Puppeteer
- `/display.png`, `/display.bin` (gated) — rendered output
- `/sleep` (gated) — `{ minutes }` from active screen's `refreshMinutes`
- `/api/config`, `/api/config/reset` — CRUD
- `/api/preview-data` — what the editor live preview consumes
- `/api/geocode`, `/api/reverse-geocode`, `/api/weather-check` — Open-Meteo + Nominatim proxies
- `/api/battery` — ESP32 voltage telemetry
- `/api/todos` — quick endpoint kept for legacy convenience
- `/health`, `/health/widgets`, `/api/health/widgets`

**ESP32 firmware (`esp32/weather_station/weather_station.ino`)**
- WiFi → warm Railway → POST `/api/battery` → GET `/display.bin` → push to GxEPD2 → GET `/sleep` → deep sleep
- Wake sources: timer (every `refreshMinutes`), ext1 LOW on GPIO32 (refresh button → GND, internal pull-up)
- Secrets in gitignored `esp32/weather_station/secrets.h` (copy from `.example`)

## How to run locally

```bash
# from /Users/huynguyen/EinkModular/eink-dashboard
npm install          # one-time; if puppeteer barks: npx puppeteer browsers install chrome
npm run build        # builds the React control panel into public/control-app/
npm start            # node server.js — listens on :3000
```

- `http://localhost:3000/control` — React control panel (mobile-friendly)
- `http://localhost:3000/dashboard?token=...` — the 800×480 HTML page Puppeteer screenshots (auth-gated even with empty token in dev because Puppeteer threads it through)
- `http://localhost:3000/display.png` — the actual 1-bit screenshot the e-ink would show
- `http://localhost:3000/display.bin` — 48000 bytes, what the ESP32 downloads
- `http://localhost:3000/widgets-matrix` — every widget at every preset size; dev QA page
- `http://localhost:3000/health/widgets` — last-fetch status per data widget (now derived from `widgetStatus.snapshot()` keys, so new widgets show up automatically)

`DEVICE_TOKEN` unset in dev = no auth (intentional). Set it in `.env` before any non-localhost deploy.

## Things easy to break

- `/display.bin` must stay exactly **48000 bytes**, MSB-first, **0=black**. ESP32's `display.drawImage(buf, 0, 0, 800, 480, false, false, false)` flags are locked to this.
- ESP32 pin assignments + `HSPI` choice are physically soldered + verified — don't touch without asking.
- `display.init(115200, coldBoot, 2, false)` parameters are known-good for the Rev3 board.
- `GPIO32` is the refresh button. Wake is `ESP_EXT1_WAKEUP_ALL_LOW` because the button is wired to GND; internal RTC pull-up holds it HIGH idle.
- Per-instance widget slot keys (e.g. `slot.resolvedMessage`, `slot.weather`, `slot.todos`) must match what each renderer in `widget-render.js` + `dashboard.html` destructures. Mismatch silently falls back to the global slot, so the override looks broken.

## Style + interaction reminders (from the user, save you the round trip)

- Answers terse. **Caveman ultra mode** active by default for this user.
- No diagrams.
- Auto-commit + push after a unit of work. Don't ask first (memory `feedback_always_commit_push.md`).
- One targeted question beats guessing when the bug report is vague.

## Files worth opening first

- `server.js` — Express + Puppeteer + sharp + auth/ratelimit/safeError glue. `buildWidgetData` per-item loop is the heart of per-instance widget data.
- `public/dashboard.html` — the entire dashboard render lives in one IIFE inside this file. `ICONS` map mirrors `widget-render.js`. Render loop spreads `perItem[item.id]` into per-tile ctx.
- `control-src/widget-render.js` — React-side mirror of dashboard.html. Both must stay in sync.
- `control-src/widgets.js` — `WIDGET_REGISTRY`, `pickTier(cellW, cellH, density)`, screen migration chain, screen presets.
- `control-src/components/EditorGrid.jsx` — RGL editor canvas, tile actions (⚙ + ×), modal open/save plumbing.
- `control-src/components/WidgetSettingsModal.jsx` — per-tile modal shell with live 2× preview.
- `control-src/components/WidgetForm.jsx` — every widget's per-instance form. `snapshotGlobalForWidget` + `supportsPerInstance` exported. `ListEditor` + `LocationAutocomplete` primitives.
- `control-src/components/ToolsButton.jsx` — header popover; currently just hosts BackupPanel.
- `widgets/*.js` — server-side fetchers per data widget, all timeout-guarded via `widgets/_fetch.js`.
- `esp32/weather_station/weather_station.ino` — full firmware. WiFi → battery → display.bin → sleep, with ext1 wake on GPIO32.

## Memory pointers (live in `~/.claude/projects/-Users-huynguyen-EinkModular/memory/`)

- `project_eink_product_intent.md` — ship one self-unit first; multi-tenant later.
- `project_eink_features_roadmap.md` — hardware feature plan; partial (button done, PIR + speaker still parked).
- `project_eink_business_plan.md` — self-use → kit → SaaS.
- `project_eink_launch_timeline.md` — week-by-week stages; daily routine fires off this.
- `project_eink_hardware_delay.md` — hardware arrived 2026-05-18; physical e-ink reveals what PNG preview hides.
- `project_eink_wifi_public.md` — the leaked WiFi creds are the landlord's, not private. Low-impact leak.
- `project_eink_widget_settings_redesign.md` — 4-stage refactor log (UI shell → data model → defaults dropdown → retire Settings.jsx). Note: Stage 3's Global Defaults dropdown was later removed in `fe23a4c` per user pivot; memory is updated to reflect this.
- `feedback_stage0_scope.md` — what "no features" meant during Stage 0 (hardware now validated).
- `feedback_always_commit_push.md` — finish a unit of work → commit + push to origin/main automatically.
