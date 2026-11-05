# Analytics v2 — implementation plan

Goal: take the Analytics screen from "page views and breakdowns" to a full
web-analytics product (accurate basics → attribution → behaviour → goals and
funnels → deep analytics → replay/heatmaps), while every number stays real and
traceable to stored events.

Status when written (2026-09-30): Analytics reads raw `analytics_events` for the
selected range (paginated, UTC days), bots are flagged (`is_bot`, migration 026),
date presets/custom range and PDF export exist. Tracker = `installAnalytics()` in
the generated SDK (`src/lib/sdk/generate.ts`), pushed to client repos as a PR by
`/api/admin/push-integration`.

---

## 0. Cross-cutting decisions (settle before Phase 1)

### 0.1 Tracker delivery and versioning
- The tracker ships **inside each client's `lib/cms.ts`**, so any tracker change
  only reaches a site after the integration PR is re-pushed and merged.
- Add `ANALYTICS_TRACKER_VERSION` (int) sent with every event (`tv` field, stored
  in `metadata.tv`). The dashboard can then show, per client, "tracker v3 — up to
  date" or "tracker v1 — reinstall to unlock scroll/click/forms".
- Extract the tracker from `cms.ts` into its own generated file
  `lib/ne-analytics.ts` (v3 SDK) so it can be re-pushed without touching CMS
  fetch code. Keep `installAnalytics`/`trackEvent`/`trackPageView` exported from
  `lib/cms.ts` as re-exports (no client code breaks).
- Every new dashboard section must degrade gracefully ("needs tracker v3") when a
  client's events lack the new fields. Never show a 0 that really means "not
  collected".

### 0.2 Event schema
- Promote frequently-filtered fields to real columns; keep the rest in `metadata`
  JSONB (capped at 2 KB per event already).
- New columns on `analytics_events` (all nullable, additive):
  `utm_source, utm_medium, utm_campaign, utm_term, utm_content, click_id_type`,
  `channel` (derived server-side), `landing_path`, `is_entry` (bool),
  `engaged_ms` (int), `scroll_pct` (smallint), `is_new_visitor` (bool),
  `screen_w` (int), `lang` (text), `tracker_version` (smallint).
- Event taxonomy (`event_name`): `page_view`, `page_leave` (carries `engaged_ms`,
  `scroll_pct`), `click_outbound`, `click_download`, `click_cta`, `click_tel`,
  `click_mailto`, `form_start`, `form_submit`, `form_abandon`, `site_search`,
  `web_vital`, `js_error`, `rage_click`, `dead_click`, plus custom `trackEvent`.
- Server-side derivation in the beacon route (never trust the client): channel
  grouping, entry flag, bot flag, country, device. Validate and length-cap every
  field like the existing route does.

### 0.3 Aggregation strategy (scaling)
Today the page downloads raw events (≤30k). Scroll/click/vitals events multiply
volume ~5–10×, so:
- Phase 1 introduces **SQL functions (RPC)** that aggregate in Postgres and return
  small result sets: `analytics_overview(client, from, to, include_bots)`,
  `analytics_breakdown(client, from, to, dimension, include_bots, limit)`,
  `analytics_timeseries(client, from, to, granularity)`. RLS-safe via
  `SECURITY INVOKER` and the existing `my_client_id()/is_ne_admin()` policies.
- Raw events stay the source of truth. `analytics_daily` is extended (or replaced
  by `analytics_daily_dims`) only if RPC latency at 90+ days needs it; measure
  first (target: overview < 500 ms at 500k events).
- Retention policy: raw events kept 400 days (cron delete), aggregates forever.
- Indexes added per feature (see phases); check with `get_advisors`.

### 0.4 Privacy and consent
- Phases 1–5: cookieless-compatible. `visitor_id` stays a random localStorage ID
  (no fingerprinting, no IP stored). Add `respectDNT` + `disableAnalytics()` and a
  documented opt-out (`localStorage.ne_optout=1`).
- Phase 6 (replay/heatmaps) records on-screen behaviour: opt-in per client,
  consent gating (`installAnalytics({ consent: () => boolean })`), input masking by
  default, `data-ne-mask` / `data-ne-block` attributes, and a per-client toggle in
  Settings. Do not ship without this.
- Add a Privacy section to the Analytics settings: what is collected, retention
  period, opt-out instructions (copy clients can paste into their privacy policy).

### 0.5 Testing and rollout standards
- Every phase: unit tests for pure logic (parsers, channel grouping, funnels),
  route tests for the beacon, SQL function tests via Supabase MCP against a
  seeded branch, PDF render check (image inspection), `tsc`, `eslint`, full
  `vitest`.
- Use a Supabase **branch** for schema work when possible; otherwise
  additive-only migrations (nullable columns / new tables / `IF NOT EXISTS`) applied
  with `apply_migration` in the same session, per `supabase/migrations/README.md`.
- Ship each phase to `master` behind no flag (UI sections hide themselves when the
  data isn't present), and verify on Zhenghe real data before moving on.

---

## Phase 1 — Accuracy and basics

**Outcome:** trustworthy numbers plus the standard "audience overview" metrics.

Tracker (SDK)
1. Fix duplicate page views: stop hooking `history.replaceState`; hook only
   `pushState` + `popstate`; de-dupe identical `(path, search)` fired within 1 s.
2. Fix SPA referrer: first page view of a session uses `document.referrer`;
   subsequent in-site navigations send the previous page's URL as `referrer` and
   are marked `internal`. Exclude same-host referrers from the Referrers card.
3. Add `page_leave` (visibilitychange/pagehide + `sendBeacon`) with `engaged_ms`
   (visible time with activity in last 10 s) and `scroll_pct` (max %).
4. Send `is_entry`, `is_new_visitor` (first ever event for this visitor_id),
   `screen_w`, `lang`, `tracker_version`.
5. SDK generator: emit `lib/ne-analytics.ts` (v3), keep `cms.ts` re-exports; unit
   tests in `generate.test.ts` for output content.

Backend
6. Migration 027: new columns (0.2) + indexes `(client_id, created_at)` partial on
   `event_name='page_view'`, `(client_id, session_id)`, `(client_id, visitor_id)`.
7. Beacon route: accept + validate new fields, derive `channel` (Phase 2 fills it),
   store `tracker_version`; batch endpoint `POST …/analytics/batch` (array, max 20)
   so page_leave/click bursts don't hit the 120/min limiter.
8. RPCs from 0.3 (`analytics_overview`, `analytics_breakdown`, `analytics_timeseries`)
   + tests. Switch the page from client-side aggregation to RPC calls; keep the
   pure helpers used by the PDF.
9. Metrics defined in one module `src/lib/analytics/metrics.ts` (single definition
   each, unit-tested):
   - Engaged session = ≥10 s engaged, or ≥2 page views, or a conversion event.
   - Bounce rate = 1 − engaged-session rate. (Document that this matches GA4.)
   - Pages/session, avg engaged time/session, new vs returning, entry pages,
     exit pages.

UI
10. Period-over-period comparison: "vs previous period" toggle (same length
    immediately before, or same period last year); deltas on every stat tile and
    dotted comparison line on the trend chart.
11. New tiles: Engagement rate, Avg. engaged time, Pages/session, New vs returning.
    New cards: Entry pages, Exit pages, Hourly heatmap (day-of-week × hour, in the
    client's timezone, see item 12 below).
12. Timezone setting per client (`clients.timezone`, default `Asia/Singapore`);
    all day bucketing moves from UTC to that zone (RPC takes the tz). Update range
    resolver, PDF labels, and tests. (Resolves the 8 am day-boundary caveat.)
13. Chart interactions: hover tooltips, click a day to drill into that day, metric
    switcher (views / visitors / sessions), granularity (hour/day/week/month).
14. Tracker-version banner per client (0.1).

Acceptance: overview numbers equal a manual SQL count on Zhenghe for 3 ranges;
no duplicate page views on a Next.js test site; referrer no longer repeats
across a session; RPC overview < 500 ms on synthetic 500k events.

---

## Phase 2 — Marketing attribution

1. Tracker: capture `utm_*` and click IDs (`gclid`, `fbclid`, `msclkid`, `ttclid`,
   `li_fat_id`) on landing, persist for the session (`sessionStorage`), attach to
   the session's events; store `landing_path`.
2. Server: `channel` derivation in `src/lib/analytics/channels.ts` (pure, tested):
   Paid Search, Paid Social, Organic Search, Organic Social, Email, Referral,
   Direct, Display, Affiliates, Other — using utm_medium, click IDs and referrer
   host lists (search engines, social networks, AI assistants as "AI/Chatbots").
   Rules table in code, documented; unknown → Referral/Direct.
3. Migration 028: `referrer_host` derived column + `traffic_sources` seed table
   (host → source name/category) so the list is editable without a deploy.
4. UI: Channels card (bar + trend), Source/Medium table, Campaign table (sessions,
   engaged rate, conversions once Phase 4 lands), Landing pages table
   (sessions, engagement, bounce), Search-engine / social-network breakdowns,
   AI-referral breakdown (chatgpt.com, perplexity.ai, gemini.google.com…).
5. UTM builder helper in Settings (copyable tagged URLs) so campaigns arrive tagged.
6. Backfill: derive `referrer_host` and `channel` for historical rows from stored
   `referrer` (no UTM history exists; be explicit in the UI).

Acceptance: a test URL with `?utm_source=x&utm_medium=cpc&utm_campaign=y` appears
under Paid Search / x / y; Zhenghe history shows sensible Organic Search / Direct
splits.

---

## Phase 3 — Behaviour (auto-tracked events)

Tracker (all opt-out via options, all passive, no PII):
1. Scroll depth milestones 25/50/75/90/100 (`scroll_depth`, once per page view).
2. Outbound link clicks (`click_outbound` with target host), file downloads
   (`click_download` with extension), `tel:`/`mailto:` clicks.
3. CTA/button clicks: any element with `data-ne-track="name"` or
   `data-ne-event`; plus auto-label for `<button>`/`<a>` with text (truncated 60,
   masked if it looks like an email/number).
4. Forms: `form_start` (first interaction), `form_submit`, `form_abandon`
   (left with started-not-submitted), field-level drop-off (field name only,
   never values). Integrates with the CMS forms endpoint so submits reconcile.
5. Site search: detect `?q=/?s=/?search=` param or `data-ne-search`; record term.
6. Video/embeds: YouTube/Vimeo play/25/50/75/100 via their iframe APIs (optional).
7. Public API: `trackEvent(name, props)`, `identify(traits)` (opaque ID only),
   `setUserProperties`. Property allow-list + size caps enforced server-side.

Dashboard:
8. Events explorer: table of event names (count, unique visitors, trend), click
   through to properties breakdown (top values per property key).
9. Scroll-depth report per page; Outbound & downloads tables; Forms report
   (starts, submits, abandon rate, drop-off by field); Site-search terms table
   (with "no results" if the site reports it); CTA leaderboard.
10. Event filters everywhere: filter any report by page, channel, country, device,
    event property (chip-based filter bar; state in URL query for shareable links).

Acceptance: on a demo page, every auto-event appears once, with correct counts, in
the explorer, and the filter bar changes every card consistently.

---

## Phase 4 — Goals and funnels

1. Tables (migration 029): `analytics_goals` (client_id, name, type
   `event|page|duration|scroll`, match rules JSONB, value numeric, active) and
   `analytics_funnels` (client_id, name, ordered steps JSONB, window_hours,
   open|closed). RLS like other client-scoped config tables; only client admins
   / ne_admin can write.
2. Goal evaluation in SQL (RPC `analytics_goal_stats`) — conversions,
   conversion rate (sessions and visitors), value, by channel/page/device/country.
   No stored per-event goal flag (keeps history re-computable when goals change).
3. Funnel engine: RPC `analytics_funnel(client, funnel_id, from, to)` computing
   per-step visitors/sessions in order within the window using window functions;
   returns step counts, step-to-step conversion, median time between steps.
   Pure TS reference implementation with tests to define semantics (open vs closed
   funnels, repeated steps, out-of-order events).
4. UI: Goals manager (create from templates: "Form submitted", "Visited /contact",
   "Estimator completed", "Scrolled 75% on /services/*", "Engaged > 60 s"), goal
   tiles on overview, Funnels page with step bars, drop-off %, breakdown by
   channel/device/country, and "biggest leak" callout.
5. Pre-built funnel for Zhenghe: `/estimator/step-1 → step-2 → … → submit`.
6. Attribution models on conversions: last-click (default), first-click, linear;
   selectable in the Campaigns/Channels tables (computed from session order).

Acceptance: funnel counts match a hand-built SQL query on Zhenghe estimator
sessions; goal conversion rate equals converting sessions / sessions.

---

## Phase 5 — Deep analytics

1. **User paths:** Sankey of top N next-page transitions from a chosen start (or
   into a chosen end) page, computed by RPC from session-ordered page views;
   collapse tail into "Other"; min-count threshold to avoid noise.
2. **Retention & cohorts:** weekly/monthly cohort matrix (new visitors by first-seen
   period × return in period N), returning-visitor rate, visit frequency and
   recency distributions, "days between visits".
3. **Core Web Vitals:** tracker uses `web-vitals`-equivalent observers (LCP, INP,
   CLS, plus TTFB/FCP) → `web_vital` events (value, rating, page, device); report
   p75 per page/device with good/needs-improvement/poor bands and trend.
4. **Errors:** `js_error` (message truncated, source file, line; stack hashed),
   `unhandledrejection`, failed resource loads; grouped by fingerprint with counts,
   first/last seen, affected pages/browsers; 404 detection via `window.__ne_404`
   or status hook; broken-link report.
5. **Frustration signals:** `rage_click` (≥3 clicks within 1 s in 30 px),
   `dead_click` (click with no DOM/URL change in 1 s), `u_turn`; report by page and
   element selector (sanitized, no text).
6. **Real-time:** live visitors (last 5 min), live event stream, top active pages,
   world dot map; via short polling of a cached RPC (Supabase Realtime later).
7. **Audience:** technology (OS version, screen size buckets, language), geography
   drill-down (country → region → city if a geo header is available; Vercel gives
   `x-vercel-ip-country-region` / `-city`) — city stored only if the client enables it.
8. **Insights and alerts:** anomaly detection on daily views/conversions (z-score
   vs same weekday), weekly "what changed" summary (top gainers/losers pages and
   sources), threshold alerts (traffic drop > X %, error spike, vitals regression)
   delivered by email (existing mail provider) and shown in-app.
9. **Reports:** saved views (filters + range + metrics), scheduled PDF/CSV email
   (weekly/monthly) via a new cron, shareable read-only report links with expiry
   (signed token, no login) for clients, CSV export on every table, richer PDF
   (comparison deltas, funnels, goals, channels, branding with client logo).
10. **Data hygiene:** internal-traffic filter (IP/visitor allow-list to exclude the
    agency and client staff — set via a "This is me" toggle storing a
    visitor_id in `analytics_excluded_visitors`), referral exclusion list, and a
    bot-review screen (top suspected bot signatures) to tune `isBotUserAgent`.

Acceptance: each report reconciles with SQL spot-checks on Zhenghe; vitals appear
after installing tracker v3 on a test site and match Lighthouse within tolerance;
alerts fire on a seeded drop.

---

## Phase 6 — Replay and heatmaps (opt-in, consent-gated)

Prerequisites: 0.4 complete; per-client `analytics_replay_enabled` flag; legal
copy in Settings.

1. **Click / move / scroll heatmaps:** aggregate click coordinates (relative to
   viewport width buckets and to element selector), scroll reach, attention
   (time-in-viewport per section). Stored as compact aggregates
   (`analytics_heatmap_bins`) not raw coordinates forever; render as overlay on a
   page screenshot captured by a headless job (Playwright, already available) with
   desktop/tablet/mobile variants.
2. **Session replay:** DOM-snapshot + mutation recorder (rrweb, MIT) with input
   masking on by default, `data-ne-block` support, network/text redaction rules,
   sampling rate per client, 30-day retention, chunked upload to a private storage
   bucket (`analytics-replays`), signed-URL playback in a viewer with event
   timeline (clicks, errors, rage clicks), speed control, skip-inactivity.
3. **Replay links from reports:** from a funnel drop-off step, a rage-click row or a
   JS error, "watch sessions" opens matching replays.
4. **A/B testing (optional):** experiment definitions, deterministic variant
   assignment in the SDK, exposure + goal events, significance calculator
   (Bayesian), per-variant funnels. Only after Phase 4 is stable.
5. **Cost and safety guardrails:** storage budget per client, automatic pause at
   limits, delete-on-request endpoint (GDPR erasure by visitor_id), audit log of
   who viewed replays (existing activity log).

Acceptance: masked inputs never appear in stored data (automated test that fills
password/email fields and inspects payloads); erasure removes replays + events.

---

## Suggested order and sizing

| Phase | Size | Depends on | Release cadence |
|---|---|---|---|
| 0 decisions | S | — | this week |
| 1 accuracy + basics + RPCs + timezone | L | 0 | ship in 2–3 PRs (tracker fixes → RPC/schema → UI) |
| 2 attribution | M | 1 | 1–2 PRs |
| 3 behaviour events + filter bar | L | 1 | 2–3 PRs |
| 4 goals + funnels | L | 1, 3 | 2 PRs |
| 5 deep analytics | XL | 1–4 | split by feature: paths/retention, vitals/errors, real-time, alerts/reports |
| 6 replay/heatmaps/A-B | XL | 0.4, 3 | only if approved after consent design |

Each phase ends with: migration applied and verified, tests green, Zhenghe data
reconciled, PDF export updated to include the new sections, and this document's
checklist ticked.

## Risks
- **Adoption lag:** clients on old trackers won't produce new data. Mitigation:
  version banner, one-click "re-push integration" from the Analytics page.
- **Data volume/cost:** raw events grow quickly. Mitigation: RPC aggregation,
  retention cron, sampling for high-volume event types (vitals, mouse moves).
- **Definition drift** (engaged session, bounce, conversion): all in
  `metrics.ts` with tests and a "How we calculate this" drawer in the UI.
- **Privacy exposure** (Phase 6, city-level geo, custom properties): strict
  allow-lists, masking, retention, consent hook, erasure endpoint.
- **UTC vs local time:** solved in Phase 1 via per-client timezone; migrate
  `analytics_daily` semantics accordingly or drop it in favour of RPCs.

## Open questions for the owner
1. Should Phase 6 (replay/heatmaps) be built, and which clients need consent banners?
2. Is `Asia/Singapore` the right default timezone for all current clients?
3. Are client-facing share links / scheduled email reports wanted, and who may
   receive them?
4. Retention: is 400 days of raw events acceptable?
5. Should city-level geography be collected, or country/region only?
