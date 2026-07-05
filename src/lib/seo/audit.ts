/**
 * Shared "missing SEO metadata" logic, extracted out of `src/app/(app)/seo/page.tsx`
 * (Task 5.3's Content SEO Audit section) so Task 8.2's dashboard Content Health
 * card can report the same count without re-deriving the rule.
 *
 * A row counts as missing SEO metadata when either `seo_title` or
 * `seo_description` is null/empty/whitespace-only — this is a straight lift
 * of `seo/page.tsx`'s original inline `missing()` filter, unchanged.
 *
 * Deliberately takes already-fetched rows rather than a Supabase client +
 * client_id and fetching internally: `seo/page.tsx` is a client component
 * (browser `createClient()`) and `dashboard/page.tsx` is a server component
 * (server `createClient()`) — those use different client factories, so a
 * helper that also owns the fetch would need to accept either client type
 * anyway. Taking rows keeps this pure and trivially unit-testable, and each
 * call site's existing query (which already differs slightly — the audit
 * page selects `title` too, for display) is left as-is.
 */

export interface SeoAuditRow {
  id: string;
  seo_title: string | null;
  seo_description: string | null;
}

/** True when a published post/page row is missing its SEO title and/or description. */
export function isMissingSeo(row: SeoAuditRow): boolean {
  return !row.seo_title?.trim() || !row.seo_description?.trim();
}

/** Count of posts + pages missing SEO metadata — the number the dashboard's Content Health card and the SEO audit page's summary both need. */
export function countMissingSeo(posts: SeoAuditRow[], pages: SeoAuditRow[]): number {
  return posts.filter(isMissingSeo).length + pages.filter(isMissingSeo).length;
}
