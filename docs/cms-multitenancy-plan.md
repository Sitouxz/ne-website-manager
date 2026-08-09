# Multi-Tenancy Migration Plan

**Goal:** one CMS serving every NE custom website project, where onboarding a new
client is configuration rather than code.

**Thesis:** the platform already contains the correct abstraction — `collections`
with per-client `fields` schemas — but it loses to bespoke native tables every
time, because the generic path can't express what a real client needs. Every time
it loses, a client's domain model gets welded into the platform's own schema and
UI. `properties` (30 columns, one client) and `KAMAL_KARIM_SLUG` in
`src/components/Sidebar.tsx` are the two visible scars. The fix is to make the
generic path strong enough to win, then remove the bespoke one.

**Approach chosen:** Path A — everything client-specific becomes a collection.
`posts` and `pages` stay native (universal to every site); `properties` migrates
out. Rejected Path B (a `content_types` registry over native tables) because it
still requires a migration per client type — a slower version of the same trap.

---

## Where we are

Three clients on the platform today (al-islah, kamal-karim, zhenghelogistics).
The cost of client #4 is currently: migration + table + list page + editor page +
API route + SDK codegen branch + sidebar entry + hardcoded slug guard.

What already works and must not be disturbed:

- Tenant isolation via `client_id` + RLS on every table, actively hardened
  (migrations 014, 015, 016, 019, 021).
- Revision snapshots + restore, HMAC-signed revalidation with a delivery log
  and bounded timeouts (`src/lib/publish.ts`).
- SDK v1/v2 generation with a byte-for-byte v1 compatibility guarantee
  (`src/lib/sdk/generate.ts`) — this is the mechanism that makes a properties
  cutover survivable.
- 410 tests across 32 files, `tsc --noEmit` clean.

---

## Stage 0 — Freeze (do this today, costs nothing)

Policy, not code:

1. **No new native tables.** `collections.native_table` stays at its current
   three values. A new client type is a collection or it doesn't ship.
2. **No new per-client slug constants.** `KAMAL_KARIM_SLUG` is the last one.
3. Record both in `AGENTS.md` so the constraint survives context resets.

If a client need can't be met by a collection, that's a Stage 1 backlog item, not
a new table.

---

## Stage 1 — Grow the field system

This is the load-bearing stage. Everything downstream is blocked on it.

### Gap analysis: `properties` columns vs. what collections can express

| properties column(s) | Collections equivalent | Status |
| --- | --- | --- |
| `name`, `address`, `area`, `district`, `property_type`, `tenure`, `furnishing`, `available`, `tagline` | `text` | OK |
| `listing`, `segment` (TEXT + CHECK) | `select` + `options` | OK |
| `bedrooms`, `bathrooms`, `completion_year` | `number` | OK |
| `price`, `psf`, `size_sqft` | `number` | Weak — no precision, currency, or display format config |
| `story`, `location_note` | `textarea` / `richtext` | OK |
| `hero_url` + `hero_alt` | `image` (`{url, alt}`) | OK |
| `gallery` JSONB `[{url, alt}]` | `gallery` (`ImageValue[]`) | OK |
| `source_url` | `url` | OK |
| `slug`, `status` | `collection_items.slug` / `.status` | OK (see note below) |
| `connectivity`, `amenities` (TEXT[]) | — | **Blocker: no free-form tag list.** `multiselect` requires fixed `options` |
| `highlights` JSONB `[{label, description}]` | — | **Blocker: no repeater / object list** |
| `tour` JSONB | `json` | Degrades to a raw JSON textarea — unacceptable for a client user |
| `seo_title`, `seo_description` | — | Convention undefined for entries (see below) |

### Work

1. **`taglist` field type.** Free-form string array. Unblocks
   `connectivity`/`amenities` and the general "list of short strings" need every
   client has. Smallest of the three, do it first as the pattern-setter.

2. **`repeater` field type.** An ordered list of sub-objects, where the sub-shape
   is itself a `FieldDef[]`. Unblocks `highlights`, `tour`, and — critically —
   **page sections**, which is the other half of the "too flat" problem. Requires:
   - `FieldDef` gains `fields?: FieldDef[]` for the sub-schema.
   - `validateFieldDefs` recurses (guard against unbounded nesting — cap at 2
     levels; deeper is a modelling smell).
   - `validateEntry` recurses per row.
   - `FieldInput` renders add/remove/reorder. Reuse the existing repeater UI
     already hand-rolled in `src/app/(app)/cms/properties/[id]/page.tsx` for
     highlights and gallery — that code is the working prototype, it just needs
     generalising.

3. **`reference` field type.** Points at another entry, post, page, or media row.
   This is what makes the model stop being a set of islands, and it's the
   prerequisite for any "where is this used" / integrity checking later. Store as
   `{ entityType, id }`. Needs a picker in `FieldInput` and resolution in the
   public API routes (decide: return the ID, or inline the referenced entry to a
   depth of 1 — inlining is friendlier to client sites but changes the SDK
   response shape, so it needs a v2 opt-in).

4. **`number` gains format config** — `{ precision?, prefix?, suffix? }` on
   `FieldDef`. Cheap, and without it every price field renders as a bare integer.

5. **Define the SEO convention for entries.** `collection_items` has no SEO
   columns; per-entry SEO would live as ordinary fields in `data`. Decide on
   reserved keys (`seo_title` / `seo_description`) and teach the SEO Manager and
   sitemap builder to read them. Confirm current behaviour in
   `src/app/api/client/[slug]/seo/route.ts` before writing anything.

6. **Note on `status` semantics.** `properties.status` is `active|archived`;
   `collection_items.status` is `draft|published|archived`. Migrated properties
   map `active → published`. Flag this in the migration script — it means
   properties gain a draft state they never had, which is an improvement but
   changes what the live site sees if any row is left unpublished.

**Exit criteria:** a collection schema can express every `properties` column
without falling back to `json`.

---

## Stage 2 — Collection UX parity

A generic editor that's worse than the bespoke one guarantees the bespoke one
survives. Right now `properties/[id]/page.tsx` is 627 lines of tailored UI versus
a 640-line generic entry editor that renders a flat field list.

1. **Per-collection list views.** `CollectionOptions` currently holds only
   `title_field`. Add `list_columns?: string[]`, `list_filters?: string[]`,
   `sort_default?`. Without this, a 200-property collection is an unusable flat
   list where `properties/page.tsx` has real filters.
2. **Field grouping in the editor.** `FieldDef` gains `group?: string`; the entry
   editor renders grouped panels instead of one long column. This is what makes
   the generic editor feel designed rather than generated.
3. **Preview + live-path for entries.** Entry editors get the Preview button that
   only posts have today (`preview/route.ts` already supports all three types).

**Exit criteria:** side-by-side, an editor prefers the generic properties
collection to the bespoke page. Test this with a real user before Stage 4.

---

## Stage 3 — Per-client configuration in the database

Kills `KAMAL_KARIM_SLUG` and makes the sidebar data-driven.

1. New table `client_features` (or revive the dead `clients.plan`): which nav
   sections and tools a client sees.
2. `Sidebar.tsx` renders from `collections` rows + `client_features`, not the
   static `NAV` const. `hideForClientSlugs` and the slug constant are deleted.
3. Admin UI to toggle features per client.

Independent of Stages 1–2 — can run in parallel if there's capacity.

---

## Stage 4 — Migrate properties

Only after Stages 1–2 are done and validated.

1. **Seed** a `properties` collection (`storage='generic'`) for kamal-karim with
   the field schema built in Stage 1. Do not touch the native table.
2. **Backfill** rows into `collection_items.data` with a reversible script.
   Dry-run mode mandatory (`scripts/seed-client.mjs` has the pattern).
3. **Dual-read period.** The public API serves properties from the native table
   while the CMS writes to both. Compare outputs; do not proceed until they match
   for every row.
4. **Cut the site over** via SDK v2 — the v1 byte-for-byte guarantee means the
   live Kamal Karim site keeps working untouched until it opts in.
5. **Retire** `properties`: drop the nav entry, the two bespoke pages, and
   `native_table`'s third enum value. Keep the table itself for one release as a
   rollback path, then drop it in a later migration.

**Rollback:** at every step before 5, reverting is "stop writing to
`collection_items`." That property is the reason for the dual-read period.

---

## Stage 5 — Onboarding templates

The payoff. A client template seeds collections + globals + nav + a starter SDK
config in one action.

- Templates as `client_id IS NULL` global collection rows — the schema already
  supports this (`collections_global_read`), and it's currently unused.
- Extend the admin create-client flow to take a template.
- Target: new client onboarded end-to-end without opening the repo.

---

## Cross-cutting: fix publish integrity before N grows

These are existing bugs that are annoying at 3 clients and invisible at 20. They
should land before Stage 4, independent of everything above.

1. **Unpublish/archive never notifies the live site.** `firePublishNotify` is
   gated on `status === 'published'` in all three editors — leaving published
   fires nothing, so the live site serves unpublished content indefinitely.
2. **Delete never notifies.** `content.deleted` exists in the type union and the
   API route accepts it, but only `navigation/page.tsx` ever fires it.
3. **No reference check before deleting media** — and once `reference` fields
   exist (Stage 1), there is finally a real answer to "what uses this."
4. **Nothing alerts on `webhook_deliveries` failures.** Rows are recorded
   faithfully and read by nobody. At 20 clients, a silently stale site is found
   by the client.
5. `published_at` resets on every Update; page `path` is unvalidated free text.

---

## Sequencing

```
Stage 0  Freeze                    ── immediate, policy only
Stage 1  Field system              ── blocks everything below
Stage 2  Collection UX parity      ── blocks Stage 4
Stage 3  Per-client config         ── parallel, independent
         Publish integrity fixes   ── parallel, before Stage 4
Stage 4  Migrate properties        ── the irreversible one
Stage 5  Onboarding templates      ── the payoff
```

---

## Decisions needed before Stage 1 starts

1. **Reference resolution:** return IDs, or inline referenced entries to depth 1?
   Inlining is friendlier to client sites but changes the SDK response shape and
   needs a v2 opt-in.
2. **Repeater nesting depth:** cap at 2 levels, or allow arbitrary nesting?
   Recommend 2 — deeper is usually a missing collection.
3. **Page sections:** are page sections a `repeater` field on pages (reuses Stage
   1 wholesale), or a separate block model? Recommend the repeater — it's one
   system to build and maintain, and pages become just another schema.
4. **Kamal Karim cutover appetite:** is the live site available for a v2 SDK
   upgrade during Stage 4, or does it need to stay on v1 indefinitely? This
   determines whether `properties` can actually be retired or just deprecated.
