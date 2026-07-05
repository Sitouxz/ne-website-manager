/**
 * Fire-and-forget publish/deploy webhook dispatcher — Task 7.1.
 *
 * `notifyPublish` is called whenever a real publish/save action happens in
 * the CMS (post/page/collection-entry explicit save-publish, the
 * scheduled-publish cron, and site globals/navigation saves) — never on
 * autosave. It:
 *
 *   1. POSTs a signed JSON payload to `client.revalidate_url` (if set), so a
 *      client site's own `createRevalidateHandler` (Phase 7.2 — generated
 *      for CLIENT sites, not built here) can verify the request genuinely
 *      came from this CMS and call `revalidatePath`/`revalidateTag`.
 *   2. POSTs (empty body) to `client.deploy_hook` (if set), to trigger a
 *      static rebuild — the same contract as the existing "Test Deploy
 *      Hook" button in Settings (`src/app/(app)/settings/page.tsx`).
 *   3. Records one `webhook_deliveries` row per URL actually attempted (so
 *      a client with both `revalidate_url` and `deploy_hook` configured
 *      gets two rows per publish event, not one).
 *
 * Never throws, and never blocks its caller beyond a bounded per-delivery
 * timeout (default 5s, via `AbortController`) — a slow or hanging endpoint
 * on the client's side can never hang the CMS's own save action. All
 * failures (network error, timeout, non-2xx response) are swallowed and
 * recorded as `ok: false` delivery rows instead of being thrown.
 *
 * ## Payload shape (POSTed as the JSON body to `revalidate_url`)
 * ```json
 * {
 *   "event": "content.published" | "content.updated" | "content.deleted",
 *   "entityType": "post" | "page" | "collection_entry" | "site_globals" | "menu_item" | ...,
 *   "entityId": "<uuid>",
 *   "slug": "my-post-slug" | null,
 *   "clientId": "<uuid>",
 *   "timestamp": "2026-07-05T12:00:00.000Z"
 * }
 * ```
 * Signed via request header `x-ne-signature: <hex HMAC-SHA256 of the exact
 * raw request body>`, keyed by `client.revalidate_secret` — computed with
 * Node's `crypto.createHmac('sha256', secret).update(body).digest('hex')`,
 * the same `crypto` module this codebase's `src/lib/api/auth.ts` already
 * uses for API-key hashing (a different primitive — signing, not hashing —
 * but the same module/APIs and the same "keep secrets out of the codebase,
 * only ever compare digests" spirit).
 *
 * `deploy_hook` is POSTed with an empty body (Vercel deploy hooks expect
 * this, and it matches the existing "Test Deploy Hook" button's behavior);
 * its delivery row's `payload` column still records the logical publish
 * event object above — not the literal empty wire body — purely for
 * observability, so an admin reading the delivery log can see *why* a
 * rebuild fired, not just that an empty POST went out.
 */

import { createHmac } from 'crypto';

export type PublishEvent = 'content.published' | 'content.updated' | 'content.deleted';

export interface NotifyPublishParams {
  event: PublishEvent;
  entityType: string;
  entityId: string;
  /** Public slug/path of the affected content, if it has one. */
  slug?: string | null;
}

/** Minimal shape `notifyPublish` needs from a `clients` row. */
export interface NotifyPublishClient {
  id: string;
  revalidate_url?: string | null;
  revalidate_secret?: string | null;
  deploy_hook?: string | null;
}

export interface NotifyPublishOptions {
  /**
   * Per-delivery fetch timeout in ms. Defaults to 5000. Overridable so
   * tests can prove the timeout is honored without a real 5s wall-clock
   * wait (paired with `vi.useFakeTimers()` in `publish.test.ts`) — not
   * meant to be overridden by production call sites.
   */
  timeoutMs?: number;
}

/** Minimal shape `notifyPublish` needs from a Supabase client — matches `mockSupabase()`. */
interface WebhookDeliveriesClient {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  };
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Hex HMAC-SHA256 of `rawBody`, keyed by `secret`. Exported so it (and the
 * signature it produces) can be independently re-derived and verified —
 * both by `publish.test.ts` and, eventually, by a client site's Phase 7.2
 * `createRevalidateHandler`.
 */
export function signPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** `fetch` bounded by an `AbortController` timeout — never hangs past `timeoutMs`. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface DeliveryRow {
  client_id: string;
  url: string;
  event: PublishEvent;
  payload: Record<string, unknown>;
  status_code: number | null;
  ok: boolean;
}

/** Inserts one delivery row. Never throws — a logging failure can't undo the delivery attempt it's describing. */
async function recordDelivery(supabase: WebhookDeliveriesClient, row: DeliveryRow): Promise<void> {
  try {
    const { error } = await supabase.from('webhook_deliveries').insert({ ...row });
    if (error) console.error('notifyPublish: webhook_deliveries insert failed', error);
  } catch (err) {
    console.error('notifyPublish: unexpected error recording delivery', err);
  }
}

async function deliverRevalidate(
  client: NotifyPublishClient,
  logicalPayload: Record<string, unknown>,
  rawBody: string,
  event: PublishEvent,
  supabase: WebhookDeliveriesClient,
  timeoutMs: number
): Promise<void> {
  const url = client.revalidate_url as string;
  let statusCode: number | null = null;
  let ok = false;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Signature header is only meaningful if a secret is configured — an
    // unsigned request still goes out (the receiving handler decides
    // whether to trust it), rather than silently dropping the delivery.
    if (client.revalidate_secret) {
      headers['x-ne-signature'] = signPayload(rawBody, client.revalidate_secret);
    }
    const res = await fetchWithTimeout(url, { method: 'POST', headers, body: rawBody }, timeoutMs);
    statusCode = res.status;
    ok = res.ok;
  } catch {
    statusCode = null;
    ok = false;
  }
  await recordDelivery(supabase, { client_id: client.id, url, event, payload: logicalPayload, status_code: statusCode, ok });
}

async function deliverDeployHook(
  client: NotifyPublishClient,
  logicalPayload: Record<string, unknown>,
  event: PublishEvent,
  supabase: WebhookDeliveriesClient,
  timeoutMs: number
): Promise<void> {
  const url = client.deploy_hook as string;
  let statusCode: number | null = null;
  let ok = false;
  try {
    const res = await fetchWithTimeout(url, { method: 'POST' }, timeoutMs);
    statusCode = res.status;
    ok = res.ok;
  } catch {
    statusCode = null;
    ok = false;
  }
  await recordDelivery(supabase, { client_id: client.id, url, event, payload: logicalPayload, status_code: statusCode, ok });
}

/**
 * Notifies a client's live site that content was published/updated/deleted.
 * Fires whichever of `revalidate_url` / `deploy_hook` are configured (both,
 * one, or neither — a no-op if neither is set), records a delivery row per
 * URL attempted, and never throws or hangs the caller past `timeoutMs`.
 */
export async function notifyPublish(
  client: NotifyPublishClient,
  params: NotifyPublishParams,
  supabase: WebhookDeliveriesClient,
  options: NotifyPublishOptions = {}
): Promise<void> {
  try {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const logicalPayload: Record<string, unknown> = {
      event: params.event,
      entityType: params.entityType,
      entityId: params.entityId,
      slug: params.slug ?? null,
      clientId: client.id,
      timestamp: new Date().toISOString(),
    };
    const rawBody = JSON.stringify(logicalPayload);

    const deliveries: Promise<void>[] = [];
    if (client.revalidate_url) {
      deliveries.push(deliverRevalidate(client, logicalPayload, rawBody, params.event, supabase, timeoutMs));
    }
    if (client.deploy_hook) {
      deliveries.push(deliverDeployHook(client, logicalPayload, params.event, supabase, timeoutMs));
    }

    await Promise.all(deliveries);
  } catch (err) {
    // Belt-and-suspenders: every delivery path above already catches its
    // own errors, but notifyPublish itself must be unconditionally
    // throw-proof for every caller wiring it into a save/publish action.
    console.error('notifyPublish: unexpected error', err);
  }
}
