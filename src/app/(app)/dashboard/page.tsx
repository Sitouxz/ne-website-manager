import Topbar from '@/components/Topbar';
import { FileText, Eye, Clock, TrendingUp, ArrowUpRight, BarChart2, Search, Image, Mail, Megaphone, Users, Settings } from 'lucide-react';
import Link from 'next/link';

const STATS = [
  { label: 'Published Posts', value: '12', icon: FileText, delta: '+2 this week', color: 'var(--ne-blue)' },
  { label: 'Draft Posts', value: '4', icon: Clock, delta: '3 pending review', color: 'var(--ne-warning)' },
  { label: 'Total Pages', value: '7', icon: Eye, delta: 'All published', color: 'var(--ne-success)' },
  { label: 'Last Updated', value: 'Today', icon: TrendingUp, delta: '2 hours ago', color: '#6366f1' },
];

const RECENT_POSTS = [
  { title: 'Sifat Sombong Pemusnah Segalanya', status: 'published', date: '2 Jun 2026', views: 142 },
  { title: 'DO NOT LOSE HOPE IN ALLAH SWT', status: 'published', date: '28 May 2026', views: 89 },
  { title: 'Sampaikan Dengan Hikmah', status: 'draft', date: '21 May 2026', views: 0 },
  { title: 'Configuring my Tahajjud', status: 'published', date: '7 May 2026', views: 204 },
  { title: 'Ayat al-Quran Yang Buat Nabi Menangis', status: 'archived', date: '1 May 2026', views: 67 },
];

const COMING_SOON = [
  { icon: BarChart2, label: 'Analytics', desc: 'Page views, engagement, traffic sources' },
  { icon: Search, label: 'SEO Manager', desc: 'Meta tags, sitemaps, keyword tracking' },
  { icon: Image, label: 'Media Library', desc: 'Centralised image & file management' },
  { icon: Mail, label: 'Forms & Leads', desc: 'Contact forms, lead capture, submissions' },
  { icon: Megaphone, label: 'Announcements', desc: 'Push banners and site-wide notices' },
  { icon: Users, label: 'Team Members', desc: 'Manage editors, roles and permissions' },
];

export default function DashboardPage() {
  return (
    <>
      <Topbar title="Dashboard" subtitle="Al-Islah Mosque · Website Overview" />
      <div className="page-body">

        {/* Welcome banner */}
        <div style={{
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
              Good day, Al-Islah team 👋
            </h2>
            <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,.75)', margin: 0, maxWidth: 420 }}>
              Manage your website content from here. New posts, pages, and more — all in one place.
            </p>
          </div>
          <Link href="/cms/posts/new" style={{
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginBottom: 28 }}>
          {/* Recent posts */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>Recent Posts</div>
              <Link href="/cms/posts" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>View all →</Link>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Views</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_POSTS.map((p) => (
                  <tr key={p.title}>
                    <td style={{ maxWidth: 260 }}>
                      <Link href="/cms/posts" style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 500 }}>
                        {p.title}
                      </Link>
                    </td>
                    <td><span className={`status-pill ${p.status}`}>{p.status}</span></td>
                    <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{p.date}</td>
                    <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{p.views || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

        {/* Coming soon features */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--fg3)', marginBottom: 16 }}>
            Coming Soon — More Features
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {COMING_SOON.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="coming-soon-card">
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div className="cs-badge"><Clock size={10} />Coming Soon</div>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', color: 'var(--fg3)' }}>
                    <Icon size={20} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{label}</div>
                  <p style={{ fontSize: 12.5, color: 'var(--fg3)', margin: 0 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
