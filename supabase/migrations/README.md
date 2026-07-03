# Migrations — application notes

Migration files in this directory are additive and reviewed in git. As of
2026-07-03, all migrations through `007` have been applied directly to the
live Supabase project via MCP (`apply_migration`), same-session as writing
them — nothing in this directory is currently pending.

## History note (2026-07-03)

Before `003`–`007` were applied this session, the live database already had
a `collections` / `collection_items` / `menu_items` schema (applied via the
Supabase dashboard as migration `003_collections`, timestamped
`20260702033241`) with **no corresponding file anywhere in this repo's git
history** — it predates and is unrelated to this repo's own `003`–`006`
files (activity log, API keys, media storage, editorial schema), which use
the same leading number by coincidence of independent numbering, not a
conflict (Supabase versions migrations by timestamp, not by filename).

`007_document_existing_collections_schema.sql` captures that pre-existing
schema into version control for the first time (idempotent — safe against
an environment that already has it). Phase 4 (Dynamic Collections) adopts
this existing design rather than building a parallel one — see the master
plan's Phase 4 section for the reconciled task breakdown.

`007` additionally adds `updated_at` triggers to `collections` /
`collection_items` / `menu_items`, which were missing on the live schema
despite having `updated_at` columns (every other table in this schema has
one) — a real, additive fix applied as part of documenting this schema.

## Applying future migrations

Going forward, apply directly via the Supabase MCP `apply_migration` tool
as part of the same session that writes the migration file, rather than
deferring application to a separate release step.
