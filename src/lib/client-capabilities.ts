import type { Client, ClientCapabilities } from '@/lib/supabase/types';

/**
 * Capabilities every website gets unless its own row says otherwise.
 * `properties` is the one thing off by default: it is a single client's
 * bespoke module, not something a new site should inherit.
 *
 * These are merged UNDER `clients.capabilities` (migration 023), so adding a
 * key here stays backwards compatible — an existing row that has never heard
 * of the new key simply picks up the default rather than losing the module.
 */
export const DEFAULT_CLIENT_CAPABILITIES: ClientCapabilities = {
  posts: true,
  pages: true,
  properties: false,
  media: true,
  collections: true,
  navigation: true,
  forms: true,
  announcements: true,
  analytics: true,
  social: true,
  seo: true,
  team: true,
};

/**
 * Which CMS modules a website exposes.
 *
 * Configuration only — there is deliberately no per-client branch in this
 * file. `KAMAL_KARIM_SLUG` in `Sidebar.tsx` was the original scar, and a
 * `LEGACY_SLUG_OVERRIDES` map here was its relocation: a fallback profile
 * keyed by slug, kept "until the database is migrated". Migration 023 both
 * added `clients.capabilities` and wrote that exact profile into the
 * kamal-karim row, and every caller loads clients with `select('*')`, so the
 * fallback could only ever have re-stated what the row already said. It is
 * gone; onboarding a client with a different module set is a row update.
 */
export function getClientCapabilities(client: Client | null | undefined): ClientCapabilities {
  return {
    ...DEFAULT_CLIENT_CAPABILITIES,
    ...(client?.capabilities ?? null),
  };
}
