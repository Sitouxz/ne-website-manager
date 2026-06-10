import Topbar from '@/components/Topbar';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { BarChart2, Clock, Eye, FileText, Globe, Layers, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import type { Profile } from '@/lib/supabase/types';

const SELECTED_CLIENT_COOKIE = 'ne_selected_client_id';

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

function fmtDate(iso: string | null | undefined) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysSince(iso: string | null | undefined) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return Math.max(0, days);
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

function categoryCounts(posts: CmsPost[]) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const name = post.category?.trim() || 'Uncategorized';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function monthBuckets(posts: CmsPost[]) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const iso = post.published_at ?? post.created_at;
    if (!iso) continue;
    const date = new Date(iso);
    const key = date.toLocaleDateString('en-SG', { month: 'short', year: '2-digit' });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].slice(-8).map(([label, count]) => ({ label, count }));
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

  const posts = (postsData ?? []) as CmsPost[];
  const pages = (pagesData ?? []) as CmsPage[];
  const publishedPosts = posts.filter((post) => post.status === 'published');
  const draftPosts = posts.filter((post) => post.status === 'draft');
  const publicPages = pages.filter((page) => page.status === 'published' && page.visibility === 'public');
  const lastUpdated = [...posts.map((p) => p.updated_at), ...pages.map((p) => p.updated_at)]
    .filter(Boolean)
    .sort()
    .at(-1);
  const freshness = daysSince(lastUpdated);
  const categories = categoryCounts(posts);
  const buckets = monthBuckets(publishedPosts);
  const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <>
      <Topbar title="Analytics" subtitle={`${clientName} · CMS content health`} />
      <div className="page-body" style={{ maxWidth: 1180 }}>
        <div style={{ marginBottom: 20, background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 'var(--r-md)', padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <BarChart2 size={17} color="var(--ne-blue)" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: 12.5, color: 'var(--fg2)', margin: 0 }}>
            This view uses live CMS content only. Traffic, search, device, and conversion metrics will appear here after a real analytics provider is connected.
          </p>
        </div>

        <div className="grid-stats">
          <StatCard label="Published Posts" value={String(publishedPosts.length)} sub={`${posts.length} total posts`} icon={FileText} color="var(--ne-blue)" />
          <StatCard label="Draft Posts" value={String(draftPosts.length)} sub="Waiting to publish" icon={Clock} color="var(--ne-warning)" />
          <StatCard label="Public Pages" value={String(publicPages.length)} sub={`${pages.length} managed pages`} icon={Globe} color="var(--ne-success)" />
          <StatCard label="Last CMS Update" value={freshness === null ? '-' : `${freshness}d`} sub={fmtDate(lastUpdated)} icon={TrendingUp} color="#6366f1" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Publishing Cadence" action={<Link href="/cms/posts" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>Manage posts</Link>} />
            <div style={{ padding: 20 }}>
              {buckets.length === 0 ? (
                <div style={{ color: 'var(--fg3)', fontSize: 13, padding: '28px 0', textAlign: 'center' }}>No published post dates yet.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${buckets.length}, 1fr)`, gap: 10, alignItems: 'end', minHeight: 210 }}>
                  {buckets.map((bucket) => (
                    <div key={bucket.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg1)' }}>{bucket.count}</div>
                      <div style={{ width: '100%', height: Math.max(10, Math.round((bucket.count / maxBucket) * 150)), borderRadius: '6px 6px 0 0', background: 'var(--ne-blue)' }} />
                      <div style={{ fontSize: 11, color: 'var(--fg3)', whiteSpace: 'nowrap' }}>{bucket.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Categories" />
            <div style={{ padding: 20 }}>
              {categories.length === 0 ? (
                <div style={{ color: 'var(--fg3)', fontSize: 13, padding: '28px 0', textAlign: 'center' }}>No categories yet.</div>
              ) : categories.map((category) => (
                <div key={category.name} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg1)' }}>{category.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--fg3)' }}>{category.count}</span>
                  </div>
                  <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 99 }}>
                    <div style={{ height: '100%', width: `${Math.round((category.count / posts.length) * 100)}%`, background: 'var(--ne-blue)', borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card>
            <CardHead title="Recently Updated Posts" />
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20 }}>Title</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.slice(0, 6).length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', padding: 34, color: 'var(--fg3)' }}>No posts found.</td></tr>
                  ) : posts.slice(0, 6).map((post) => (
                    <tr key={post.id}>
                      <td style={{ paddingLeft: 20 }}>
                        <Link href={`/cms/posts/${post.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600 }}>{post.title || '(Untitled)'}</Link>
                        <div style={{ color: 'var(--fg3)', fontSize: 11.5 }}>/{post.slug}</div>
                      </td>
                      <td><span className={`status-pill ${post.status}`}>{post.status}</span></td>
                      <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{fmtDate(post.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHead title="Managed Pages" action={<Link href="/cms/pages" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>View pages</Link>} />
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20 }}>Page</th>
                    <th>Status</th>
                    <th>Visibility</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.slice(0, 6).length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', padding: 34, color: 'var(--fg3)' }}>No pages are managed by the CMS yet.</td></tr>
                  ) : pages.slice(0, 6).map((page) => (
                    <tr key={page.id}>
                      <td style={{ paddingLeft: 20 }}>
                        <div style={{ color: 'var(--fg1)', fontWeight: 600 }}>{page.title || '(Untitled)'}</div>
                        <code style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{page.path}</code>
                      </td>
                      <td><span className={`status-pill ${page.status}`}>{page.status}</span></td>
                      <td style={{ color: 'var(--fg3)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                        {page.visibility === 'public' ? <Eye size={13} /> : <Layers size={13} />}
                        {page.visibility}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
