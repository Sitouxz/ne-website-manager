import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { GET, OPTIONS } from './route';

function setSupabase(supabase: unknown) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
}

function getReq(): Request {
  return new Request('https://example.com/api/client/acme/globals');
}

const params = Promise.resolve({ slug: 'acme' });

const CLIENT = { id: 'client-1', slug: 'acme' };

const FOOTER_VALUE = { text: '© Acme Corp', links: [{ label: 'Privacy', href: '/privacy' }] };
const ANNOUNCEMENT_VALUE = { enabled: true, message: 'We are hiring!', variant: 'info' };
const THEME_VALUE = { tokens: { '--brand-primary': '#1E40AF' } };
const SOCIAL_VALUE = { instagram: 'https://instagram.com/acme' };
const CONTACT_VALUE = { email: 'hello@acme.com' };

function siteGlobalsFixtures() {
  return [
    { id: 'g-footer', client_id: 'client-1', key: 'footer', value: FOOTER_VALUE },
    { id: 'g-announcement', client_id: 'client-1', key: 'announcement', value: ANNOUNCEMENT_VALUE },
    { id: 'g-theme', client_id: 'client-1', key: 'theme', value: THEME_VALUE },
    { id: 'g-social', client_id: 'client-1', key: 'social', value: SOCIAL_VALUE },
    { id: 'g-contact', client_id: 'client-1', key: 'contact', value: CONTACT_VALUE },
    // Belongs to a different client — must never leak into client-1's response.
    { id: 'g-other', client_id: 'client-2', key: 'footer', value: { text: 'other client footer', links: [] } },
  ];
}

const TOP_ABOUT = {
  id: 'menu-about', client_id: 'client-1', location: 'public', label: 'About', icon: 'Info',
  link_type: 'url', collection_slug: null, url: '/about', parent_id: null, sort_order: 0, is_visible: true,
};
const TOP_SERVICES = {
  id: 'menu-services', client_id: 'client-1', location: 'public', label: 'Services', icon: 'Boxes',
  link_type: 'collection', collection_slug: 'services', url: null, parent_id: null, sort_order: 1, is_visible: true,
};
const CHILD_CONSULTING = {
  id: 'menu-consulting', client_id: 'client-1', location: 'public', label: 'Consulting', icon: null,
  link_type: 'url', collection_slug: null, url: '/services/consulting', parent_id: 'menu-services', sort_order: 0, is_visible: true,
};
const CHILD_DESIGN = {
  id: 'menu-design', client_id: 'client-1', location: 'public', label: 'Design', icon: null,
  link_type: 'url', collection_slug: null, url: '/services/design', parent_id: 'menu-services', sort_order: 1, is_visible: true,
};
const HIDDEN_ITEM = {
  id: 'menu-hidden', client_id: 'client-1', location: 'public', label: 'Hidden Page', icon: null,
  link_type: 'url', collection_slug: null, url: '/hidden', parent_id: null, sort_order: 2, is_visible: false,
};
const SIDEBAR_ITEM = {
  id: 'menu-sidebar', client_id: 'client-1', location: 'cms_sidebar', label: 'CMS Only', icon: null,
  link_type: 'url', collection_slug: null, url: '/cms-only', parent_id: null, sort_order: 0, is_visible: true,
};
const OTHER_CLIENT_ITEM = {
  id: 'menu-other', client_id: 'client-2', location: 'public', label: 'Other client nav', icon: null,
  link_type: 'url', collection_slug: null, url: '/other', parent_id: null, sort_order: 0, is_visible: true,
};
// A hidden top-level parent whose child is still marked visible — the child
// must NOT appear anywhere in the response (neither nested nor promoted to
// top level). See Finding 1 (orphaned-children bug).
const HIDDEN_PARENT = {
  id: 'menu-hidden-parent', client_id: 'client-1', location: 'public', label: 'Hidden Parent', icon: null,
  link_type: 'url', collection_slug: null, url: '/hidden-parent', parent_id: null, sort_order: 3, is_visible: false,
};
const CHILD_OF_HIDDEN_PARENT = {
  id: 'menu-child-of-hidden-parent', client_id: 'client-1', location: 'public', label: 'Orphan Child', icon: null,
  link_type: 'url', collection_slug: null, url: '/hidden-parent/child', parent_id: 'menu-hidden-parent', sort_order: 0, is_visible: true,
};
// A 3-level chain: visible grandparent -> hidden parent -> visible
// grandchild. The grandchild must also be excluded, even though the
// grandparent is visible, because its immediate parent is hidden.
const CHAIN_GRANDPARENT = {
  id: 'menu-chain-grandparent', client_id: 'client-1', location: 'public', label: 'Chain Grandparent', icon: null,
  link_type: 'url', collection_slug: null, url: '/chain', parent_id: null, sort_order: 4, is_visible: true,
};
const CHAIN_HIDDEN_MIDDLE = {
  id: 'menu-chain-hidden-middle', client_id: 'client-1', location: 'public', label: 'Chain Hidden Middle', icon: null,
  link_type: 'url', collection_slug: null, url: '/chain/middle', parent_id: 'menu-chain-grandparent', sort_order: 0, is_visible: false,
};
const CHAIN_VISIBLE_GRANDCHILD = {
  id: 'menu-chain-visible-grandchild', client_id: 'client-1', location: 'public', label: 'Chain Visible Grandchild', icon: null,
  link_type: 'url', collection_slug: null, url: '/chain/middle/grandchild', parent_id: 'menu-chain-hidden-middle', sort_order: 0, is_visible: true,
};

function menuItemsFixtures() {
  return [
    TOP_ABOUT, TOP_SERVICES, CHILD_CONSULTING, CHILD_DESIGN, HIDDEN_ITEM, SIDEBAR_ITEM, OTHER_CLIENT_ITEM,
    HIDDEN_PARENT, CHILD_OF_HIDDEN_PARENT, CHAIN_GRANDPARENT, CHAIN_HIDDEN_MIDDLE, CHAIN_VISIBLE_GRANDCHILD,
  ];
}

/** Recursively flattens a navigation tree's node ids (parents + all descendants). */
function flattenIds(nodes: { id: string; children?: unknown[] }[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    ids.push(n.id);
    ids.push(...flattenIds((n.children ?? []) as { id: string; children?: unknown[] }[]));
  }
  return ids;
}

function fixtures() {
  return {
    clients: [CLIENT],
    site_globals: siteGlobalsFixtures(),
    menu_items: menuItemsFixtures(),
  };
}

describe('GET /api/client/[slug]/globals — misc', () => {
  it('returns 404 when the client slug does not exist', async () => {
    setSupabase(mockSupabase({ clients: [], site_globals: [], menu_items: [] }));

    const res = await GET(getReq(), { params });

    expect(res.status).toBe(404);
  });

  it('sets CORS header on the response', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('OPTIONS responds 204 with CORS headers', async () => {
    const res = await OPTIONS();

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

describe('GET /api/client/[slug]/globals — site_globals merge', () => {
  it('merges each reserved key as a top-level property of the response, scoped to the resolved client only', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.footer).toEqual(FOOTER_VALUE);
    expect(body.announcement).toEqual(ANNOUNCEMENT_VALUE);
    expect(body.theme).toEqual(THEME_VALUE);
    expect(body.social).toEqual(SOCIAL_VALUE);
    expect(body.contact).toEqual(CONTACT_VALUE);
    // The other client's footer row must never leak through.
    expect(body.footer.text).not.toBe('other client footer');
  });

  it('omits keys the client has no row for, rather than inventing defaults', async () => {
    setSupabase(mockSupabase({
      clients: [CLIENT],
      site_globals: [{ id: 'g-footer', client_id: 'client-1', key: 'footer', value: FOOTER_VALUE }],
      menu_items: [],
    }));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.footer).toEqual(FOOTER_VALUE);
    expect(body.announcement).toBeUndefined();
    expect(body.theme).toBeUndefined();
  });
});

describe('GET /api/client/[slug]/globals — navigation tree', () => {
  it('builds a nested navigation array from menu_items, attaching children to their parent via parent_id', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(Array.isArray(body.navigation)).toBe(true);

    const services = body.navigation.find((n: { id: string }) => n.id === 'menu-services');
    expect(services).toBeDefined();
    expect(services.children).toHaveLength(2);
    expect(services.children.map((c: { id: string }) => c.id)).toEqual(['menu-consulting', 'menu-design']);

    const about = body.navigation.find((n: { id: string }) => n.id === 'menu-about');
    expect(about.children).toEqual([]);
  });

  it('only includes location=public AND is_visible=true items, excluding hidden items, cms_sidebar items, and other clients', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    const allIds = flattenIds(body.navigation);

    expect(allIds).not.toContain('menu-hidden');
    expect(allIds).not.toContain('menu-sidebar');
    expect(allIds).not.toContain('menu-other');
  });

  it('orders top-level items by sort_order ascending', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.navigation.map((n: { id: string }) => n.id)).toEqual([
      'menu-about', 'menu-services', 'menu-chain-grandparent',
    ]);
  });

  it('returns an empty navigation array when the client has no public menu items', async () => {
    setSupabase(mockSupabase({ clients: [CLIENT], site_globals: [], menu_items: [] }));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.navigation).toEqual([]);
  });

  it('Finding 1 regression: a hidden parent excludes its visible child entirely — not nested, not promoted to top level', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    const allIds = flattenIds(body.navigation);

    // The hidden parent itself must not appear.
    expect(allIds).not.toContain('menu-hidden-parent');
    // Its visible child must not appear either — neither nested under the
    // (excluded) parent, nor promoted to top-level navigation.
    expect(allIds).not.toContain('menu-child-of-hidden-parent');
    expect(body.navigation.some((n: { id: string }) => n.id === 'menu-child-of-hidden-parent')).toBe(false);
  });

  it('regression: a visible child of a visible parent still appears correctly nested', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    const services = body.navigation.find((n: { id: string }) => n.id === 'menu-services');
    expect(services).toBeDefined();
    expect(services.children.map((c: { id: string }) => c.id)).toEqual(['menu-consulting', 'menu-design']);
  });

  it('Finding 1: a 3-level chain (visible grandparent -> hidden parent -> visible grandchild) excludes the grandchild too', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    const grandparent = body.navigation.find((n: { id: string }) => n.id === 'menu-chain-grandparent');
    // The grandparent itself is visible, so it appears...
    expect(grandparent).toBeDefined();
    // ...but its hidden child (and therefore that child's own visible child,
    // the grandchild) must not appear anywhere in the tree.
    const allIds = flattenIds(body.navigation);
    expect(allIds).not.toContain('menu-chain-hidden-middle');
    expect(allIds).not.toContain('menu-chain-visible-grandchild');
    expect(grandparent.children).toEqual([]);
  });
});
