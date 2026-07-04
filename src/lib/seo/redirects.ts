/**
 * Pure TS mirror of the `redirects_authenticated` RLS `WITH CHECK` clause's
 * same-origin check (`supabase/migrations/012_restrict_cross_origin_redirects.sql`).
 *
 * The DB is the actual enforcement point (non-ne_admin writes with a
 * cross-origin `to_path` are rejected there regardless of what the client
 * sends) — this helper exists purely so the CMS's redirects form
 * (`src/app/(app)/seo/page.tsx`) can give an immediate, specific client-side
 * error ("Cross-domain redirects require admin approval") instead of
 * surfacing a raw Postgres RLS-denial message after a round trip.
 *
 * A `to_path` is "same-origin" when it:
 *  - starts with a single `/` (not `//`, which is a protocol-relative URL —
 *    `//evil.com` resolves to `https://evil.com` in a browser, an
 *    open-redirect vector just like an absolute URL) — the bare root path
 *    `/` is explicitly allowed.
 *  - does not begin with a URI scheme prefix
 *    (`^[a-zA-Z][a-zA-Z0-9+.-]*:` — catches `http:`, `https:`,
 *    `javascript:`, `data:`, etc.).
 *
 * Kept in exact lockstep with the SQL regexes in 012_restrict_cross_origin_redirects.sql:
 *   `^/($|[^/])` and `^[a-zA-Z][a-zA-Z0-9+.-]*:`
 */

const SAME_ORIGIN_START = /^\/($|[^/])/;
const URI_SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function isSameOriginRedirectPath(toPath: string): boolean {
  return SAME_ORIGIN_START.test(toPath) && !URI_SCHEME_PREFIX.test(toPath);
}
