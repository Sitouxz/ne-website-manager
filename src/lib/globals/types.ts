/**
 * Pure feature types for Phase 5 "Site Control" (Task 5.1) — split out from
 * `src/lib/supabase/types.ts` the same way `src/lib/collections/types.ts`
 * separates `FieldDef`/`FieldType` (a feature-level contract) from the DB
 * row types (`Collection`, `CollectionItem`, which live in
 * `src/lib/supabase/types.ts`). Following that precedent: `MenuItem` (the
 * `public.menu_items` DB row) and `SiteGlobal` (the `public.site_globals`
 * DB row) live in `src/lib/supabase/types.ts` alongside `Collection`/
 * `CollectionItem`; this file holds the derived `MenuItemNode` tree type
 * plus the per-key `value` JSONB contract for `site_globals` (documented
 * live in `supabase/migrations/009_site_globals.sql`).
 */

import type { MenuItem } from '@/lib/supabase/types';

/**
 * `MenuItem` nested into a tree via `parent_id` — used by the public
 * `/api/client/[slug]/globals` route's `navigation` array and by the
 * `cms/navigation` tree editor. `children` is only ever populated one level
 * deep (this app's nav editor UI is deliberately two-level — see
 * `src/app/(app)/cms/navigation/page.tsx` for the reasoning) but the type
 * itself is recursive since the underlying schema supports arbitrary depth.
 */
export interface MenuItemNode extends MenuItem {
  children: MenuItemNode[];
}

// ---------------------------------------------------------------------------
// `site_globals.value` JSONB shapes, keyed by `site_globals.key`.
// ---------------------------------------------------------------------------

export interface FooterLink {
  label: string;
  href: string;
}

/** `key: 'footer'` */
export interface FooterGlobal {
  text: string;
  links: FooterLink[];
}

export type AnnouncementVariant = 'info' | 'success' | 'warning';

/** `key: 'announcement'` */
export interface AnnouncementGlobal {
  enabled: boolean;
  message: string;
  href?: string;
  variant: AnnouncementVariant;
  starts_at?: string;
  ends_at?: string;
}

/**
 * `key: 'theme'` — free-form CSS custom-property overrides a client site
 * could apply (e.g. `{ '--brand-primary': '#1E40AF' }`). This task only
 * provides CRUD for these key/value pairs; nothing in this app consumes or
 * validates the CSS variable names/values beyond storing them.
 */
export interface ThemeGlobal {
  tokens: Record<string, string>;
}

/**
 * `key: 'social'` — platform name -> URL. Deliberately free-form (no fixed
 * platform list/enum) since different clients need different platforms.
 */
export type SocialGlobal = Record<string, string>;

/** `key: 'contact'` */
export interface ContactGlobal {
  email?: string;
  phone?: string;
  address?: string;
}

export type ReservedGlobalKey = 'footer' | 'announcement' | 'theme' | 'social' | 'contact';

/** Maps each reserved `site_globals.key` to its `value` JSONB shape. */
export interface GlobalValueByKey {
  footer: FooterGlobal;
  announcement: AnnouncementGlobal;
  theme: ThemeGlobal;
  social: SocialGlobal;
  contact: ContactGlobal;
}

export const DEFAULT_FOOTER: FooterGlobal = { text: '', links: [] };
export const DEFAULT_ANNOUNCEMENT: AnnouncementGlobal = { enabled: false, message: '', variant: 'info' };
export const DEFAULT_THEME: ThemeGlobal = { tokens: {} };
export const DEFAULT_SOCIAL: SocialGlobal = {};
export const DEFAULT_CONTACT: ContactGlobal = {};
