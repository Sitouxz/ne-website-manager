'use client';

import NextImage from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  BarChart2,
  Boxes,
  FileEdit,
  FileText,
  Globe,
  Home,
  Image,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Navigation,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sliders,
  Users,
} from 'lucide-react';
import type { Client, ClientCapabilities, Collection, Role } from '@/lib/supabase/types';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';

type Capability = keyof ClientCapabilities;
export type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  capability?: Capability;
  access?: 'everyone' | 'manager' | 'operator';
};
type NavGroup = { section: string; items: NavItem[] };

const NAVIGATION: NavGroup[] = [
  { section: 'Workspace', items: [{ label: 'Home', href: '/dashboard', icon: LayoutDashboard }] },
  {
    section: 'Content',
    items: [
      { label: 'Blog posts', href: '/cms/posts', icon: FileText, capability: 'posts' },
      { label: 'Pages', href: '/cms/pages', icon: FileEdit, capability: 'pages' },
      { label: 'Properties', href: '/cms/properties', icon: Home, capability: 'properties' },
      { label: 'Collection setup', href: '/cms/collections', icon: Boxes, capability: 'collections', access: 'operator' },
    ],
  },
  {
    section: 'Structure',
    items: [
      { label: 'Website navigation', href: '/cms/navigation', icon: Navigation, capability: 'navigation', access: 'manager' },
      { label: 'Media', href: '/cms/media', icon: Image, capability: 'media' },
      { label: 'Forms', href: '/forms', icon: Mail, capability: 'forms' },
    ],
  },
  {
    section: 'Measure',
    items: [
      { label: 'Analytics', href: '/analytics', icon: BarChart2, capability: 'analytics', access: 'manager' },
      { label: 'Social', href: '/social', icon: Share2, capability: 'social', access: 'manager' },
      { label: 'SEO', href: '/seo', icon: Search, capability: 'seo', access: 'manager' },
    ],
  },
  {
    section: 'Configure',
    items: [
      { label: 'Announcements', href: '/announcements', icon: Megaphone, capability: 'announcements' },
      { label: 'Site details', href: '/settings/globals', icon: Sliders, access: 'manager' },
      { label: 'Team members', href: '/team', icon: Users, capability: 'team', access: 'manager' },
      { label: 'Settings', href: '/settings', icon: Settings, access: 'manager' },
    ],
  },
];

export function canShowSidebarItem(item: NavItem, role: Role, capabilities: ClientCapabilities) {
  if (item.capability && !capabilities[item.capability]) return false;
  if (item.access === 'operator') return role === 'ne_admin';
  if (item.access === 'manager') return role !== 'editor';
  return true;
}

export default function Sidebar({
  clientName = 'Website Manager',
  clients = [],
  selectedClientId = null,
  role = 'editor',
  isOpen = false,
  onClose,
  genericCollections = [],
  capabilities,
}: {
  clientName?: string;
  clients?: Client[];
  selectedClientId?: string | null;
  role?: Role;
  isOpen?: boolean;
  onClose?: () => void;
  genericCollections?: Pick<Collection, 'id' | 'name'>[];
  capabilities: ClientCapabilities;
}) {
  const path = usePathname();
  const router = useRouter();
  const isAdmin = role === 'ne_admin';
  const groups: NavGroup[] = isAdmin
    ? [...NAVIGATION, { section: 'NE Admin', items: [{ label: 'All clients', href: '/admin', icon: ShieldCheck }] }]
    : NAVIGATION;

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function handleClientChange(id: string) {
    document.cookie = `ne_selected_client_id=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`} aria-label="Primary navigation">
      <div className="sidebar-logo">
        <div className="sidebar-brand">
          <NextImage src="/logo-ne.png" alt="Neu Entity" width={38} height={38} priority />
          <span><strong>Website Manager</strong><small>by Neu Entity</small></span>
        </div>
        {isAdmin && clients.length > 1 ? (
          <WorkspaceSwitcher
            clients={clients}
            selectedClientId={selectedClientId}
            clientName={clientName}
            onSelect={handleClientChange}
          />
        ) : (
          // One workspace is a fact, not a choice — showing a menu that can
          // only ever resolve to the current client is a dead affordance.
          <div className="workspace-switcher ws-static">
            <Globe size={15} aria-hidden="true" />
            <span title={clientName}>{clientName}</span>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {groups.map((group) => {
          const items = group.items.filter((item) =>
            canShowSidebarItem(item, role, capabilities),
          );
          if (!items.length) return null;
          return (
            <div key={group.section} className="sidebar-group">
              <div className="sidebar-section-label">{group.section}</div>
              {items.map((item) => {
                const Icon = item.icon;
                const active = path === item.href || path.startsWith(`${item.href}/`);
                return (
                  <Link key={item.href} href={item.href} className={`sidebar-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClose}>
                    <Icon size={17} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
              {group.section === 'Content' && capabilities.collections && genericCollections.map((collection) => {
                const href = `/cms/collections/${collection.id}`;
                const active = path === href || path.startsWith(`${href}/`);
                return (
                  <Link key={collection.id} href={href} className={`sidebar-link${isAdmin ? ' sidebar-child-link' : ''}${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClose}>
                    <Boxes size={15} />
                    <span>{collection.name}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-account">
          <span className="sidebar-avatar">{isAdmin ? 'NE' : 'A'}</span>
          <span><strong>{isAdmin ? 'Neu Entity' : 'Client team'}</strong><small>{isAdmin ? 'Administrator' : role.replace('_', ' ')}</small></span>
          <button onClick={handleLogout} aria-label="Log out" title="Log out"><LogOut size={17} /></button>
        </div>
      </div>
    </aside>
  );
}
