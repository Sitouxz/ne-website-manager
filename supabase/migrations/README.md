# Migrations — application notes

Migration files in this directory are additive and reviewed in git, but are
**not applied automatically**. Apply via Supabase Dashboard → SQL Editor (or
`supabase db push` from an authorized environment) as part of the release
that ships the corresponding code.

## Pending as of Phase 1 (Foundations)

- `003_activity_log.sql` — required before deploying any commit that calls
  `logActivity()` (post/property save, client creation). If not applied,
  those call sites fail closed (no audit row written, one `console.error`
  per attempt) — content saves themselves are unaffected.
- `004_api_keys.sql` — required before deploying `/api/keys` and the
  Settings → API Access → "API Keys" card. If not applied, that route
  and card 500 on first use.

**Apply 003 and 004 together, in the same release as Phase 1's code**, to
avoid the console-error noise and the broken API Keys tab.
