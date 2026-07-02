# NE Website Manager — Professional CMS Upgrade Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Scope note:** This is a master plan covering 8 phases. Each phase is independently shippable. Phases 2–8 should each be expanded into their own detailed TDD plan (`docs/superpowers/plans/YYYY-MM-DD-phase-N-<name>.md`) before execution, using the schemas, contracts, and file maps locked in here.

**Goal:** Upgrade NE Website Manager from a basic multi-tenant content tool into a full professional headless CMS that powers every Neu Entity–built client website, with a complete dashboard (media, rich editing, revisions, scheduling, dynamic collections, forms, SEO, team, publishing pipeline).

**Architecture:** Headless CMS. This app is the single dashboard + API; client websites are separate Next.js repos built by Neu Entity that consume content via the per-client public API and generated `lib/cms.ts` SDK. Supabase is the source of truth (Postgres + RLS + Auth + Storage). Because NE controls both sides, the contract is: CMS stores structured content → SDK fetches it typed → client site renders it however NE designs it. Customization lives in the client repo; content structure lives in the CMS via dynamic collections.

**Tech Stack:** Next.js 16.2.7 (App Router, `proxy.ts` middleware convention, `params` as Promise), React 19, Supabase (`@supabase/ssr`), Tailwind 4, shadcn/base-ui components, Tiptap (new — rich text), Vitest (new — tests), Recharts (analytics), Vercel cron (scheduling).

## Global Constraints

- Next.js is **16.2.7** — conventions differ from older training data. Read `node_modules/next/dist/docs/01-app` before writing route/page code. Route handler `params` is a `Promise` and must be awaited. Middleware lives at `src/proxy.ts` exporting `proxy()`, not `middleware.ts`.
- Every table gets RLS. Pattern already established: `client_id = my_client_id() OR is_ne_admin()` for authenticated, explicit narrow policies for public/anon reads.
- All new migrations are additive files `supabase/migrations/00N_*.sql`. Never edit `001` / `002` (already applied in production).
- All public client-facing API routes live under `src/app/api/client/[slug]/...` and must send CORS headers (`Access-Control-Allow-Origin: *`) + an `OPTIONS` handler (see `sdk/route.ts` for the pattern).
- Multi-tenancy invariant: every content row carries `client_id`; every dashboard query filters by the selected client (cookie `ne_selected_client_id` for ne_admin, `profiles.client_id` otherwise).
- Roles: `ne_admin` (Neu Entity staff, all clients), `client_admin` (manage one client incl. team), `editor` (content only). Keep this enum; extend permissions, not roles.
- UI: match existing style — shadcn components in `src/components/ui/`, CSS variables (`var(--fg1)`, `var(--surface-2)`, `var(--ne-blue)`), Sidebar/AppShell layout. No new UI framework.
- Backwards compatibility: `al-islah` and Kamal Karim (properties) sites are live. Existing endpoints (`/posts`, `/pages`, `/properties`, `/analytics`, `/sdk`) must not change response shape; add fields/params only.
- Commit per completed task using conventional commits (`feat:`, `fix:`, `chore:`).

---

## Current State (audit summary, 2026-07-02)

**Have:** clients / profiles / posts / pages / media (table only) / analytics_events / properties tables with RLS; login + role-aware shell; dashboard stats; posts CRUD editor (plain textarea); pages list (no editor); properties full editor; analytics page; admin client list + create-client; public JSON API per client slug; SDK generator + GitHub PR push (`push-integration`); deploy_hook column (unused).

**Gaps this plan closes:** media library UI + storage, rich text editing, revisions/autosave, scheduled publishing, draft preview, pages editor, dynamic collections (generalize the hardcoded properties pattern), site globals (nav/footer/theme/announcements), forms & leads, SEO manager (redirects, sitemap, meta audit), team invitations + permissions, publish webhooks + deploy triggers, API keys + pagination, activity log, analytics aggregation, and a test suite (currently zero tests).

---

## Phase 1 — Foundations (test infra, audit log, API hardening)

Everything later builds on this. Ship first.

### Task 1.1: Vitest test infrastructure

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/supabase-mock.ts` (chainable query-builder mock)
- Modify: `package.json` (add `"test": "vitest run"`, `"test:watch": "vitest"`; devDeps `vitest`, `@vitejs/plugin-react`, `@testing-library/react`, `jsdom`)

**Interfaces:**
- Produces: `mockSupabase(fixtures: Record<string, unknown[]>): SupabaseClient`-shaped mock where `.from('posts').select().eq(...)` resolves to fixture rows; used by every route-handler test in later phases.

- [ ] Install deps, write `vitest.config.ts` with `environment: 'jsdom'`, path alias `@/` → `src/`
- [ ] Write `src/test/supabase-mock.ts` + a smoke test `src/test/supabase-mock.test.ts` proving `.from().select().eq().single()` resolves fixtures
- [ ] Run `npm test` — passes
- [ ] Commit `chore: add vitest test infrastructure`

### Task 1.2: Activity log (audit trail)

**Files:**
- Create: `supabase/migrations/003_activity_log.sql`
- Create: `src/lib/activity.ts`
- Test: `src/lib/activity.test.ts`

**Interfaces:**
- Produces: `logActivity(supabase, { clientId, actorId, action, entityType, entityId, summary, meta? })` — fire-and-forget insert; every later mutation route calls this.

```sql
-- 003_activity_log.sql
CREATE TABLE IF NOT EXISTS public.activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  actor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,              -- 'created' | 'updated' | 'published' | 'archived' | 'deleted' | 'invited' | ...
  entity_type TEXT NOT NULL,              -- 'post' | 'page' | 'property' | 'media' | 'collection_entry' | 'form' | 'member' | 'settings'
  entity_id   UUID,
  summary     TEXT NOT NULL DEFAULT '',   -- human line: 'Published "Ramadan Schedule 2026"'
  meta        JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_log_client_created_idx ON public.activity_log (client_id, created_at DESC);
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_select" ON public.activity_log FOR SELECT USING (client_id = my_client_id() OR is_ne_admin());
CREATE POLICY "activity_insert" ON public.activity_log FOR INSERT WITH CHECK (client_id = my_client_id() OR is_ne_admin());
```

- [ ] Write migration, apply to Supabase
- [ ] TDD `logActivity` helper (never throws; swallows insert errors)
- [ ] Wire into existing mutation points: post save/publish, property save, client create
- [ ] Commit `feat: add activity log`

### Task 1.3: Public API hardening — pagination + API keys

**Files:**
- Create: `supabase/migrations/004_api_keys.sql` (`api_keys`: id, client_id, name, key_hash TEXT, prefix TEXT, scopes TEXT[] DEFAULT '{read}', last_used_at, revoked_at; RLS admin-only; SHA-256 hash stored, plaintext shown once)
- Create: `src/lib/api/auth.ts` — `resolveApiAccess(req, clientSlug)` returns `{ level: 'public' | 'keyed', clientId }`; key sent as `Authorization: Bearer ne_<prefix>_<secret>`
- Create: `src/lib/api/pagination.ts` — `parsePagination(url, { defaultLimit: 50, maxLimit: 100 })` → `{ limit, offset }`; responses gain `X-Total-Count` header
- Modify: `src/app/api/client/[slug]/posts/route.ts`, `pages/route.ts`, `properties/route.ts` — accept `limit`/`offset`, keep default response shape identical
- Test: `src/lib/api/pagination.test.ts`, `src/lib/api/auth.test.ts`

**Interfaces:**
- Produces: `resolveApiAccess`, `parsePagination` — used by every public route in Phases 4–7. Keyed access unlocks `status=draft` reads (preview) in Phase 3.

- [ ] TDD pagination parser (clamps, defaults, rejects negatives)
- [ ] Migration + TDD key verification (hash compare, revoked check)
- [ ] Apply to three existing list routes; verify existing client sites unaffected (no params → same output)
- [ ] Settings page: "API Keys" card — generate/revoke (ne_admin + client_admin)
- [ ] Commit `feat: API pagination and per-client API keys`

---

## Phase 2 — Media Library

Unblocks rich editing (Phase 3) and collections (Phase 4). Media table already exists in 001 — needs storage + UI.

### Task 2.1: Supabase Storage bucket + upload API

**Files:**
- Create: `supabase/migrations/005_media_storage.sql` — create bucket `media` (public read); storage RLS: authenticated insert/delete restricted to path prefix `{their client_id}/…` or ne_admin
- Create: `src/app/api/media/route.ts` — `POST` multipart upload (validates mime allowlist: image/*, video/mp4, application/pdf; max 25 MB), stores at `media/{client_id}/{yyyy}/{uuid}-{sanitized-filename}`, inserts `media` row, returns row. `GET` lists media for selected client with pagination + `?type=image` filter. `DELETE ?id=` removes storage object + row.
- Test: `src/app/api/media/route.test.ts`

**Interfaces:**
- Produces: `MediaItem` = existing `media` row shape (`id, client_id, url, filename, mime_type, size_bytes, alt, created_at`). `POST /api/media` (dashboard-auth, multipart field `file`, optional `alt`) → `MediaItem`.

- [ ] Migration (bucket + storage policies), apply
- [ ] TDD route: rejects bad mime, rejects >25 MB, path contains client_id, inserts row
- [ ] Commit `feat: media storage bucket and upload API`

### Task 2.2: Media Library page + MediaPicker component

**Files:**
- Create: `src/app/(app)/cms/media/page.tsx` — grid view, drag-drop upload zone, search by filename, edit alt text inline, delete with confirm, copy URL
- Create: `src/components/MediaPicker.tsx` — `Dialog` wrapping the same grid; props `{ open, onOpenChange, onSelect: (item: MediaItem) => void, accept?: 'image' | 'all' }`
- Modify: `src/components/Sidebar.tsx` — remove `soon: true` from Media Library
- Modify: `src/app/(app)/cms/posts/[id]/page.tsx` and `src/app/(app)/cms/properties/[id]/page.tsx` — replace raw URL inputs for cover/hero/gallery with MediaPicker

**Interfaces:**
- Produces: `<MediaPicker onSelect={...} accept="image" />` — consumed by post editor, property editor, Tiptap image button (Phase 3), collections editor (Phase 4), globals editor (Phase 5).

- [ ] Build page with upload → optimistic grid insert; verify in browser preview
- [ ] Build MediaPicker; wire into post cover + property hero/gallery
- [ ] Remove sidebar `soon` badge
- [ ] Commit `feat: media library and picker`

---

## Phase 3 — Editorial Core (rich editor, revisions, autosave, scheduling, preview, pages editor)

The biggest UX jump: textarea → professional editor.

### Task 3.1: Content schema upgrade

**Files:**
- Create: `supabase/migrations/006_editorial.sql`

```sql
-- 006_editorial.sql
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS content_json JSONB;          -- Tiptap doc; `content` keeps rendered HTML
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;    -- publish at
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS content_json JSONB;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS seo_title TEXT;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check CHECK (status IN ('draft','in_review','scheduled','published','archived'));

CREATE TABLE IF NOT EXISTS public.revisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  entity_type TEXT NOT NULL,               -- 'post' | 'page' | 'property' | 'collection_entry'
  entity_id   UUID NOT NULL,
  snapshot    JSONB NOT NULL,              -- full row at save time
  author_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revisions_entity_idx ON public.revisions (entity_type, entity_id, created_at DESC);
ALTER TABLE public.revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revisions_all" ON public.revisions FOR ALL USING (client_id = my_client_id() OR is_ne_admin());

CREATE TABLE IF NOT EXISTS public.preview_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.preview_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preview_tokens_all" ON public.preview_tokens FOR ALL USING (client_id = my_client_id() OR is_ne_admin());
```

- [ ] Apply migration; update `src/lib/supabase/types.ts` (`PostStatus` gains `'in_review' | 'scheduled'`; add `Revision`, `PreviewToken`)
- [ ] Commit `feat: editorial schema (revisions, scheduling, preview tokens)`

### Task 3.2: Tiptap rich text editor component

**Files:**
- Create: `src/components/editor/RichTextEditor.tsx` — props `{ valueJson: object | null, fallbackHtml: string, onChange: (json: object, html: string) => void }`; extensions: StarterKit, Link, Image (insert via MediaPicker), Placeholder, heading levels 2–4, blockquote, code block, bullet/ordered list, horizontal rule; sticky toolbar styled with existing CSS vars
- Create: `src/components/editor/EditorToolbar.tsx`
- Deps: `@tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image @tiptap/extension-placeholder`
- Test: `src/components/editor/RichTextEditor.test.tsx` (renders fallback HTML, emits JSON+HTML on edit)

**Interfaces:**
- Produces: `<RichTextEditor valueJson onChange />` — consumed by post editor, page editor, collections rich-text field type (Phase 4).

- [ ] Install Tiptap, TDD component
- [ ] Commit `feat: Tiptap rich text editor component`

### Task 3.3: Rebuild post editor (autosave, revisions, schedule, preview)

**Files:**
- Modify: `src/app/(app)/cms/posts/[id]/page.tsx` — replace textarea with RichTextEditor; autosave (debounced 2s, writes draft + revision snapshot max every 60s); status control: Draft / In review / Schedule (datetime picker → `scheduled_at`, status `scheduled`) / Publish now; "Preview" button mints preview token and opens `{client.website_url}/api/preview?token=…` (client-site side implemented in Phase 7 SDK); revision history sheet (list snapshots, one-click restore)
- Create: `src/app/api/cms/revisions/route.ts` — `GET ?entity_type&entity_id` list, `POST` restore
- Modify: `src/app/(app)/cms/posts/new/page.tsx` — create then redirect to editor (thin)

- [ ] Autosave + revisions working (verify in preview browser)
- [ ] Status/schedule/publish flows write `published_at` / `scheduled_at` correctly + activity log
- [ ] Commit `feat: professional post editor with autosave, revisions, scheduling`

### Task 3.4: Scheduled publish cron

**Files:**
- Create: `src/app/api/cron/publish-scheduled/route.ts` — `GET` guarded by `Authorization: Bearer ${process.env.CRON_SECRET}`; uses `src/lib/supabase/admin.ts` service client: `UPDATE posts SET status='published', published_at=now() WHERE status='scheduled' AND scheduled_at <= now()`; fires publish webhooks (Phase 7 — until then just logs activity)
- Create: `vercel.json` cron entry `{ "path": "/api/cron/publish-scheduled", "schedule": "*/5 * * * *" }` (or `vercel.ts` per current Vercel guidance)
- Test: `src/app/api/cron/publish-scheduled/route.test.ts`

- [ ] TDD: rejects wrong secret; publishes only due rows
- [ ] Commit `feat: scheduled publishing cron`

### Task 3.5: Pages editor

**Files:**
- Create: `src/app/(app)/cms/pages/[id]/page.tsx` — same editor chrome as posts (RichTextEditor, SEO fields, status, revisions)
- Modify: `src/app/(app)/cms/pages/page.tsx` — link rows to editor, add "New Page" (title + path)

- [ ] Build, verify, commit `feat: pages editor`

---

## Phase 4 — Dynamic Collections (the customization engine)

This is what makes the CMS fit *any* NE-built site. `properties` proved the pattern (real-estate vertical hardcoded as a table + editor + API). Collections generalize it: NE defines a content type per client in the dashboard; entry editor and public API are generated from the field schema. **Properties stays as-is** (live site) — new verticals use collections.

### Task 4.1: Schema

**Files:**
- Create: `supabase/migrations/007_collections.sql`

```sql
-- 007_collections.sql
CREATE TABLE IF NOT EXISTS public.collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,                 -- 'Sermons', 'Menu Items', 'Team'
  slug        TEXT NOT NULL,                 -- 'sermons'
  icon        TEXT DEFAULT 'database',       -- lucide icon name for sidebar
  fields      JSONB NOT NULL DEFAULT '[]',   -- ordered field definitions, see FieldDef below
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, slug)
);
CREATE TABLE IF NOT EXISTS public.collection_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID REFERENCES public.collections(id) ON DELETE CASCADE NOT NULL,
  client_id     UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  slug          TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',    -- denormalized display field
  data          JSONB NOT NULL DEFAULT '{}', -- keyed by field key
  status        TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  sort_order    INTEGER DEFAULT 0,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(collection_id, slug)
);
CREATE INDEX IF NOT EXISTS collection_entries_lookup_idx ON public.collection_entries (collection_id, status, sort_order);
CREATE OR REPLACE TRIGGER collections_updated_at BEFORE UPDATE ON public.collections FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE OR REPLACE TRIGGER collection_entries_updated_at BEFORE UPDATE ON public.collection_entries FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collections_auth" ON public.collections FOR ALL USING (client_id = my_client_id() OR is_ne_admin());
CREATE POLICY "collections_public_read" ON public.collections FOR SELECT USING (true);
CREATE POLICY "entries_auth" ON public.collection_entries FOR ALL USING (client_id = my_client_id() OR is_ne_admin());
CREATE POLICY "entries_public_read" ON public.collection_entries FOR SELECT USING (status = 'published');
```

**Interfaces (locked for all of Phase 4 + SDK):**

```ts
// src/lib/collections/types.ts
export type FieldType =
  | 'text' | 'textarea' | 'richtext' | 'number' | 'boolean'
  | 'date' | 'select' | 'multiselect' | 'image' | 'gallery'
  | 'url' | 'email' | 'json';

export interface FieldDef {
  key: string;             // snake_case, unique within collection
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];      // select / multiselect
  help?: string;
}
```

- [ ] Migration + types; commit `feat: collections schema`

### Task 4.2: Validation + collection admin UI (ne_admin builds schemas)

**Files:**
- Create: `src/lib/collections/validate.ts` — `validateEntry(fields: FieldDef[], data: Record<string, unknown>)` → `{ ok: true } | { ok: false, errors: Record<string, string> }`; also `validateFieldDefs(fields)` (unique keys, snake_case, options present for selects)
- Test: `src/lib/collections/validate.test.ts` (TDD — this is core logic)
- Create: `src/app/(app)/cms/collections/page.tsx` — list collections for selected client + "New Collection" (ne_admin only)
- Create: `src/app/(app)/cms/collections/[id]/schema/page.tsx` — field builder: add/remove/reorder fields, type picker, options editor

- [ ] TDD both validators exhaustively (each field type, required, bad key)
- [ ] Build schema builder UI
- [ ] Commit `feat: collection schema builder`

### Task 4.3: Generic entry editor + list

**Files:**
- Create: `src/app/(app)/cms/collections/[id]/page.tsx` — entries table (title, slug, status, updated), drag sort → `sort_order`
- Create: `src/app/(app)/cms/collections/[id]/entries/[entryId]/page.tsx` — renders form from `FieldDef[]`: text→Input, richtext→RichTextEditor, image→MediaPicker, gallery→multi MediaPicker, select→Select, etc.; validates via `validateEntry` before save; revisions + activity log like posts
- Create: `src/components/collections/FieldInput.tsx` — `{ def: FieldDef, value: unknown, onChange: (v: unknown) => void }` switch component
- Modify: `src/components/Sidebar.tsx` — under Content, render client's collections dynamically (fetch in `AppShell`/layout, pass down)

- [ ] Build FieldInput (unit test the switch renders right control per type)
- [ ] Entry editor + list wired end-to-end
- [ ] Commit `feat: dynamic collection entries editor`

### Task 4.4: Public collections API

**Files:**
- Create: `src/app/api/client/[slug]/collections/[collection]/route.ts` — `GET` published entries `{ id, slug, title, data, published_at, updated_at }[]`, pagination from Task 1.3, `?sort=sort_order|published_at`; CORS + OPTIONS
- Create: `src/app/api/client/[slug]/collections/[collection]/[entrySlug]/route.ts` — single entry; drafts visible only with valid API key (Task 1.3) or preview token
- Test: both routes

- [ ] TDD: published only for anon; keyed access sees drafts; 404 unknown collection
- [ ] Commit `feat: public collections API`

---

## Phase 5 — Site Control (globals, announcements, forms & leads, SEO manager)

Turns the CMS from "content" into "run the whole site."

### Task 5.1: Site globals

**Files:**
- Create: `supabase/migrations/008_site_globals.sql` — `site_globals` (id, client_id, key TEXT, value JSONB, updated_at, UNIQUE(client_id, key)); RLS auth-write/public-read. Reserved keys: `navigation` (`{ items: { label, href, children? }[] }`), `footer`, `announcement` (`{ enabled, message, href?, variant, starts_at?, ends_at? }`), `theme` (`{ tokens: Record<string,string> }`), `social`, `contact`
- Create: `src/app/(app)/settings/globals/page.tsx` — structured editors: navigation tree editor, footer editor, theme token key/value list
- Create: `src/app/(app)/announcements/page.tsx` — announcement banner form (remove sidebar `soon`)
- Create: `src/app/api/client/[slug]/globals/route.ts` — `GET` all globals as `{ [key]: value }`; CORS
- Test: globals route

- [ ] Migration, route TDD, editors, sidebar update
- [ ] Commit `feat: site globals (navigation, footer, theme, announcements)`

### Task 5.2: Forms & Leads

**Files:**
- Create: `supabase/migrations/009_forms.sql` — `forms` (id, client_id, name, slug, fields JSONB /* reuse FieldDef */, notify_emails TEXT[], honeypot_field TEXT DEFAULT 'website', UNIQUE(client_id, slug)); `form_submissions` (id, form_id, client_id, data JSONB, status TEXT DEFAULT 'new' CHECK (status IN ('new','read','archived','spam')), referrer TEXT, created_at); RLS: forms public-read, submissions auth-read/public-insert-via-route-only (insert through service client, not anon RLS)
- Create: `src/app/api/client/[slug]/forms/[formSlug]/route.ts` — `POST` submission: honeypot check (filled honeypot → 200 but status `spam`), per-IP rate limit 10/min (in-memory Map keyed by IP+form, good enough on Fluid Compute), `validateEntry` against form fields, insert via admin client; CORS
- Create: `src/app/(app)/forms/page.tsx` — forms list + builder (reuse `FieldInput` schema builder pieces) ; `src/app/(app)/forms/[id]/page.tsx` — submissions inbox (new/read/archive, CSV export)
- Modify: `src/components/Sidebar.tsx` — remove `soon` from Forms & Leads
- Test: submission route (honeypot, validation, rate limit)

- [ ] Migration, TDD submission route, builder + inbox UI
- [ ] Commit `feat: forms and leads`

### Task 5.3: SEO Manager

**Files:**
- Create: `supabase/migrations/010_seo.sql` — `redirects` (id, client_id, from_path, to_path, permanent BOOLEAN DEFAULT true, UNIQUE(client_id, from_path)); RLS auth-write/public-read
- Create: `src/app/api/client/[slug]/seo/route.ts` — `GET` → `{ redirects: [...], sitemap: [{ path, updated_at }] }` (sitemap = published pages + posts `/blog/{slug}` + collection entries; path templates configurable later — YAGNI)
- Create: `src/app/(app)/seo/page.tsx` — redirects table CRUD + content SEO audit list (all published posts/pages flagging missing `seo_title`/`seo_description`, links to editor)
- Modify: `src/components/Sidebar.tsx` — remove `soon` from SEO Manager
- Test: seo route

- [ ] Migration, TDD route, UI, sidebar
- [ ] Commit `feat: SEO manager (redirects, sitemap feed, meta audit)`

---

## Phase 6 — Team & Workflow

### Task 6.1: Invitations + team page

**Files:**
- Create: `supabase/migrations/011_team.sql` — `invitations` (id, client_id, email, role CHECK (role IN ('client_admin','editor')), invited_by, token TEXT UNIQUE, expires_at, accepted_at); RLS: client_admin/ne_admin of that client. Add RLS so client_admin can update profiles of same client: `CREATE POLICY "profiles_client_admin_manage" ON public.profiles FOR UPDATE USING (client_id = my_client_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'client_admin'));`
- Create: `src/app/api/team/invite/route.ts` — POST: create invitation + `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: '/accept-invite?token=…' })` via service client; on accept, set profile `client_id` + `role`
- Create: `src/app/(auth)/accept-invite/page.tsx` — set password, consume token
- Create: `src/app/(app)/team/page.tsx` — members list (name, role, last sign-in), invite dialog, change role, remove (clears client_id); editors can't see it, sidebar gates by role
- Modify: `src/components/Sidebar.tsx` — remove `soon` from Team Members; hide for `editor`
- Test: invite route (role restriction: editor cannot invite; client_admin cannot invite ne_admin)

- [ ] Migration, TDD invite route, accept flow, team UI
- [ ] Commit `feat: team invitations and management`

### Task 6.2: Review workflow

**Files:**
- Modify: post/page/entry editors — `editor` role can set Draft/In review only; Publish button gated to `client_admin`/`ne_admin`; "Submit for review" action
- Create: `src/components/dashboard/ReviewQueue.tsx` on dashboard — items with status `in_review` for admins
- Modify: `src/app/(app)/dashboard/page.tsx` — add ReviewQueue + recent activity feed (reads `activity_log`)

- [ ] Role-gate publish server-side too (check in save route/action, not just UI)
- [ ] Commit `feat: editorial review workflow`

---

## Phase 7 — Publishing Pipeline & SDK v2

Ties CMS actions to live client sites. NE controls the client repos, so the contract can be exact.

### Task 7.1: Publish webhooks + deploy triggers

**Files:**
- Create: `supabase/migrations/012_webhooks.sql` — `webhook_deliveries` (id, client_id, url, event TEXT, payload JSONB, status_code INT, ok BOOLEAN, created_at). Add `clients.revalidate_url TEXT`, `clients.revalidate_secret TEXT`
- Create: `src/lib/publish.ts` — `notifyPublish(client, { event: 'content.published' | 'content.updated' | 'content.deleted', entityType, entityId, slug })`: (1) POST `revalidate_url` with HMAC-SHA256 signature header `x-ne-signature` over body using `revalidate_secret`; (2) if `deploy_hook` set, POST it (static rebuild); log delivery row. Fire-and-forget with 5s timeout.
- Modify: publish points (post editor save-publish, cron, entry editor, globals save) → call `notifyPublish`
- Modify: `src/app/(app)/settings/page.tsx` — Publishing card: revalidate URL/secret, deploy hook, delivery log (last 20)
- Test: `src/lib/publish.test.ts` (signature correctness, timeout swallow)

- [ ] TDD signature; wire all publish points
- [ ] Commit `feat: publish webhooks and deploy triggers`

### Task 7.2: SDK v2 generator

**Files:**
- Create: `src/lib/sdk/generate.ts` — single source generating `lib/cms.ts` (today it's duplicated in `sdk/route.ts` and `push-integration/route.ts` — DRY them onto this)
- Modify: `src/app/api/client/[slug]/sdk/route.ts` and `src/app/api/admin/push-integration/route.ts` to use it
- v2 additions (generated per client, typed from their actual collections):
  - `getCollection<T>(slug, params?)` / `getEntry<T>(collection, slug)` — plus named helpers per collection (`getSermons()`) with interfaces generated from `FieldDef[]`
  - `getGlobals()`, `getNavigation()`, `getAnnouncement()`
  - `submitForm(formSlug, data)`
  - `getRedirects()` + ready-made `proxy.ts` snippet for client repos
  - `createPreviewHandler(secret)` — route handler for `/api/preview?token=` enabling Next draft mode and fetching draft content with the preview token
  - `createRevalidateHandler(secret)` — route handler verifying `x-ne-signature`, calling `revalidatePath`/`revalidateTag`
- Test: `src/lib/sdk/generate.test.ts` — generated code contains per-collection types; snapshot test

- [ ] Extract + dedupe generator (v1 output byte-identical first — test that), then add v2 (`?v=2`)
- [ ] Update push-integration PR body with v2 usage docs
- [ ] Commit `feat: SDK v2 (collections, globals, forms, preview, revalidation)`

---

## Phase 8 — Analytics Pro & Dashboard Polish

### Task 8.1: Analytics aggregation

**Files:**
- Create: `supabase/migrations/013_analytics_rollup.sql` — materialized daily rollup table `analytics_daily` (client_id, day, path, views, visitors) + cron refresh (reuse cron route pattern: `src/app/api/cron/rollup-analytics/route.ts`, daily)
- Modify: `src/app/(app)/analytics/page.tsx` — date-range picker (7/30/90d), top pages, referrers, devices, custom events table, per-post performance; query rollups for ranges > 7 days, raw events otherwise

- [ ] Migration + cron + UI; commit `feat: analytics rollups and expanded dashboard`

### Task 8.2: Dashboard home v2

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx` — content health (drafts aging >14d, scheduled queue, missing SEO count), quick actions, activity feed, 30-day sparkline

- [ ] Build; commit `feat: dashboard v2`

---

## Execution Order & Dependencies

```
Phase 1 (foundations) ─┬─> Phase 2 (media) ──> Phase 3 (editorial) ──> Phase 4 (collections) ──┬─> Phase 7 (pipeline/SDK v2)
                       │                                                                        │
                       └────────────────────> Phase 5 (site control) ──> Phase 6 (team) ───────┘
                                                                                                └─> Phase 8 (analytics)
```

Strict path: 1 → 2 → 3 → 4 → 7. Phases 5, 6, 8 can interleave after 1 (5.2 reuses Phase 4's FieldDef validate — do 4.2 first or copy the lib task forward).

Rough sizing (solo dev, focused): P1 ~2d · P2 ~2d · P3 ~4d · P4 ~4d · P5 ~4d · P6 ~2d · P7 ~3d · P8 ~2d ≈ 4–5 weeks.

## Self-Review Notes

- Spec coverage: every "Soon" sidebar item has a task (Media 2.2, SEO 5.3, Forms 5.2, Announcements 5.1, Team 6.1). Customization requirement → Phase 4 + SDK v2 typed generation. Existing live sites protected by compat constraint + byte-identical SDK v1 test (7.2).
- Types referenced across tasks: `MediaItem` (2.1→2.2/3.2), `FieldDef` (4.1→4.2/4.3/4.4/5.2), `validateEntry` (4.2→4.3/4.4/5.2), `resolveApiAccess`/`parsePagination` (1.3→4.4/5.x), `logActivity` (1.2→everywhere), `notifyPublish` (7.1→3.4/7.2) — names consistent.
- Deliberate YAGNI: no page-builder/drag-drop blocks (client sites are custom-coded by NE — structured content + globals is the right contract), no i18n, no comments module, properties not migrated to collections.
