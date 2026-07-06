import Topbar from '@/components/Topbar';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FileText, Eye, Clock, TrendingUp, ArrowUpRight, History, AlertTriangle, CalendarClock, Search, Activity } from 'lucide-react';
import Link from 'next/link';
import ReviewQueue from '@/components/dashboard/ReviewQueue';
import type { Profile } from '@/lib/supabase/types';
import { countMissingSeo } from '@/lib/seo/audit';

const SELECTED_CLIENT_COOKIE = 'ne_selected_client_id';
const DAY_MS = 86_400_000;
const DRAFT_AGE_DAYS = 14;
const SPARKLINE_DAYS = 30;

// Task 6.2: SEO Manager, Media Library, Forms & Leads, Announcements, and
// Team Members have all shipped (Phases 2, 5, and 6.1) — the "Coming Soon"
// placeholder section that used to list them here has been removed rather
// than left in place with a stale list.

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(iso: string | null) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default async function DashboardPage() {
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

  // Fetch posts scoped to client (or all posts for admin). `scheduled_at`
  // added for Task 8.2's scheduled-posts queue (aging-drafts + status stats
  // already had everything else they need from this same query).
  let postsQuery = supabase.from('posts').select('id, title, slug, status, published_at, scheduled_at, updated_at, created_at');
  if (clientId) postsQuery = postsQuery.eq('client_id', clientId);
  const { data: allPosts = [] } = await postsQuery.order('updated_at', { ascending: false });

  // Fetch pages
  let pagesQuery = supabase.from('pages').select('id, status, updated_at');
  if (clientId) pagesQuery = pagesQuery.eq('client_id', clientId);
  const { data: allPages = [] } = await pagesQuery;

  // Task 8.2: Content Health card — missing-SEO count. Same query shape
  // `seo/page.tsx`'s Content SEO Audit section uses (published posts/pages,
  // `id, title, seo_title, seo_description`), scoped the same
  // conditional-`clientId` way as every other query on this page. The
  // filter/count logic itself is shared via `countMissingSeo`
  // (`src/lib/seo/audit.ts`) rather than re-derived here.
  let seoPostsQuery = supabase.from('posts').select('id, title, seo_title, seo_description').eq('status', 'published');
  if (clientId) seoPostsQuery = seoPostsQuery.eq('client_id', clientId);
  let seoPagesQuery = supabase.from('pages').select('id, title, seo_title, seo_description').eq('status', 'published');
  if (clientId) seoPagesQuery = seoPagesQuery.eq('client_id', clientId);
  const [{ data: seoPosts = [] }, { data: seoPages = [] }] = await Promise.all([seoPostsQuery, seoPagesQuery]);
  const missingSeoCount = countMissingSeo(seoPosts ?? [], seoPages ?? []);

  // Task 8.2: 30-day pageview sparkline — reads the Task 8.1 rollup table
  // (`analytics_daily`, one row per client_id/day/path) rather than raw
  // `analytics_events`, same as the analytics page's 30/90-day views.
  const sparklineSinceDay = new Date(Date.now() - (SPARKLINE_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  let dailyQuery = supabase.from('analytics_daily').select('day, views').gte('day', sparklineSinceDay);
  if (clientId) dailyQuery = dailyQuery.eq('client_id', clientId);
  const { data: dailyRows = [] } = await dailyQuery;

  // `client_admin`/`ne_admin` only — an `editor` has no use for a queue of
  // things awaiting someone else's review (see ReviewQueue's own comment
  // for why this is posts-only).
  const canReviewQueue = profile?.role === 'ne_admin' || profile?.role === 'client_admin';

  // Recent activity feed (Task 6.2) — `activity_log` RLS (`client_id =
  // my_client_id() OR is_ne_admin()`, migration 003_activity_log.sql)
  // already scopes this the same way the posts/pages queries above are,
  // so the same conditional `.eq('client_id', ...)` is enough here too.
  let activityQuery = supabase
    .from('activity_log')
    .select('id, actor_id, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(8);
  if (clientId) activityQuery = activityQuery.eq('client_id', clientId);
  const { data: activityRows = [] } = await activityQuery;

  // `profiles_select` RLS (migration 001_initial_schema.sql) only lets a
  // caller see their OWN profile row unless they're `ne_admin` — so
  // resolving a teammate's display name for this feed needs the
  // service-role admin client, exposing only `full_name`. Same narrow,
  // read-only precedent as `resolveAuthorNames` in
  // `src/app/api/cms/revisions/route.ts` (Task 3.3's revision-history
  // panel): not a tenant-scoping bypass, since the activity rows
  // themselves are still resolved through the user-scoped client above.
  const actorIds = Array.from(
    new Set((activityRows ?? []).map((r) => r.actor_id).filter((v): v is string => Boolean(v)))
  );
  let actorNames: Record<string, string> = {};
  if (actorIds.length > 0) {
    const admin = createAdminClient();
    const { data: actorProfiles } = await admin.from('profiles').select('id, full_name').in('id', actorIds);
    actorNames = Object.fromEntries(
      (actorProfiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? 'Unknown'])
    );
  }

  const published = (allPosts ?? []).filter(p => p.status === 'published').length;
  const drafts    = (allPosts ?? []).filter(p => p.status === 'draft').length;
  const totalPages = (allPages ?? []).length;
  const recentPosts = (allPosts ?? []).slice(0, 5);

  // Last updated = most recent updated_at across posts
  const lastUpdated = (allPosts ?? []).length > 0 ? (allPosts ?? [])[0].updated_at : null;

  const STATS = [
    { label: 'Published Posts', value: String(published), icon: FileText, delta: `${(allPosts ?? []).length} total`, color: 'var(--ne-blue)' },
    { label: 'Draft Posts', value: String(drafts), icon: Clock, delta: drafts === 1 ? '1 pending review' : `${drafts} pending review`, color: 'var(--ne-warning)' },
    { label: 'Total Pages', value: String(totalPages), icon: Eye, delta: totalPages === 0 ? 'None yet' : 'Across site', color: 'var(--ne-success)' },
    { label: 'Last Updated', value: lastUpdated ? timeAgo(lastUpdated) : '—', icon: TrendingUp, delta: lastUpdated ? fmtDate(lastUpdated) : 'No activity yet', color: '#6366f1' },
  ];

  // Task 8.2 — Content Health card, part 1: drafts aging >14 days. Posts
  // only (pages/collection-entries are out of scope — see brief: expanding
  // to collection_items would mean querying an arbitrary number of
  // collections per client, a meaningfully bigger query than this task
  // implies). `updated_at` is the "last touched" column per the
  // `handle_updated_at()` trigger convention (migration 001) — falls back to
  // `created_at` only for a row where `updated_at` somehow isn't set.
  const nowMs = Date.now();
  const agingDrafts = (allPosts ?? [])
    .filter((p) => p.status === 'draft')
    .map((p) => ({ ...p, ageDays: Math.floor((nowMs - new Date(p.updated_at ?? p.created_at).getTime()) / DAY_MS) }))
    .filter((p) => p.ageDays > DRAFT_AGE_DAYS)
    .sort((a, b) => b.ageDays - a.ageDays);

  // Part 2: the scheduled-posts queue. Same "status = 'scheduled'" set the
  // publish-scheduled cron acts on (`src/app/api/cron/publish-scheduled/route.ts`),
  // ordered soonest-first by `scheduled_at` — the ones nearest to actually
  // being published by that cron surface at the top.
  const scheduledQueue = (allPosts ?? [])
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime());

  // Part 3 (missingSeoCount) already computed above via `countMissingSeo`.

  // Task 8.2 — 30-day pageview sparkline: sum `views` across all paths per
  // `day`, filling every day in the window (including zero-view days) so the
  // sparkline's bar count always matches the day count. Mirrors
  // `dailyBucketsFromRollup` in `analytics/page.tsx`, at day-only granularity
  // (no per-bucket date label needed for this compact a visualization).
  //
  // Built with UTC date methods (`Date.UTC` + `getUTC*`), not local
  // `setHours`/`getDate`/`setDate`: `analytics_daily.day` is always a UTC
  // calendar day (written by the rollup cron via
  // `new Date(created_at).toISOString().slice(0, 10)`), and this page runs
  // as a server component. It happens to run in UTC on Vercel today, so the
  // old local-time construction produced the right answer by accident — but
  // that's fragile and inconsistent with the analytics page's client-side
  // bucketing (which runs in the browser's timezone). Using UTC here makes
  // the bucket keys correct regardless of the server's timezone.
  const sparklineNow = new Date();
  const sparklineStart = new Date(Date.UTC(
    sparklineNow.getUTCFullYear(),
    sparklineNow.getUTCMonth(),
    sparklineNow.getUTCDate() - (SPARKLINE_DAYS - 1)
  ));
  const sparklineBuckets = Array.from({ length: SPARKLINE_DAYS }, (_, i) => {
    const date = new Date(sparklineStart.getTime() + i * DAY_MS);
    return { key: date.toISOString().slice(0, 10), views: 0 };
  });
  const sparklineByDay = new Map(sparklineBuckets.map((b) => [b.key, b]));
  for (const row of dailyRows ?? []) {
    const bucket = sparklineByDay.get(row.day);
    if (bucket) bucket.views += row.views;
  }
  const sparklineTotal = sparklineBuckets.reduce((sum, b) => sum + b.views, 0);
  const sparklineMax = Math.max(1, ...sparklineBuckets.map((b) => b.views));

  return (
    <>
      <Topbar title="Dashboard" subtitle={`${clientName} · Website Overview`} />
      <div className="page-body">

        {/* Welcome banner */}
        <div className="welcome-banner" style={{
          background: 'linear-gradient(135deg, var(--ne-blue) 0%, #1E40AF 100%)',
          borderRadius: 'var(--r-lg)', padding: '28px 32px', marginBottom: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          overflow: 'hidden', position: 'relative',
        }}>
          <div style={{ position: 'absolute', right: -20, top: -20, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,.08)' }} />
          <div style={{ position: 'absolute', right: 60, bottom: -40, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,.05)' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)', marginBottom: 8 }}>
              NE Website Manager
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 8px' }}>
              Good day, {isAdmin ? 'Neu Entity team' : `${clientName} team`} 👋
            </h2>
            <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,.75)', margin: 0, maxWidth: 420 }}>
              Manage your website content from here. New posts, pages, and more — all in one place.
            </p>
          </div>
          <Link href="/cms/posts/new" className="welcome-banner-btn" style={{
            position: 'relative', zIndex: 1, whiteSpace: 'nowrap',
            background: '#fff', color: 'var(--ne-blue)', border: 'none',
            padding: '9px 20px', borderRadius: 'var(--r-sm)',
            fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 7,
            textDecoration: 'none',
          }}>
            <FileText size={15} /> New Post
          </Link>
        </div>

        {/* Stats */}
        <div className="grid-stats">
          {STATS.map((s) => {
            const Icon = s.icon;
            return (
              <div className="stat-card" key={s.label}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: s.color + '18', display: 'grid', placeItems: 'center', color: s.color }}>
                    <Icon size={18} />
                  </div>
                  <ArrowUpRight size={14} color="var(--fg3)" />
                </div>
                <div className="num">{s.value}</div>
                <div className="lbl">{s.label}</div>
                <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 6 }}>{s.delta}</div>
              </div>
            );
          })}
        </div>

        <div className="grid-2col">
          {/* Recent posts */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>Recent Posts</div>
              <Link href="/cms/posts" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>View all →</Link>
            </div>
            <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentPosts.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--fg3)', padding: '28px 16px', fontSize: 13 }}>
                      No posts yet. <Link href="/cms/posts/new" style={{ color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>Create your first post →</Link>
                    </td>
                  </tr>
                ) : recentPosts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 260 }}>
                      <Link href={`/cms/posts/${p.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 500 }}>
                        {p.title}
                      </Link>
                    </td>
                    <td><span className={`status-pill ${p.status}`}>{p.status}</span></td>
                    {/* Only trust published_at while the post is *currently* published — it can
                        hold a stale timestamp from an earlier publish after an unpublish/reschedule,
                        which would otherwise show a misleading date next to a non-"published" pill. */}
                    <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{fmtDate(p.status === 'published' ? p.published_at ?? p.created_at : p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>Quick Actions</div>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Write new blog post', href: '/cms/posts/new', color: 'var(--ne-blue)', Icon: FileText },
                { label: 'Manage pages', href: '/cms/pages', color: '#6366f1', Icon: Eye },
                { label: 'View all posts', href: '/cms/posts', color: 'var(--ne-success)', Icon: TrendingUp },
              ].map(({ label, href, color, Icon }) => (
                <Link key={label} href={href} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)', textDecoration: 'none',
                  color: 'var(--fg1)', fontSize: 13.5, fontWeight: 500,
                  transition: 'border-color .15s',
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '18', color, display: 'grid', placeItems: 'center' }}>
                    <Icon size={15} />
                  </div>
                  {label}
                  <ArrowUpRight size={13} color="var(--fg3)" style={{ marginLeft: 'auto' }} />
                </Link>
              ))}
            </div>

            {/* Powered by NE */}
            <div style={{ margin: '4px 16px 16px', padding: '14px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ne-blue)', marginBottom: 4 }}>POWERED BY NEU ENTITY</div>
              <p style={{ fontSize: 11.5, color: 'var(--fg3)', margin: 0 }}>Need help? Contact your Neu Entity account manager or visit neuentity.com</p>
            </div>
          </div>
        </div>

        {/* Recent activity + editorial review queue (Task 6.2) */}
        <div className="grid-2col">
          {/* Recent activity */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={16} color="var(--fg3)" />
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>Recent Activity</div>
            </div>
            <div style={{ padding: (activityRows ?? []).length === 0 ? '28px 16px' : 0 }}>
              {(activityRows ?? []).length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>No activity yet.</div>
              ) : (
                (activityRows ?? []).map((row, i) => (
                  <div
                    key={row.id}
                    style={{
                      padding: '12px 20px',
                      borderBottom: i === (activityRows ?? []).length - 1 ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    <div style={{ fontSize: 13, color: 'var(--fg1)', fontWeight: 500 }}>{row.summary}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>
                      {row.actor_id ? actorNames[row.actor_id] ?? 'Unknown' : 'System'} · {timeAgo(row.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Editorial review queue — admin-only (client_admin/ne_admin);
              an `editor` has no use for it, so it's simply not rendered
              for them (see ReviewQueue's own comment on why it's posts-only). */}
          {canReviewQueue && <ReviewQueue clientId={clientId ?? null} />}
        </div>

        {/* Task 8.2: content health + 30-day pageview sparkline */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr .6fr', gap: 20, marginTop: 24 }}>
          {/* Content Health */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} color="var(--fg3)" />
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>Content Health</div>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Drafts aging >14 days */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Clock size={14} color="var(--ne-warning)" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg1)' }}>Drafts aging &gt;14 days</span>
                  </div>
                  <Link href="/cms/posts" style={{ fontSize: 11.5, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>View all →</Link>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg1)' }}>{agingDrafts.length}</div>
                {agingDrafts.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--fg3)', marginTop: 4 }}>None — every draft has been touched recently.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
                    {agingDrafts.slice(0, 3).map((p) => (
                      <Link key={p.id} href={`/cms/posts/${p.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--fg2)', textDecoration: 'none' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                        <span style={{ color: 'var(--fg3)', flexShrink: 0 }}>{p.ageDays}d old</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--border)' }} />

              {/* Scheduled queue */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CalendarClock size={14} color="var(--ne-blue)" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg1)' }}>Scheduled queue</span>
                  </div>
                  <Link href="/cms/posts" style={{ fontSize: 11.5, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>View all →</Link>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg1)' }}>{scheduledQueue.length}</div>
                {scheduledQueue.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--fg3)', marginTop: 4 }}>Nothing scheduled right now.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
                    {scheduledQueue.slice(0, 3).map((p) => (
                      <Link key={p.id} href={`/cms/posts/${p.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--fg2)', textDecoration: 'none' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                        <span style={{ color: 'var(--fg3)', flexShrink: 0 }}>{fmtDateTime(p.scheduled_at)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--border)' }} />

              {/* Missing SEO metadata */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Search size={14} color="var(--ne-success)" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg1)' }}>Missing SEO metadata</span>
                  </div>
                  <Link href="/seo" style={{ fontSize: 11.5, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>Review →</Link>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg1)' }}>{missingSeoCount}</div>
                <div style={{ fontSize: 12, color: 'var(--fg3)', marginTop: 4 }}>
                  {missingSeoCount === 0 ? 'Every published post and page has an SEO title and description.' : 'Published posts/pages missing an SEO title or description.'}
                </div>
              </div>

            </div>
          </div>

          {/* 30-day pageview sparkline (Task 8.1's analytics_daily rollup) */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={16} color="var(--fg3)" />
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>Traffic</div>
              </div>
              <Link href="/analytics" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>Details →</Link>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg1)' }}>{sparklineTotal}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 16 }}>page views · last {SPARKLINE_DAYS} days</div>
              {sparklineTotal === 0 ? (
                <div style={{ color: 'var(--fg3)', fontSize: 12.5, padding: '18px 0', textAlign: 'center' }}>No page views recorded yet.</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 56 }}>
                  {sparklineBuckets.map((b) => (
                    <div
                      key={b.key}
                      title={`${b.key}: ${b.views} view${b.views === 1 ? '' : 's'}`}
                      style={{ flex: 1, height: Math.max(2, Math.round((b.views / sparklineMax) * 56)), background: 'var(--ne-blue)', borderRadius: '2px 2px 0 0' }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
