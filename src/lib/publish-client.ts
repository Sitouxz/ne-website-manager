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
export function firePublishNotify(params: {
  clientId: string;
  event: PublishEvent;
  entityType: string;
  entityId: string;
  slug?: string | null;
}): void {
  fetch('/api/publish/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});
}
