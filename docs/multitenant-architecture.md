# Multi-tenant (SaaS) Architecture — design doc

**Status: design only. NOT built. Do not start without explicit go-ahead.**
This is the path from today's single-tenant app to a multi-user SaaS where
many people each run several devices off one hosted instance.

Audience: any future session (any Claude version) picking up scaling work.
Read this with `CLAUDE.md`, `handoff.md`, the `project_eink_multitenant`
memory, and `docs/device-api.md`.

Confirmed product direction (user, 2026): eventual model is **multi-tenant
SaaS**, not self-host-per-user. One user owns several devices in their home
(kitchen = weather, office = schedule). Parked until there are paying users
— validate one hardware unit first. Don't add premature auth/DB scaffolding
to the single-tenant code in the meantime.

---

## 1. Today (single-tenant) — the starting point

- **One global config**: `data/config.json` (file), read/written through
  `loadConfig()` / `saveConfig()` / `withConfigLock()`. Holds `screens[]`,
  `alarms`, `timezone`, `quietHours`, `auth` (PIN), etc.
- **One render path**: `GET /display.bin` → `resolveVariant(req,cfg)` →
  `pickActiveScreen(cfg)` → render the active screen. Every device that
  authenticates gets the SAME config; `?screen=` is the only per-request
  override.
- **Auth**: a single `DEVICE_TOKEN` (device/image endpoints) + a single
  Control PIN (editor, `checkAdminAuth`). This locks the WHOLE site to one
  owner. Correct for self-use; does not scale to many owners.
- **Devices roster exists but is owner-less**: `POST /api/setup` mints a
  per-device `api_key` + `friendly_id` and stores `{mac, api_key,
  friendly_id, board, fw_version, last_seen_at}` in `data/devices.json`.
  No account, no per-device config. `checkDeviceAuth` already accepts a
  device `api_key` OR the global token.

**The real blocker is the data model, not auth.** Config is one file; that
is what prevents two devices from showing different dashboards. Auth/claim/
billing all bolt on after config is per-owner.

---

## 2. Target model

```
account (user)
  └── has many screens   (a "dashboard" = a screen layout + schedule)
  └── has many devices   (physical ESP32s)
        └── device.screen_id → which screen this device renders
```

- A **user** signs in (magic-link or OAuth), owns N screens + N devices.
- A **device** is claimed into exactly one account and assigned one screen
  ("Show: Kitchen"). The screens system we already have maps cleanly onto
  "what each device shows."
- The device fetch path stays token-based: the ESP32 sends its key, the
  server resolves key → device → account → screen, and renders THAT.

---

## 3. The keystone change: file → database

This is the only expensive-to-retrofit piece. Everything else is additive.

Recommended store: **Postgres via Supabase** (MCP tooling is available in
this environment; `mcp__claude_ai_Supabase__*`). Schema sketch:

```sql
-- accounts
create table accounts (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  created_at    timestamptz default now(),
  plan          text default 'free',
  stripe_customer_id text
);

-- a dashboard layout owned by an account (replaces cfg.screens[] entries)
create table screens (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name       text not null,
  config     jsonb not null,          -- the per-screen layout/widgets/schedule
  created_at timestamptz default now()
);

-- physical device, claimed into an account, pinned to one screen
create table devices (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid references accounts(id) on delete set null, -- null = unclaimed
  api_key       text unique not null,   -- sent by firmware (already exists)
  friendly_id   text not null,          -- short human code (already exists)
  claim_code    text,                   -- short code shown on the panel until claimed
  mac           text,
  board         text,
  fw_version    text,
  screen_id     uuid references screens(id) on delete set null,
  settings      jsonb default '{}',     -- per-device overrides (units, etc.)
  last_seen_at  timestamptz,
  battery       jsonb                   -- last {pct, v, at}
);
```

Account-level settings that today live at the top of `config.json`
(timezone, quietHours, refresh defaults, alarms) move to an `accounts`
column or an `account_settings` table; per-screen bits live in
`screens.config`.

`withConfigLock()` (the file mutex) is replaced by normal SQL transactions.

---

## 4. Device claim / provisioning flow

Replaces today's owner-less `/api/setup`.

1. ESP32 first boot → `POST /api/setup` (still unauthenticated bootstrap)
   → server creates a `devices` row with `account_id = null`, a fresh
   `api_key`, and a short `claim_code` (e.g. `KITCHEN-4F2A`). Returns
   `api_key` + `claim_code` + `friendly_id`.
2. Device, while unclaimed, renders a built-in "Claim me" screen showing
   `claim_code` (server can render this; no firmware change needed beyond
   drawing whatever image it's served).
3. User signs in to the web app → "Add device" → types `claim_code` →
   server binds `devices.account_id = me`, clears `claim_code`.
4. User assigns a screen: `devices.screen_id = <one of my screens>`.

Security: an unclaimed device's `api_key` can only fetch the claim screen,
not anyone's dashboard. Claiming requires being signed in.

---

## 5. Request resolution (per device)

`GET /display.bin` (and `.png`, `-3c.bin`, `/sleep`, `/api/alarm/next`):

1. Read the device key: `X-API-Key` header (or `?token=`).
2. `devices` lookup by `api_key`. Unknown → 401.
3. Unclaimed (`account_id` null) → render the claim screen.
4. Claimed → load `screens` row at `device.screen_id` (fall back to the
   account's default screen) + account settings → render that.
5. Battery/refresh headers (`X-Refresh-Rate`, `X-Refresh-Seconds`),
   push-now window, battery-aware + quiet-hours logic all stay — just
   scoped per account/device instead of global.

**No firmware change required**: the device already sends its key on every
request (`addAuth` adds `X-API-Key`; `addToken` adds `?token=`). The global
`DEVICE_TOKEN` path is dropped (or kept only for the owner's own fleet).

---

## 6. Auth for humans

- Magic-link email (simplest; no password storage) or OAuth (Google).
- Session cookie like today's PIN session, but keyed to `account_id`.
- The current single Control PIN becomes a per-account concept; the
  `checkAdminAuth` middleware resolves the session → `account_id` and every
  config query is scoped `where account_id = $me`.

---

## 7. Caching with many tenants

Today's image cache keys on `"units|screen"`. Re-key on
`device_id` (or `account_id|screen_id`). The pre-render warmer can't warm
every device on a fixed interval at scale — switch to: warm lazily on first
request + stale-while-revalidate (already implemented), and optionally warm
a device shortly before its known next wake using `last_seen_at` + its
refresh interval. Puppeteer page semaphore (`MAX_PAGES`) becomes the
throughput bottleneck — may need a render queue / horizontal scaling.

---

## 8. Build sequence (when demand is real)

1. **Supabase migration** of config: stand up the schema, move
   `loadConfig/saveConfig` to a DB-backed `loadAccountConfig(accountId)`.
   Keep the single-tenant app working by seeding one account from the
   existing `config.json`.
2. **Accounts + magic-link auth**; scope the editor to `account_id`.
3. **Per-device config**: claim flow + screen assignment + per-device
   request resolution.
4. **Billing** (Stripe) — last, once people pay.

Estimated ~1–2 weeks of focused work once started. Do NOT start before
there are paying users; hardware + product validation come first.

---

## 9. Guardrails for single-tenant work in the meantime

Keep future-you unblocked without building any of the above:

- Don't deepen "there is exactly one config" assumptions. Prefer passing
  `cfg` through functions (already the pattern) over reading a global.
- Keep per-device identity flowing: `api_key` / `friendly_id` already exist
  — don't remove them, don't collapse devices into one record.
- Keep render logic a pure function of `(cfg, variant)` so swapping the
  config source (file → DB row) is a one-call change.
- Anything device-cadence (push-now, battery-aware, quiet hours) already
  takes `cfg` — fine to keep extending; it'll scope per-account for free.

## 10. Open questions (decide when starting)

- One screen per device, or can a device cycle several of the account's
  screens (playlist already exists)? → likely keep playlist as a per-device
  option.
- Free tier limits (devices/account)? Drives the billing model.
- Self-host escape hatch for power users, or pure SaaS? Current lean: pure
  SaaS (one instance), self-host only as the pre-revenue proving step.
