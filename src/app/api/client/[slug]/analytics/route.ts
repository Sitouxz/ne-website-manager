import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createRateLimiter, getClientIp } from '@/lib/api/rate-limit';
import { loadExtraHosts, siteHostOf } from '@/lib/analytics/traffic-sources';
import { countryFromHeaders, normalizeEvent } from '@/lib/analytics/ingest';

/**
 * Rate limit: 120 events per rolling 60s per (IP, client) pair.
 *
 * This endpoint is public by necessity — it's a first-party analytics beacon
 * called from client websites — but it writes with the service-role client and
 * previously had no limiting at all, so a single caller could insert unbounded
 * rows into `analytics_events` for any active client slug. The form-submission
 * endpoint has had a honeypot and a limiter from the start; this one is now
 * consistent with it.
 *
 * 120/min is deliberately generous: a real visitor browsing quickly generates
 * a handful of page views a minute, so this only trips on automation. Over
 * budget returns 204, not 429 — a beacon must never surface an error into a
 * client's site, and a tracking call has nothing useful to say to the caller.
 */
const RATE_LIMIT = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;
const limiter = createRateLimiter(RATE_LIMIT, RATE_LIMIT_WINDOW_MS);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data: client } = await admin
    .from('clients')
    .select('id, website_url')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (!client) return json({ error: 'Client not found' }, { status: 404 });

  // Silently drop over-budget events rather than erroring — see the limiter's
  // comment above. The caller is a beacon on someone's live website.
  if (!limiter.check(`${getClientIp(req)}:${client.id}`)) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Parsed from text so `text/plain` beacons (which skip the CORS
  // preflight) are accepted as well as `application/json`. Validation and
  // server-side derivation live in lib/analytics/ingest.ts, shared with the
  // batch route that tracker v3 uses.
  const body = await req.text().then((t) => JSON.parse(t)).catch(() => ({}));
  const row = normalizeEvent(body, {
    clientId: client.id,
    userAgent: req.headers.get('user-agent') ?? '',
    country: countryFromHeaders(req.headers),
    nowMs: Date.now(),
    siteHost: siteHostOf(client.website_url),
    extraHosts: await loadExtraHosts(admin),
  });
  if (!row) return json({ error: 'Invalid event' }, { status: 400 });

  const { error } = await admin.from('analytics_events').insert(row);

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ ok: true });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const url = new URL(req.url);
  const payload = {
    event_name: url.searchParams.get('event') ?? 'page_view',
    path: url.searchParams.get('path') ?? '/',
    title: url.searchParams.get('title'),
    referrer: url.searchParams.get('referrer'),
    visitor_id: url.searchParams.get('visitor_id'),
    session_id: url.searchParams.get('session_id'),
  };

  const response = await POST(
    new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(payload),
    }),
    { params }
  );

  if (!url.searchParams.has('pixel')) return response;
  return new Response(new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59]), {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
