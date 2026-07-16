import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  isMetricoolConfigured,
  listBrands,
  getTimeline,
  getInstagramPosts,
} from '@/lib/metricool/client';
import { isoRange, sumTimeline } from '@/lib/metricool/normalize';
import type { MetricoolNetwork, SocialSummary } from '@/lib/metricool/types';

// The timelines surfaced on the Social page. Metrics are exact values from the
// Metricool `/v2/analytics/timelines` spec (`metric` param enum).
const TIMELINES: { network: MetricoolNetwork; metric: string; label: string }[] = [
  { network: 'instagram', metric: 'postsInteractions', label: 'Instagram interactions' },
  { network: 'facebook', metric: 'pageImpressions', label: 'Facebook impressions' },
];

/** Resolves the caller's session and their access to `clientId` via RLS-backed config read. */
async function loadConfig(clientId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 401 as const };

  // RLS on `client_social_config` scopes this to ne_admin (any client) or the
  // owning client_admin — an editor / wrong client simply gets no row.
  const { data } = await supabase
    .from('client_social_config')
    .select('metricool_blog_id, metricool_brand_label')
    .eq('client_id', clientId)
    .maybeSingle();

  return { status: 200 as const, supabase, config: data };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');

  // Admin brand picker: list the brands on the Metricool account so an admin
  // can map one to a client. Requires configured account creds + a session.
  if (url.searchParams.get('brands') === '1') {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isMetricoolConfigured()) return NextResponse.json({ configured: false, brands: [] });
    try {
      return NextResponse.json({ configured: true, brands: await listBrands() });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Metricool error' }, { status: 502 });
    }
  }

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });

  const loaded = await loadConfig(clientId);
  if (loaded.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const blogId = loaded.config?.metricool_blog_id ?? null;
  const days = Number(url.searchParams.get('days') ?? '30');
  const range = isoRange(Number.isFinite(days) && days > 0 ? days : 30);

  // Not configured: either no account creds, or this client isn't mapped to a
  // Metricool brand yet. Return a clean, non-error "empty" summary.
  if (!isMetricoolConfigured() || !blogId) {
    const summary: SocialSummary = {
      configured: false,
      brand: null,
      timelines: [],
      instagramPosts: [],
    };
    return NextResponse.json(summary);
  }

  // Fetch every timeline + IG posts concurrently; one upstream failure
  // degrades to a warning rather than blanking the whole page.
  const [timelineResults, postsResult] = await Promise.all([
    Promise.allSettled(
      TIMELINES.map(async (t) => ({
        ...t,
        points: await getTimeline({ blogId, network: t.network, metric: t.metric, from: range.from, to: range.to }),
      })),
    ),
    getInstagramPosts({ blogId, from: range.from, to: range.to }).then(
      (posts) => posts,
      () => null,
    ),
  ]);

  const timelines: SocialSummary['timelines'] = [];
  let failures = 0;
  for (const result of timelineResults) {
    if (result.status === 'fulfilled') {
      timelines.push({
        network: result.value.network,
        metric: result.value.metric,
        label: result.value.label,
        total: sumTimeline(result.value.points),
        points: result.value.points,
      });
    } else {
      failures += 1;
    }
  }

  const summary: SocialSummary = {
    configured: true,
    brand: { blogId, label: loaded.config?.metricool_brand_label ?? null },
    timelines,
    instagramPosts: (postsResult ?? []).slice(0, 12),
    ...(failures > 0 || postsResult === null
      ? { warning: 'Some Metricool metrics could not be loaded. Check the brand’s connected networks.' }
      : {}),
  };
  return NextResponse.json(summary);
}

/** Map a Metricool brand (blogId) to a client. Authorized by `client_social_config` RLS. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId = typeof body.clientId === 'string' ? body.clientId : null;
  const blogId = typeof body.blogId === 'string' ? body.blogId.trim() : null;
  const label = typeof body.label === 'string' ? body.label.slice(0, 200) : null;
  if (!clientId || !blogId) return NextResponse.json({ error: 'clientId and blogId required' }, { status: 400 });

  // RLS enforces the caller may write this client's row (ne_admin or owning client_admin).
  const { error } = await supabase.from('client_social_config').upsert(
    { client_id: clientId, metricool_blog_id: blogId, metricool_brand_label: label },
    { onConflict: 'client_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
