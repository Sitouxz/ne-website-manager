import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ExternalLink,
  FileEdit,
  FileText,
  Globe2,
  Home,
  Search,
  Upload,
} from 'lucide-react';
import Topbar from '@/components/Topbar';
import ReviewQueue from '@/components/dashboard/ReviewQueue';
import { getActiveWorkspace } from '@/lib/workspace';
import { getClientCapabilities } from '@/lib/client-capabilities';
import { createAdminClient } from '@/lib/supabase/admin';
import { DAY_MS, daysAgoKey, daysSince } from '@/lib/dates';
import { countMissingSeo } from '@/lib/seo/audit';

const DRAFT_AGE_DAYS = 14;
const SPARKLINE_DAYS = 30;

function timeAgo(iso: string | null) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDomain(url: string | null | undefined) {
  if (!url) return 'Website URL not configured';
  try { return new URL(url).host; } catch { return url; }
}

export default async function DashboardPage() {
  const { profile, activeClient, supabase } = await getActiveWorkspace();
  const clientId = activeClient?.id ?? profile?.client_id ?? null;
  const clientName = activeClient?.name ?? profile?.clients?.name ?? 'Website Manager';
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || (profile?.role === 'ne_admin' ? 'NE team' : clientName);
  const capabilities = getClientCapabilities(activeClient ?? profile?.clients);
  const canManage = profile?.role !== 'editor';

  let postsQuery = supabase
    .from('posts')
    .select('id, title, slug, status, published_at, scheduled_at, updated_at, created_at')
    .order('updated_at', { ascending: false });
  if (clientId) postsQuery = postsQuery.eq('client_id', clientId);

  let pagesQuery = supabase
    .from('pages')
    .select('id, title, path, status, updated_at');
  if (clientId) pagesQuery = pagesQuery.eq('client_id', clientId);

  let propertiesQuery = supabase
    .from('properties')
    .select('id, name, status, updated_at')
    .order('updated_at', { ascending: false });
  if (clientId) propertiesQuery = propertiesQuery.eq('client_id', clientId);

  let seoPostsQuery = supabase.from('posts').select('id, title, seo_title, seo_description').eq('status', 'published');
  if (clientId) seoPostsQuery = seoPostsQuery.eq('client_id', clientId);
  let seoPagesQuery = supabase.from('pages').select('id, title, seo_title, seo_description').eq('status', 'published');
  if (clientId) seoPagesQuery = seoPagesQuery.eq('client_id', clientId);

  let activityQuery = supabase
    .from('activity_log')
    .select('id, actor_id, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(8);
  if (clientId) activityQuery = activityQuery.eq('client_id', clientId);

  const sparklineSinceDay = daysAgoKey(SPARKLINE_DAYS - 1);
  let dailyQuery = supabase.from('analytics_daily').select('day, views').gte('day', sparklineSinceDay);
  if (clientId) dailyQuery = dailyQuery.eq('client_id', clientId);

  const [
    { data: allPosts = [] },
    { data: allPages = [] },
    { data: allProperties = [] },
    { data: seoPosts = [] },
    { data: seoPages = [] },
    { data: activityRows = [] },
    { data: dailyRows = [] },
  ] = await Promise.all([postsQuery, pagesQuery, propertiesQuery, seoPostsQuery, seoPagesQuery, activityQuery, dailyQuery]);

  const actorIds = Array.from(new Set((activityRows ?? []).map((row) => row.actor_id).filter((id): id is string => Boolean(id))));
  let actorNames: Record<string, string> = {};
  if (actorIds.length > 0) {
    const admin = createAdminClient();
    const { data: actors } = await admin.from('profiles').select('id, full_name').in('id', actorIds);
    actorNames = Object.fromEntries((actors ?? []).map((actor: { id: string; full_name: string | null }) => [actor.id, actor.full_name ?? 'Unknown']));
  }

  const missingSeoCount = countMissingSeo(
    capabilities.posts ? (seoPosts ?? []) : [],
    capabilities.pages ? (seoPages ?? []) : [],
  );
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const agingDrafts = (allPosts ?? [])
    .filter((post) => post.status === 'draft')
    .map((post) => ({ ...post, ageDays: daysSince(post.updated_at ?? post.created_at, nowMs) }))
    .filter((post) => post.ageDays > DRAFT_AGE_DAYS)
    .sort((a, b) => b.ageDays - a.ageDays);
  const scheduledQueue = (allPosts ?? [])
    .filter((post) => post.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime());

  const recentWork = [
    ...(capabilities.posts ? (allPosts ?? []) : []).map((post) => ({
      id: post.id,
      title: post.title || '(Untitled post)',
      type: 'Post',
      status: post.status,
      updatedAt: post.updated_at,
      href: `/cms/posts/${post.id}`,
    })),
    ...(capabilities.pages ? (allPages ?? []) : []).map((page) => ({
      id: page.id,
      title: page.title || '(Untitled page)',
      type: 'Page',
      status: page.status,
      updatedAt: page.updated_at,
      href: `/cms/pages/${page.id}`,
    })),
    ...(capabilities.properties ? (allProperties ?? []) : []).map((property) => ({
      id: property.id,
      title: property.name || '(Untitled property)',
      type: 'Property',
      status: property.status,
      updatedAt: property.updated_at,
      href: `/cms/properties/${property.id}`,
    })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 7);

  const sparklineNow = new Date();
  const sparklineStart = new Date(Date.UTC(
    sparklineNow.getUTCFullYear(),
    sparklineNow.getUTCMonth(),
    sparklineNow.getUTCDate() - (SPARKLINE_DAYS - 1),
  ));
  const sparklineBuckets = Array.from({ length: SPARKLINE_DAYS }, (_, index) => ({
    key: new Date(sparklineStart.getTime() + index * DAY_MS).toISOString().slice(0, 10),
    views: 0,
  }));
  const sparklineByDay = new Map(sparklineBuckets.map((bucket) => [bucket.key, bucket]));
  for (const row of dailyRows ?? []) {
    const bucket = sparklineByDay.get(row.day);
    if (bucket) bucket.views += row.views;
  }
  const sparklineTotal = sparklineBuckets.reduce((total, bucket) => total + bucket.views, 0);
  const sparklineMax = Math.max(1, ...sparklineBuckets.map((bucket) => bucket.views));
  const canReview = profile?.role === 'ne_admin' || profile?.role === 'client_admin';
  const contentIndexHref = capabilities.properties
    ? '/cms/properties'
    : capabilities.posts
      ? '/cms/posts'
      : '/cms/pages';

  return (
    <>
      <Topbar title="Home" subtitle={`${clientName} · Website workspace`} />
      <main className="page-body dashboard-workspace">
        <div className="dashboard-main">
          <header className="dashboard-intro">
            <h2>Good morning, {firstName}</h2>
            <p>Here is the work that needs attention across {clientName}.</p>
          </header>

          <section id="needs-attention" className="dashboard-section" aria-labelledby="attention-title">
            <div className="dashboard-section-heading">
              <h3 id="attention-title">Needs attention</h3>
            </div>
            <div className="attention-list">
              {capabilities.posts ? <Link href="/cms/posts" className="attention-row">
                <span className="attention-icon warning"><AlertTriangle size={19} /></span>
                <span><strong>{agingDrafts.length} aging draft{agingDrafts.length === 1 ? '' : 's'}</strong><small>{agingDrafts.length ? 'Drafts have not been updated for more than 14 days.' : 'Every draft has been touched recently.'}</small></span>
                <span className="attention-action">Review drafts <ArrowRight size={16} /></span>
              </Link> : null}
              {capabilities.posts ? <Link href="/cms/posts" className="attention-row">
                <span className="attention-icon blue"><CalendarClock size={19} /></span>
                <span><strong>{scheduledQueue.length} scheduled post{scheduledQueue.length === 1 ? '' : 's'}</strong><small>{scheduledQueue.length ? 'Confirm upcoming content and publication times.' : 'Nothing is scheduled right now.'}</small></span>
                <span className="attention-action">Open schedule <ArrowRight size={16} /></span>
              </Link> : null}
              {canManage && capabilities.seo ? <Link href="/seo" className="attention-row">
                <span className="attention-icon warning"><Search size={19} /></span>
                <span><strong>{missingSeoCount} item{missingSeoCount === 1 ? '' : 's'} missing SEO</strong><small>{missingSeoCount ? 'Add titles and descriptions before the next publish.' : 'Published content has complete SEO metadata.'}</small></span>
                <span className="attention-action">Fix SEO <ArrowRight size={16} /></span>
              </Link> : null}
            </div>
          </section>

          {canReview ? <ReviewQueue clientId={clientId} /> : null}

          <section className="dashboard-section" aria-labelledby="recent-work-title">
            <div className="dashboard-section-heading">
              <h3 id="recent-work-title">Recent work</h3>
              <Link href={contentIndexHref}>View all content <ArrowRight size={14} /></Link>
            </div>
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead><tr><th>Item</th><th>Type</th><th>Status</th><th>Updated</th></tr></thead>
                <tbody>
                  {recentWork.length ? recentWork.map((item) => (
                    <tr key={`${item.type}-${item.id}`}>
                      <td><Link href={item.href}>{item.title}</Link></td>
                      <td>{item.type}</td>
                      <td><span className={`status-dot ${item.status}`} />{item.status.replace('_', ' ')}</td>
                      <td>{timeAgo(item.updatedAt)}</td>
                    </tr>
                  )) : <tr><td colSpan={4} className="dashboard-empty">No content yet. Use Quick create to add the first item.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="dashboard-rail" aria-label="Website context and shortcuts">
          <section className="rail-section">
            <div className="rail-heading"><h3>Website status</h3><span className="live-state"><span />Live</span></div>
            <div className="site-domain"><Globe2 size={17} /><span><strong>{formatDomain(activeClient?.website_url)}</strong><small>Selected workspace</small></span></div>
            {activeClient?.website_url ? <a className="rail-primary-link" href={activeClient.website_url} target="_blank" rel="noopener noreferrer">Preview live website <ExternalLink size={15} /></a> : <Link className="rail-primary-link" href="/settings">Configure website URL <ArrowRight size={15} /></Link>}
          </section>

          <section className="rail-section">
            <div className="rail-heading"><h3>Quick create</h3></div>
            <nav className="quick-create" aria-label="Create content">
              {capabilities.properties ? <Link href="/cms/properties/new"><Home size={17} />New property<ArrowRight size={14} /></Link> : null}
              {capabilities.pages ? <Link href="/cms/pages/new"><FileEdit size={17} />New page<ArrowRight size={14} /></Link> : null}
              {capabilities.posts ? <Link href="/cms/posts/new"><FileText size={17} />New blog post<ArrowRight size={14} /></Link> : null}
              {capabilities.forms ? <Link href="/forms"><FileEdit size={17} />New form<ArrowRight size={14} /></Link> : null}
              {capabilities.media ? <Link href="/cms/media"><Upload size={17} />Upload media<ArrowRight size={14} /></Link> : null}
            </nav>
          </section>

          <section id="recent-activity" className="rail-section">
            <div className="rail-heading"><h3>Recent activity</h3></div>
            <div className="activity-list">
              {(activityRows ?? []).length ? (activityRows ?? []).slice(0, 6).map((row) => (
                <div key={row.id} className="activity-row">
                  <span className="activity-marker" />
                  <span><strong>{row.summary}</strong><small>{row.actor_id ? actorNames[row.actor_id] ?? 'Unknown' : 'System'} · {timeAgo(row.created_at)}</small></span>
                </div>
              )) : <p className="rail-empty">No activity yet.</p>}
            </div>
          </section>

          {canManage && capabilities.analytics ? <section className="rail-section traffic-rail">
            <div className="rail-heading"><h3>Traffic</h3><Link href="/analytics">Details</Link></div>
            <strong className="traffic-total">{sparklineTotal.toLocaleString()}</strong>
            <small>page views · last {SPARKLINE_DAYS} days</small>
            <div className="traffic-bars" aria-label={`${sparklineTotal} page views in the last ${SPARKLINE_DAYS} days`}>
              {sparklineBuckets.map((bucket) => <span key={bucket.key} title={`${bucket.key}: ${bucket.views}`} style={{ height: Math.max(2, Math.round((bucket.views / sparklineMax) * 46)) }} />)}
            </div>
          </section> : null}
        </aside>
      </main>
    </>
  );
}
