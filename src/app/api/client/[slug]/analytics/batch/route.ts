import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createRateLimiter, getClientIp } from '@/lib/api/rate-limit';
import { MAX_BATCH_EVENTS, countryFromHeaders, normalizeEvent } from '@/lib/analytics/ingest';

/**
 * `POST /api/client/[slug]/analytics/batch` — tracker v3's endpoint. Accepts
 * `{ events: [...] }` (or a bare array) of up to `MAX_BATCH_EVENTS` beacon
 * payloads, each validated exactly like the single-event route.
 *
 * Batching exists so a page view plus its `page_leave` flush (and, in later
 * phases, click/scroll bursts) cost one request instead of several, which
 * keeps real visitors far away from the rate limit.
 *
 * Rate limit: 60 batches per rolling 60s per (IP, client) — up to 1,200
 * events a minute, still only reachable by automation. Over budget, a
 * malformed body or an empty batch returns 204 without storing anything: a
 * beacon must never surface an error into a client's site. Events beyond
 * `MAX_BATCH_EVENTS` are dropped rather than rejecting the whole batch.
 *
 * Bodies are parsed from text so the tracker can send `text/plain` (a
 * CORS-safelisted type: `navigator.sendBeacon` cannot send JSON cross-origin
 * without a preflight, and a preflight is not possible during page unload).
 */
const limiter = createRateLimiter(60, 60_000);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const noContent = () => new Response(null, { status: 204, headers: CORS_HEADERS });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data: client } = await admin
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404, headers: CORS_HEADERS });
  }

  if (!limiter.check(`${getClientIp(req)}:${client.id}`)) return noContent();

  const parsed: unknown = await req.text().then((t) => JSON.parse(t)).catch(() => null);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown }).events)
      ? (parsed as { events: unknown[] }).events
      : null;
  if (!list) return noContent();

  const ctx = {
    clientId: client.id,
    userAgent: req.headers.get('user-agent') ?? '',
    country: countryFromHeaders(req.headers),
    nowMs: Date.now(),
  };
  const rows = list.slice(0, MAX_BATCH_EVENTS)
    .map((body) => normalizeEvent(body, ctx))
    .filter((row) => row !== null);
  if (rows.length === 0) return noContent();

  const { error } = await admin.from('analytics_events').insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }
  return NextResponse.json({ ok: true, stored: rows.length }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
