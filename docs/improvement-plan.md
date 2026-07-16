# Improvement Plan — 2026-07-16

Where the effort should go next, ranked. Context: 31 widgets, tokens
widgets-wide, three test harnesses (api / widgets-matrix+editor /
display-composition), beam-to-display, quick-events calendar, screen
presets. The pure-software feature space is mined out — the last three
"more features" rounds mostly found things that already existed. What
moves the project now is reliability, the hardware track, and launch
readiness (per the Stage 0–3 timeline agreed 2026-05-17, currently ~2
months behind its own schedule).

---

## Track A — Prove it as a daily driver (Stage 0, restart the clock)

The unit runs and the user checks it daily, but Stage 0's exit gate —
**7 consecutive days with zero manual intervention** — was never
formally run. Everything else sequences behind this.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| A1 | Start the 7-day clock. Log every manual poke (reflash, restart, config rescue) in handoff.md | none | Discipline, not code |
| A2 | Battery drain measurement — /status already charts history; record days/charge vs the 2-week target | none | Read the chart after a full cycle |
| A3 | Ghosting check after ~500 refreshes — photo of a white screen | none | If bad: periodic full-refresh cycle in fw |
| A4 | Firmware button actions (task #30): decide single-press = refresh (already works) vs adding double-press = cycle screen | S (fw) | Needs a flash session at the desk |
| A5 | Buzzer alarm end-to-end test — alarm set in editor → device rings | none | Feature shipped; never panel-verified |

## Track B — Reliability hardening (parallel with A)

Failures the current design can still produce, worth closing before
strangers run this:

| # | Item | Effort | Notes |
|---|------|--------|-------|
| B1 | Config backup/restore — download/upload config.json from the editor (Settings menu). One bad save away from losing 2 months of layout work | S | Export exists? verify; import is the missing half |
| B2 | Feed failure visibility on the face — calendar silently shows stale/empty when the school feed 404s; add the `staleMark` idiom to calendar titles like other widgets | S | |
| B3 | Yahoo/lichess quota courtesy — jittered fetch offsets so a fleet of kits doesn't hammer at :00/:30 | S | Matters at Stage 3, cheap now |
| B4 | data/ volume monitoring — uploads dir + battery history growth unbounded on the Railway volume; add size line to /status | S | |
| B5 | Editor error telemetry — ErrorBoundary catches exist but nothing reports; add a "copy debug info" button to the crash card | S | |

## Track C — Launch readiness (Stage 1 list, mostly unstarted)

The repo's biggest gap vs. the timeline. None of this is code:

| # | Item | Effort | Notes |
|---|------|--------|-------|
| C1 | README rewrite: hero photo of the physical unit, control-panel screenshot, `Deploy on Railway` button, 5-minute quickstart | M | The current README predates ~everything |
| C2 | LICENSE (MIT) + CONTRIBUTING.md (open-core note) | S | Blocks any public post |
| C3 | BOM doc: exact panel/board/battery/TP4056 part numbers + links | S | All known from CLAUDE.md |
| C4 | 30s demo loop video + white-screen/ghosting photos | S | Phone + tripod |
| C5 | Frame STL files (if a frame exists) or "roadmap" note | ? | Hardware-side unknown |
| C6 | Secrets sweep before publicity — .env.example completeness, no tokens in git history, firmware secrets.h.example paths | S | One `vibe-security-audit` pass |
| C7 | First-run experience dry run: fresh Railway deploy + fresh ESP32 flash from README alone, note every stumble | M | The real test of C1 |

## Track D — Deliberately parked (don't start)

- **Multi-tenant / SaaS** — keystone is file→DB per-device config
  (docs/multitenant-architecture.md). Gate: 10+ paying kit users.
- **AI features** — user decided against (brief widget built + removed
  2026-07-15).
- **More widgets** — 31 is past sufficiency; new ones only on real
  user request (chess/stocks pattern: ~2h each, wiring is mechanical).
- **PIR / speaker** — roadmap hardware; sequence after button work
  proves the fw iteration loop.

## Sequencing

1. **This week:** A1 starts immediately (free), A4+A5 in one desk
   session (button fw + alarm test), B1+B2 shipped remotely.
2. **While the 7-day clock runs:** Track C paperwork (C1–C4, C6) — it
   needs no code and the clock provides the photos.
3. **Gate:** 7 clean days + C-list done → post (Stage 2: Show HN,
   r/eink, Hackaday).
4. **After launch feedback:** re-rank everything; B3 before first kits
   ship.

The one thing NOT to do: another software feature sprint. The panel on
the wall and the README are the product now.
