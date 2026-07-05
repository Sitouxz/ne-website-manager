import type { PublishEvent } from '@/lib/publish';

/**
 * Browser-side fire-and-forget trigger for the `notifyPublish` webhook
 * pipeline (Task 7.1). Called from the 'use client' CMS editors (posts,
 * pages, collection entries, site globals, navigation) right after an
 * explicit publish/save action succeeds against Supabase.
 *
 * `notifyPublish` itself lives server-side (`src/lib/publish.ts`) because it
 * needs Node's `crypto` module to sign the outbound payload with the
 * client's `revalidate_secret` — a secret that must never ship in the
 * browser bundle. This helper POSTs to `/api/publish/notify`
 * (`src/app/api/publish/notify/route.ts`), which does the actual work.
 *
 * Deliberately not `async`/awaited by callers, and any rejection is
 * swallowed here: a slow or unreachable client site must never delay the
 * CMS's own save flow (spinner, redirect, "Saved" toast) by even one extra
 * network round trip. If this fetch itself fails to reach our own API
 * route (e.g. offline), the publish event is simply not delivered this
 * time — there is deliberately no retry/queue (YAGNI per the task brief).
 */

/**
 * Computes the canonical LIVE PATH for an entity about to be
 * published/updated/deleted — the value every `firePublishNotify` call site
 * should pass as `path`. Mirrors `resolveEntity` in
 * `src/app/api/client/[slug]/preview/route.ts` EXACTLY (that function is the
 * other place in this codebase that turns a bare entity into a canonical
 * path, itself following the same convention `seo/route.ts`'s sitemap
 * builder established): post -> `/blog/{slug}`, page -> its own `path`
 * column verbatim (already absolute, returned unchanged, never re-prefixed),
 * collection entry -> `/{collectionSlug}/{itemSlug}`. Returns `null` for any
 * other `entityType` (`site_globals`, `menu_item`, or anything this function
 * doesn't recognize) — those have no single canonical path; callers pass
 * `null` straight through as `NotifyPublishParams.path`, and a generated
 * `createRevalidateHandler` falls back to revalidating the whole site.
 *
 * Deliberately pure/no I/O and framework-agnostic (no Node-only or
 * browser-only APIs) so it can be called from both the 'use client' editors
 * and server-side callers (the scheduled-publish cron) alike.
 */
export function computeLivePath(
  entityType: string,
  info: { slug?: string | null; path?: string | null; collectionSlug?: string | null }
): string | null {
  if (entityType === 'post') {
    return info.slug ? `/blog/${info.slug}` : null;
  }
  if (entityType === 'page') {
    return info.path ?? null;
  }
  if (entityType === 'collection_entry') {
    return info.collectionSlug && info.slug ? `/${info.collectionSlug}/${info.slug}` : null;
  }
  return null;
}
export function firePublishNotify(params: {
  clientId: string;
  event: PublishEvent;
  entityType: string;
  entityId: string;
  slug?: string | null;
  /** Canonical live path of the affected entity — see `NotifyPublishParams.path` in `src/lib/publish.ts`. `null`/omitted for entity types with no single canonical path. */
  path?: string | null;
}): void {
  fetch('/api/publish/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});
}
