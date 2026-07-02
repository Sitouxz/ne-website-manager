'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  LayoutDashboard, FileText, FileEdit, Image, BarChart2,
  Search, Users, Settings, Megaphone, Mail,
  ChevronDown, LogOut, Globe, ShieldCheck, Home,
} from 'lucide-react';
import type { Client, Role } from '@/lib/supabase/types';

type NavItem = { label: string; href: string; icon: React.ElementType; soon?: boolean };
type NavGroup = { section: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    section: 'Main',
    items: [
      { label: 'Dashboard',  href: '/dashboard',  icon: LayoutDashboard },
      { label: 'Analytics',  href: '/analytics',  icon: BarChart2 },
    ],
  },
  {
    section: 'Content',
    items: [
      { label: 'Blog Posts',    href: '/cms/posts',      icon: FileText },
      { label: 'Properties',    href: '/cms/properties', icon: Home },
      { label: 'Pages',         href: '/cms/pages',      icon: FileEdit },
      { label: 'Media Library', href: '/cms/media',      icon: Image },
    ],
  },
  {
    section: 'Tools',
    items: [
      { label: 'SEO Manager',   href: '/seo',           icon: Search,    soon: true },
      { label: 'Forms & Leads', href: '/forms',         icon: Mail,      soon: true },
      { label: 'Announcements', href: '/announcements', icon: Megaphone, soon: true },
    ],
  },
  {
    section: 'Settings',
    items: [
      { label: 'Site Settings', href: '/settings', icon: Settings },
      { label: 'Team Members',  href: '/team',     icon: Users,   soon: true },
    ],
  },
];

const ADMIN_NAV: NavGroup = {
  section: 'NE Admin',
  items: [
    { label: 'All Clients', href: '/admin', icon: ShieldCheck },
  ],
};

export default function Sidebar({
  clientName = 'Website Manager',
  clients = [],
  selectedClientId = null,
  role = 'editor',
  isOpen = false,
  onClose,
}: {
  clientName?: string;
  clients?: Client[];
  selectedClientId?: string | null;
  role?: Role;
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const path   = usePathname();
  const router = useRouter();
  const isAdmin = role === 'ne_admin';

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function handleClientChange(id: string) {
    document.cookie = `ne_selected_client_id=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const allNav = isAdmin ? [...NAV, ADMIN_NAV] : NAV;

  return (
    <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo-ne.png" alt="Neu Entity" style={{ height: 36, width: 'auto', flexShrink: 0, display: 'block' }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--fg1)', lineHeight: 1.1 }}>Website Manager</div>
            <div style={{ fontSize: 10, color: 'var(--fg3)', marginTop: 2 }}>by Neu Entity</div>
          </div>
        </div>

        {/* Client selector */}
        <div style={{
          marginTop: 14, padding: '9px 12px', background: 'var(--surface-2)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
          border: '1px solid var(--border)',
        }}>
          <Globe size={14} color="var(--fg3)" />
          {isAdmin && clients.length > 0 ? (
            <select
              value={selectedClientId ?? ''}
              onChange={(event) => handleClientChange(event.target.value)}
              aria-label="Select client"
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                background: 'transparent',
                color: 'var(--fg1)',
                fontSize: 12,
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          ) : (
            <>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {clientName}
              </span>
              <ChevronDown size={13} color="var(--fg3)" />
            </>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, paddingBottom: 16 }}>
        {allNav.map((group) => (
          <div key={group.section}>
            <div className="sidebar-section-label">{group.section}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = path === item.href || path.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={'soon' in item && item.soon ? '#' : item.href}
                  className={`sidebar-link${active ? ' active' : ''}`}
                  style={'soon' in item && item.soon ? { opacity: 0.5, cursor: 'default' } : {}}
                  onClick={'soon' in item && item.soon ? (e) => e.preventDefault() : () => onClose?.()}
                >
                  <Icon size={16} />
                  {item.label}
                  {'soon' in item && item.soon && <span className="badge-cs">Soon</span>}
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
          }}>
            {isAdmin ? 'NE' : 'A'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isAdmin ? 'Neu Entity' : 'Admin'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg3)' }}>
              {isAdmin ? 'Super Admin' : 'Content Manager'}
            </div>
          </div>
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4 }}>
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
