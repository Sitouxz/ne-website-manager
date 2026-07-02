import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

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

function parseDevice(userAgent: string) {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  if (/mobile|iphone|android/i.test(userAgent)) return 'mobile';
  if (!userAgent) return 'unknown';
  return 'desktop';
}

function parseBrowser(userAgent: string) {
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/opr\//i.test(userAgent)) return 'Opera';
  if (/chrome|crios/i.test(userAgent)) return 'Chrome';
  if (/firefox|fxios/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  return userAgent ? 'Other' : 'unknown';
}

function cleanPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '/';
  try {
    return new URL(value).pathname || '/';
  } catch {
    return value.startsWith('/') ? value.slice(0, 300) : `/${value.slice(0, 299)}`;
  }
}

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

  if (!client) return json({ error: 'Client not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const headers = req.headers;
  const userAgent = headers.get('user-agent') ?? '';

  const { error } = await admin.from('analytics_events').insert({
    client_id: client.id,
    event_name: typeof body.event_name === 'string' ? body.event_name.slice(0, 80) : 'page_view',
    path: cleanPath(body.path),
    title: typeof body.title === 'string' ? body.title.slice(0, 200) : null,
    referrer: typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : null,
    visitor_id: typeof body.visitor_id === 'string' ? body.visitor_id.slice(0, 120) : null,
    session_id: typeof body.session_id === 'string' ? body.session_id.slice(0, 120) : null,
    device: parseDevice(userAgent),
    browser: parseBrowser(userAgent),
    country: headers.get('x-vercel-ip-country') ?? headers.get('cf-ipcountry') ?? null,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  });

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
