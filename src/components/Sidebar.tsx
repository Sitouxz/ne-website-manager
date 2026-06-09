'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, FileText, FileEdit, Image, BarChart2,
  Search, Users, Settings, Megaphone, Mail,
  ChevronDown, LogOut, Globe,
} from 'lucide-react';

const NAV = [
  {
    section: 'Main',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    section: 'Content',
    items: [
      { label: 'Blog Posts', href: '/cms/posts', icon: FileText },
      { label: 'Pages', href: '/cms/pages', icon: FileEdit },
      { label: 'Media Library', href: '/cms/media', icon: Image, soon: true },
    ],
  },
  {
    section: 'Tools',
    items: [
      { label: 'SEO Manager', href: '/seo', icon: Search, soon: true },
      { label: 'Analytics', href: '/analytics', icon: BarChart2, soon: true },
      { label: 'Forms & Leads', href: '/forms', icon: Mail, soon: true },
      { label: 'Announcements', href: '/announcements', icon: Megaphone, soon: true },
    ],
  },
  {
    section: 'Settings',
    items: [
      { label: 'Team Members', href: '/team', icon: Users, soon: true },
      { label: 'Site Settings', href: '/settings', icon: Settings, soon: true },
    ],
  },
];

export default function Sidebar({ clientName = 'Al-Islah Mosque' }: { clientName?: string }) {
  const path = usePathname();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* NE logo mark */}
          <div style={{
            width: 34, height: 34, borderRadius: 8,
            background: 'var(--ne-blue)',
            display: 'grid', placeItems: 'center',
            fontWeight: 900, fontSize: 13, color: '#fff', letterSpacing: '-.5px',
            flexShrink: 0,
          }}>NE</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--fg1)', lineHeight: 1.1 }}>Website Manager</div>
            <div style={{ fontSize: 10, color: 'var(--fg3)', marginTop: 2 }}>by Neu Entity</div>
          </div>
        </div>

        {/* Client selector */}
        <div style={{
          marginTop: 14, padding: '9px 12px', background: 'var(--surface-2)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          border: '1px solid var(--border)',
        }}>
          <Globe size={14} color="var(--fg3)" />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {clientName}
          </span>
          <ChevronDown size={13} color="var(--fg3)" />
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, paddingBottom: 16 }}>
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="sidebar-section-label">{group.section}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = path === item.href || path.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.soon ? '#' : item.href}
                  className={`sidebar-link${active ? ' active' : ''}`}
                  style={item.soon ? { opacity: 0.5, cursor: 'default' } : {}}
                  onClick={item.soon ? (e) => e.preventDefault() : undefined}
                >
                  <Icon size={16} />
                  {item.label}
                  {item.soon && <span className="badge-cs">Soon</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--ne-blue-bg)',
            border: '1.5px solid var(--ne-blue-muted)',
            display: 'grid', placeItems: 'center',
            fontSize: 13, fontWeight: 700, color: 'var(--ne-blue)',
          }}>A</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Admin</div>
            <div style={{ fontSize: 10, color: 'var(--fg3)' }}>Content Manager</div>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4 }}>
            <LogOut size={15} />
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--fg3)', textAlign: 'center' }}>
          Powered by{' '}
          <a href="https://neuentity.com" target="_blank" rel="noopener" style={{ color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>
            Neu Entity
          </a>
        </div>
      </div>
    </aside>
  );
}
