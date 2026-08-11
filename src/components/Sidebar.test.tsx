import { describe, expect, it } from 'vitest';
import { Boxes, FileText, Navigation } from 'lucide-react';
import { canShowSidebarItem, type NavItem } from './Sidebar';
import type { ClientCapabilities, Role } from '@/lib/supabase/types';

const CAPABILITIES: ClientCapabilities = {
  posts: true,
  pages: true,
  properties: false,
  media: true,
  collections: true,
  navigation: true,
  forms: true,
  announcements: true,
  analytics: true,
  social: true,
  seo: true,
  team: true,
};

function visible(item: NavItem, role: Role, overrides: Partial<ClientCapabilities> = {}) {
  return canShowSidebarItem(item, role, { ...CAPABILITIES, ...overrides });
}

describe('role-aware sidebar navigation', () => {
  const post: NavItem = { label: 'Blog posts', href: '/cms/posts', icon: FileText, capability: 'posts' };
  const collectionSetup: NavItem = {
    label: 'Collection setup',
    href: '/cms/collections',
    icon: Boxes,
    capability: 'collections',
    access: 'operator',
  };
  const websiteNavigation: NavItem = {
    label: 'Website navigation',
    href: '/cms/navigation',
    icon: Navigation,
    capability: 'navigation',
    access: 'manager',
  };

  it('keeps ordinary content modules available to editors', () => {
    expect(visible(post, 'editor')).toBe(true);
  });

  it('reserves the generic collection schema builder for NE operators', () => {
    expect(visible(collectionSetup, 'ne_admin')).toBe(true);
    expect(visible(collectionSetup, 'client_admin')).toBe(false);
    expect(visible(collectionSetup, 'editor')).toBe(false);
  });

  it('lets client admins arrange supported website navigation but keeps it out of editor task lists', () => {
    expect(visible(websiteNavigation, 'ne_admin')).toBe(true);
    expect(visible(websiteNavigation, 'client_admin')).toBe(true);
    expect(visible(websiteNavigation, 'editor')).toBe(false);
  });

  it('honours site capabilities for every role', () => {
    expect(visible(collectionSetup, 'ne_admin', { collections: false })).toBe(false);
    expect(visible(websiteNavigation, 'ne_admin', { navigation: false })).toBe(false);
    expect(visible(post, 'editor', { posts: false })).toBe(false);
  });
});
