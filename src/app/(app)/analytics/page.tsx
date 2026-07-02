import Topbar from '@/components/Topbar';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import {
  Activity, BarChart2, Eye, MousePointerClick, MonitorSmartphone, Users,
} from 'lucide-react';
import Link from 'next/link';
import type { Profile } from '@/lib/supabase/types';

const SELECTED_CLIENT_COOKIE = 'ne_selected_client_id';
const DAY_MS = 86400000;

type CmsPost = {
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

type AnalyticsEvent = {
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

function daysSince(iso: string | null | undefined, nowMs: number) {
  if (!iso) return null;
  const days = Math.floor((nowMs - new Date(iso).getTime()) / DAY_MS);
  return Math.max(0, days);
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

function dailyBuckets(events: AnalyticsEvent[], days = 14) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    return {
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }),
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

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, clients(*)')
    .eq('id', user!.id)
    .single() as { data: Profile | null };

  const isAdmin = profile?.role === 'ne_admin';
  const selectedClientId = isAdmin ? (await cookies()).get(SELECTED_CLIENT_COOKIE)?.value : null;
  const clientId = selectedClientId ?? profile?.client_id;
  let clientName = profile?.clients?.name ?? 'Website Manager';
  if (isAdmin && clientId) {
    const { data: selectedClient } = await supabase
      .from('clients')
      .select('name')
      .eq('id', clientId)
      .single();
    clientName = selectedClient?.name ?? 'Website Manager';
  }

  const nowMs = new Date().getTime();
  const since = new Date(nowMs - 30 * DAY_MS).toISOString();

  let eventsQuery = supabase
    .from('analytics_events')
    .select('id, event_name, path, title, referrer, visitor_id, session_id, device, browser, country, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (clientId) eventsQuery = eventsQuery.eq('client_id', clientId);
  const { data: eventsData = [] } = await eventsQuery;

  let postsQuery = supabase
    .from('posts')
    .select('id, title, slug, status, category, published_at, updated_at, created_at');
  if (clientId) postsQuery = postsQuery.eq('client_id', clientId);
  const { data: postsData = [] } = await postsQuery.order('updated_at', { ascending: false });

  let pagesQuery = supabase
    .from('pages')
    .select('id, title, path, status, visibility, updated_at');
  if (clientId) pagesQuery = pagesQuery.eq('client_id', clientId);
  const { data: pagesData = [] } = await pagesQuery.order('updated_at', { ascending: false });

  const events = (eventsData ?? []) as AnalyticsEvent[];
  const pageViews = events.filter((event) => event.event_name === 'page_view');
  const customEvents = events.filter((event) => event.event_name !== 'page_view');
  const visitors = new Set(events.map((event) => event.visitor_id).filter(Boolean)).size;
  const sessions = new Set(events.map((event) => event.session_id).filter(Boolean)).size;
  const last24h = events.filter((event) => nowMs - new Date(event.created_at).getTime() <= DAY_MS).length;

  const posts = (postsData ?? []) as CmsPost[];
  const pages = (pagesData ?? []) as CmsPage[];
  const publishedPosts = posts.filter((post) => post.status === 'published');
  const publicPages = pages.filter((page) => page.status === 'published' && page.visibility === 'public');
  const lastUpdated = [...posts.map((p) => p.updated_at), ...pages.map((p) => p.updated_at)]
    .filter(Boolean)
    .sort()
    .at(-1);
  const freshness = daysSince(lastUpdated, nowMs);

  const topPages = countBy(pageViews, (event) => event.path);
  const referrers = countBy(pageViews, (event) => host(event.referrer));
  const devices = countBy(events, (event) => event.device);
  const browsers = countBy(events, (event) => event.browser);
  const countries = countBy(events, (event) => event.country);
  const eventTypes = countBy(events, (event) => event.event_name);
  const buckets = dailyBuckets(pageViews);
  const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <>
      <Topbar title="Analytics" subtitle={`${clientName} · Traffic and CMS performance`} />
      <div className="page-body" style={{ maxWidth: 1180 }}>
        <div style={{ marginBottom: 20, background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 'var(--r-md)', padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <BarChart2 size={17} color="var(--ne-blue)" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: 12.5, color: 'var(--fg2)', margin: 0 }}>
            Tracking the last 30 days of first-party page views and events collected through the NE Website Manager analytics endpoint.
          </p>
        </div>

        <div className="grid-stats">
          <StatCard label="Page Views" value={String(pageViews.length)} sub={`${last24h} events in the last 24h`} icon={Eye} color="var(--ne-blue)" />
          <StatCard label="Visitors" value={String(visitors)} sub={visitors === 0 ? 'Install tracker to begin' : 'Known unique visitors'} icon={Users} color="var(--ne-success)" />
          <StatCard label="Sessions" value={String(sessions)} sub="Browser sessions recorded" icon={Activity} color="#6366f1" />
          <StatCard label="Custom Events" value={String(customEvents.length)} sub={`${eventTypes.length} event types`} icon={MousePointerClick} color="var(--ne-warning)" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr .65fr', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Page Views Trend" action={<span style={{ fontSize: 12, color: 'var(--fg3)' }}>Last 14 days</span>} />
            <div style={{ padding: 20 }}>
              {pageViews.length === 0 ? (
                <div style={{ color: 'var(--fg3)', fontSize: 13, padding: '48px 0', textAlign: 'center' }}>No page views recorded yet. Add the generated analytics helper to the client website.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${buckets.length}, 1fr)`, gap: 8, alignItems: 'end', minHeight: 220 }}>
                  {buckets.map((bucket) => (
                    <div key={bucket.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg1)' }}>{bucket.count}</div>
                      <div style={{ width: '100%', height: Math.max(8, Math.round((bucket.count / maxBucket) * 154)), borderRadius: '6px 6px 0 0', background: 'var(--ne-blue)' }} />
                      <div style={{ fontSize: 10.5, color: 'var(--fg3)', whiteSpace: 'nowrap' }}>{bucket.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Event Types" />
            <div style={{ padding: 20 }}>
              <BarList rows={eventTypes} total={events.length} />
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Top Pages" />
            <div style={{ padding: 20 }}>
              <BarList rows={topPages} total={pageViews.length} />
            </div>
          </Card>

          <Card>
            <CardHead title="Referrers" />
            <div style={{ padding: 20 }}>
              <BarList rows={referrers} total={pageViews.length} />
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Devices" />
            <div style={{ padding: 20 }}>
              <BarList rows={devices} total={events.length} />
            </div>
          </Card>
          <Card>
            <CardHead title="Browsers" />
            <div style={{ padding: 20 }}>
              <BarList rows={browsers} total={events.length} />
            </div>
          </Card>
          <Card>
            <CardHead title="Countries" />
            <div style={{ padding: 20 }}>
              <BarList rows={countries} total={events.length} />
            </div>
          </Card>
        </div>

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
                  {events.slice(0, 8).length === 0 ? (
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
