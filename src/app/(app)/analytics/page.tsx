'use client';

import Topbar from '@/components/Topbar';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { computeLivePath } from '@/lib/publish-client';
import {
  Activity, BarChart2, Download, Eye, MousePointerClick, MonitorSmartphone, Users, Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { DAY_MS, daysSince, utcDayKey } from '@/lib/dates';

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];

type CmsPost = {
  client_id: string;
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  category: string | null;
  published_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type CmsPage = {
  id: string;
  title: string;
  path: string;
  status: 'draft' | 'published';
  visibility: 'public' | 'private';
  updated_at: string | null;
};

export type AnalyticsEvent = {
  id: string;
  event_name: string;
  path: string;
  title: string | null;
  referrer: string | null;
  visitor_id: string | null;
  session_id: string | null;
  device: string | null;
  browser: string | null;
  country: string | null;
  created_at: string;
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Like `daysSince` from `lib/dates`, but distinguishes "no data" from "today":
 * the Last CMS Update tile renders `null` as "-" and 0 as "0d", so collapsing
 * the two would claim an update happened today when none ever has.
 */
function daysSinceOrNull(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  return daysSince(iso, nowMs);
}

function host(referrer: string | null) {
  if (!referrer) return 'Direct';
  try {
    return new URL(referrer).hostname.replace(/^www\./, '');
  } catch {
    return 'Other';
  }
}

function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item)?.trim() || 'Unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Builds the UTC-midnight instant that begins the `days`-day window ending
 * "today" (UTC). `analytics_daily.day` is written from
 * `new Date(created_at).toISOString().slice(0, 10)` by the rollup cron
 * (src/app/api/cron/rollup-analytics/route.ts) — i.e. always a UTC calendar
 * day — so bucket boundaries here must be computed with UTC date methods
 * (`getUTCFullYear`/`getUTCMonth`/`getUTCDate` via `Date.UTC`), never local
 * `setHours`/`getDate`/`setDate`. Using local methods would shift the
 * midnight instant (and therefore every bucket's UTC-day key) whenever the
 * browser (or, for the dashboard's server component, the server process) is
 * not running in UTC.
 */
export function utcWindowStart(days: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

export function dailyBuckets(events: AnalyticsEvent[], days: number) {
  const start = utcWindowStart(days);

  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    return {
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      count: 0,
    };
  });

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const event of events) {
    const key = new Date(event.created_at).toISOString().slice(0, 10);
    const bucket = byKey.get(key);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

function CardHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>{title}</div>
      {action}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div style={{ width: 38, height: 38, borderRadius: 10, background: color + '18', display: 'grid', placeItems: 'center', color, marginBottom: 14 }}>
        <Icon size={18} />
      </div>
      <div className="num">{value}</div>
      <div className="lbl">{label}</div>
      <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function BarList({ rows, total }: { rows: { name: string; count: number }[]; total: number }) {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--fg3)', fontSize: 13, padding: '28px 0', textAlign: 'center' }}>No data yet.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {rows.slice(0, 6).map((row) => (
        <div key={row.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 600, color: 'var(--fg1)' }}>{row.name}</span>
            <span style={{ fontSize: 12, color: 'var(--fg3)' }}>{row.count}</span>
          </div>
          <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 99 }}>
            <div style={{ height: '100%', width: `${Math.max(4, Math.round((row.count / Math.max(1, total)) * 100))}%`, background: 'var(--ne-blue)', borderRadius: 99 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '12px 14px', background: 'var(--surface-2)' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg1)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--fg2)', marginTop: 6 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { selectedClientId, clientName } = useSelectedClient();
  const [range, setRange] = useState<RangeDays>(7);
  const [loading, setLoading] = useState(true);
  // Raw events for the selected range, from the start of the UTC-day window
  // the trend chart uses. Every card on the page derives from this one set, so
  // the stat tiles, chart and breakdowns can never disagree with each other.
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [eventsTruncated, setEventsTruncated] = useState(false);
  const [includeBots, setIncludeBots] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [posts, setPosts] = useState<CmsPost[]>([]);
  const [pages, setPages] = useState<CmsPage[]>([]);
  // A post's live path depends on where its client's site publishes the blog
  // (`clients.blog_path`). Keyed by client so the ne_admin all-clients view
  // stays correct too, instead of assuming everyone uses /blog.
  const [blogPathByClient, setBlogPathByClient] = useState<Record<string, string>>({});
  // "Now" as of the last fetch — read once inside the (impure, but
  // effect-triggered rather than render-time) `fetchData` callback below and
  // stored as state, rather than calling `Date.now()` directly during render
  // (which the react-hooks/purity rule disallows: render must be idempotent
  // for identical props/state, and reading the clock live would violate that).
  const [nowMs, setNowMs] = useState(() => Date.now());

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const nowMs = Date.now();
    const windowStart = utcWindowStart(range).toISOString();

    // PostgREST caps a single response at 1000 rows, so page through the
    // window instead of silently truncating busy ranges (the old single
    // `.limit(1000)` under-counted everything once a week exceeded 1000 events).
    const PAGE = 1000;
    const MAX_PAGES = 30;
    const fetchEvents = async () => {
      const rows: AnalyticsEvent[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        let q = supabase
          .from('analytics_events')
          .select('id, event_name, path, title, referrer, visitor_id, session_id, device, browser, country, created_at')
          .gte('created_at', windowStart)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (selectedClientId) q = q.eq('client_id', selectedClientId);
        if (!includeBots) q = q.eq('is_bot', false);
        const { data, error } = await q;
        if (error) return { rows, error: error.message, truncated: false };
        rows.push(...((data ?? []) as AnalyticsEvent[]));
        if ((data?.length ?? 0) < PAGE) return { rows, error: null, truncated: false };
      }
      return { rows, error: null, truncated: true };
    };

    let postsQuery = supabase
      .from('posts')
      .select('id, client_id, title, slug, status, category, published_at, updated_at, created_at')
      .order('updated_at', { ascending: false });
    if (selectedClientId) postsQuery = postsQuery.eq('client_id', selectedClientId);

    let pagesQuery = supabase
      .from('pages')
      .select('id, title, path, status, visibility, updated_at')
      .order('updated_at', { ascending: false });
    if (selectedClientId) pagesQuery = pagesQuery.eq('client_id', selectedClientId);

    const clientsQuery = supabase.from('clients').select('id, blog_path');

    const [eventsRes, postsRes, pagesRes, clientsRes] = await Promise.all([
      fetchEvents(),
      postsQuery,
      pagesQuery,
      clientsQuery,
    ]);

    const errors = [eventsRes.error, postsRes.error?.message, pagesRes.error?.message, clientsRes.error?.message].filter(Boolean);
    setLoadError(errors.length ? errors.join(' · ') : null);
    setEvents(eventsRes.rows);
    setEventsTruncated(eventsRes.truncated);
    setPosts((postsRes.data ?? []) as CmsPost[]);
    setPages((pagesRes.data ?? []) as CmsPage[]);
    setBlogPathByClient(Object.fromEntries(
      ((clientsRes.data ?? []) as { id: string; blog_path: string | null }[])
        .map((client) => [client.id, client.blog_path || '/blog']),
    ));
    setNowMs(nowMs);
    setLoading(false);
  }, [selectedClientId, range, includeBots]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchData]);

  const pageViews = events.filter((event) => event.event_name === 'page_view');
  const customEvents = events.filter((event) => event.event_name !== 'page_view');
  const sessions = new Set(events.map((event) => event.session_id).filter(Boolean)).size;
  const last24h = events.filter((event) => nowMs - new Date(event.created_at).getTime() <= DAY_MS).length;
  const referrers = countBy(pageViews, (event) => host(event.referrer));
  const devices = countBy(events, (event) => event.device);
  const browsers = countBy(events, (event) => event.browser);
  const countries = countBy(events, (event) => event.country);
  const eventTypes = countBy(events, (event) => event.event_name);

  const trendBuckets = dailyBuckets(pageViews, range);
  const rangeViews = trendBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const rangeVisitors = new Set(events.map((event) => event.visitor_id).filter(Boolean)).size;
  const topPages = countBy(pageViews, (event) => event.path);
  const maxBucket = Math.max(1, ...trendBuckets.map((bucket) => bucket.count));
  const viewsByPath = new Map(topPages.map((row) => [row.name, row.count]));

  const publishedPosts = posts.filter((post) => post.status === 'published');
  const publicPages = pages.filter((page) => page.status === 'published' && page.visibility === 'public');
  const lastUpdated = [...posts.map((p) => p.updated_at), ...pages.map((p) => p.updated_at)]
    .filter(Boolean)
    .sort()
    .at(-1);
  const freshness = daysSinceOrNull(lastUpdated, nowMs);

  // Per-post performance (Task 8.1): match each post's canonical live path
  // (via `computeLivePath`, the same helper the publish pipeline uses —
  // never re-derive the blog-path convention here) against whichever
  // path->views map is active for the selected range.
  //

  const postPerformance = posts
    .map((post) => {
      const path = computeLivePath('post', { slug: post.slug, blogPath: blogPathByClient[post.client_id] });
      return { post, path, views: path ? viewsByPath.get(path) ?? 0 : 0 };
    })
    .filter((row): row is { post: CmsPost; path: string; views: number } => row.path !== null)
    .sort((a, b) => b.views - a.views || a.post.title.localeCompare(b.post.title))
    .slice(0, 8);

  const exportPdf = async () => {
    setExporting(true);
    try {
      const { buildAnalyticsPdf } = await import('@/lib/analytics/pdf');
      const start = utcWindowStart(range);
      const dateFmt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
      const rangeLabel = `${start.toLocaleDateString('en-SG', dateFmt)} – ${new Date(nowMs).toLocaleDateString('en-SG', dateFmt)}`;
      const doc = await buildAnalyticsPdf({
        clientName,
        rangeLabel,
        rangeDays: range,
        generatedAt: new Date(),
        includesBots: includeBots,
        kpis: [
          { label: 'Page views', value: rangeViews.toLocaleString('en-US'), sub: `${last24h.toLocaleString('en-US')} events in the last 24h` },
          { label: 'Visitors', value: rangeVisitors.toLocaleString('en-US'), sub: 'Unique visitors' },
          { label: 'Sessions', value: sessions.toLocaleString('en-US'), sub: `Browser sessions, last ${range} days` },
          { label: 'Custom events', value: customEvents.length.toLocaleString('en-US'), sub: `${eventTypes.length} event types` },
        ],
        trend: trendBuckets.map((b) => ({ label: b.label, count: b.count })),
        pages: topPages,
        referrers,
        countries,
        devices,
        browsers,
        eventTypes,
        posts: postPerformance.map((row) => ({ title: row.post.title, path: row.path, views: row.views })),
      });
      const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
      doc.save(`analytics-${slug}-${utcDayKey(nowMs)}-${range}d.pdf`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Topbar title="Analytics" subtitle={`${clientName} · Traffic and CMS performance`} />
      <div className="page-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} style={{
                padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: range === r ? 'var(--ne-blue)' : 'var(--surface)',
                color: range === r ? '#fff' : 'var(--fg2)',
                boxShadow: 'var(--shadow-sm)',
              }}>
                {r} days
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {loading && (
              <span style={{ fontSize: 12, color: 'var(--fg3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> Loading…
              </span>
            )}
            <label style={{ fontSize: 12.5, color: 'var(--fg2)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeBots} onChange={(e) => setIncludeBots(e.target.checked)} />
              Include bot traffic
            </label>
            <button
              onClick={exportPdf}
              disabled={loading || exporting}
              style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: loading || exporting ? 'default' : 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg1)', display: 'flex', alignItems: 'center', gap: 6, opacity: loading || exporting ? 0.6 : 1 }}
            >
              {exporting ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Download size={14} />}
              Export PDF
            </button>
          </div>
        </div>

        {loadError && (
          <div role="alert" style={{ marginBottom: 20, background: 'var(--ne-danger-bg, #fef2f2)', border: '1px solid var(--ne-danger, #dc2626)', borderRadius: 'var(--r-md)', padding: '12px 18px', fontSize: 12.5, color: 'var(--fg1)' }}>
            Some analytics data failed to load, so the numbers below may be incomplete: {loadError}
          </div>
        )}

        <div style={{ marginBottom: 20, background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 'var(--r-md)', padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <BarChart2 size={17} color="var(--ne-blue)" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: 12.5, color: 'var(--fg2)', margin: 0 }}>
            Tracking the last {range} days of first-party page views collected through the NE Website Manager analytics endpoint.{includeBots ? ' Bot traffic is included.' : ' Bot and crawler traffic is excluded.'}
            {eventsTruncated && ' Showing the most recent 30,000 events for this range.'}
          </p>
        </div>

        <div className="grid-stats">
          <StatCard label="Page Views" value={String(rangeViews)} sub={`${last24h} events in the last 24h`} icon={Eye} color="var(--ne-blue)" />
          <StatCard label="Visitors" value={String(rangeVisitors)} sub={rangeVisitors === 0 ? 'Install tracker to begin' : 'Unique visitors'} icon={Users} color="var(--ne-success)" />
          <StatCard label="Sessions" value={String(sessions)} sub={`Browser sessions, last ${range} days`} icon={Activity} color="#6366f1" />
          <StatCard label="Custom Events" value={String(customEvents.length)} sub={`${eventTypes.length} event types, last ${range} days`} icon={MousePointerClick} color="var(--ne-warning)" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr .65fr', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Page Views Trend" action={<span style={{ fontSize: 12, color: 'var(--fg3)' }}>Last {range} days</span>} />
            <div style={{ padding: 20 }}>
              {rangeViews === 0 ? (
                <div style={{ color: 'var(--fg3)', fontSize: 13, padding: '48px 0', textAlign: 'center' }}>No page views recorded yet. Add the generated analytics helper to the client website.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${trendBuckets.length}, 1fr)`, gap: range > 30 ? 2 : 8, alignItems: 'end', minHeight: 220 }}>
                  {trendBuckets.map((bucket) => (
                    <div key={bucket.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      {range <= 30 && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg1)' }}>{bucket.count}</div>}
                      <div style={{ width: '100%', height: Math.max(4, Math.round((bucket.count / maxBucket) * 154)), borderRadius: '6px 6px 0 0', background: 'var(--ne-blue)' }} />
                      {range <= 30 && <div style={{ fontSize: 10.5, color: 'var(--fg3)', whiteSpace: 'nowrap' }}>{bucket.label}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Event Types" />
            <div style={{ padding: 20 }}>
              <BarList rows={eventTypes} total={Math.max(1, events.length)} />
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Top Pages" />
            <div style={{ padding: 20 }}>
              <BarList rows={topPages} total={Math.max(1, rangeViews)} />
            </div>
          </Card>

          <Card>
            <CardHead title="Referrers" />
            <div style={{ padding: 20 }}>
              <BarList rows={referrers} total={Math.max(1, pageViews.length)} />
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Devices" />
            <div style={{ padding: 20 }}>
              <BarList rows={devices} total={Math.max(1, events.length)} />
            </div>
          </Card>
          <Card>
            <CardHead title="Browsers" />
            <div style={{ padding: 20 }}>
              <BarList rows={browsers} total={Math.max(1, events.length)} />
            </div>
          </Card>
          <Card>
            <CardHead title="Countries" />
            <div style={{ padding: 20 }}>
              <BarList rows={countries} total={Math.max(1, events.length)} />
            </div>
          </Card>
        </div>

        <Card style={{ marginBottom: 24 }}>
          <CardHead title="Top Posts" action={<span style={{ fontSize: 12, color: 'var(--fg3)' }}>By views, last {range} days</span>} />
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Post</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th>Views</th>
                </tr>
              </thead>
              <tbody>
                {postPerformance.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 34, color: 'var(--fg3)' }}>No posts with a computable path yet.</td></tr>
                ) : postPerformance.map((row) => (
                  <tr key={row.post.id}>
                    <td style={{ paddingLeft: 20, fontWeight: 600, color: 'var(--fg1)' }}>{row.post.title}</td>
                    <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{row.path}</td>
                    <td><span className={`status-pill ${row.post.status}`}>{row.post.status}</span></td>
                    <td style={{ fontWeight: 700, color: 'var(--fg1)' }}>{row.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Recent Events" />
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20 }}>Event</th>
                    <th>Path</th>
                    <th>Device</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: 34, color: 'var(--fg3)' }}><Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /></td></tr>
                  ) : events.slice(0, 8).length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: 34, color: 'var(--fg3)' }}>No analytics events have been captured yet.</td></tr>
                  ) : events.slice(0, 8).map((event) => (
                    <tr key={event.id}>
                      <td style={{ paddingLeft: 20, fontWeight: 600 }}>{event.event_name}</td>
                      <td style={{ maxWidth: 260 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg1)' }}>{event.path}</div>
                        <div style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{host(event.referrer)}</div>
                      </td>
                      <td style={{ color: 'var(--fg3)', fontSize: 12 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MonitorSmartphone size={13} />{event.device ?? 'unknown'}</span>
                      </td>
                      <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{fmtDateTime(event.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHead title="CMS Health" action={<Link href="/cms/posts" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>Manage posts</Link>} />
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <MiniMetric label="Published Posts" value={String(publishedPosts.length)} sub={`${posts.length} total posts`} />
              <MiniMetric label="Public Pages" value={String(publicPages.length)} sub={`${pages.length} managed pages`} />
              <MiniMetric label="Last CMS Update" value={freshness === null ? '-' : `${freshness}d`} sub={fmtDate(lastUpdated)} />
              <MiniMetric label="Managed Pages" value={String(pages.length)} sub="Published and draft" />
            </div>
          </Card>
        </div>

        <Card>
          <CardHead title="Integration Snippet" action={<Link href="/settings" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>Open API settings</Link>} />
          <div style={{ padding: 20 }}>
            <p style={{ fontSize: 12.5, color: 'var(--fg3)', margin: '0 0 12px' }}>
              Install the generated CMS SDK on the client website, then call <code>installAnalytics()</code> once from the browser entry point.
            </p>
            <pre style={{ margin: 0, padding: '14px 16px', background: 'var(--ne-ink)', borderRadius: 6, fontSize: 12, lineHeight: 1.7, color: '#e2e8f0', overflowX: 'auto' }}>{`import { installAnalytics, trackEvent } from '@/lib/cms';

installAnalytics();
trackEvent('contact_click', { location: 'footer' });`}</pre>
          </div>
        </Card>
      </div>
    </>
  );
}
