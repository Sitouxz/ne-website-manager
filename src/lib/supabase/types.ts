import type { FieldDef } from '@/lib/collections/types';

export type Role = 'ne_admin' | 'client_admin' | 'editor';
export type PostStatus = 'draft' | 'in_review' | 'scheduled' | 'published' | 'archived';
export type PageStatus = 'draft' | 'published';
export type PropertyStatus = 'active' | 'archived';
export type ListingType = 'sale' | 'rent';
export type Segment = 'Prime' | 'City fringe' | 'Suburban';

export interface Client {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  deploy_hook: string | null;
  github_repo: string | null;
  plan: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  client_id: string | null;
  role: Role;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  clients?: Client;
}

export interface Post {
  id: string;
  client_id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  cover_url: string | null;
  category: string;
  tags: string[];
  status: PostStatus;
  seo_title: string | null;
  seo_description: string | null;
  content_json: Record<string, unknown> | null;
  scheduled_at: string | null;
  author_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  client_id: string;
  title: string;
  path: string;
  content: string;
  status: PageStatus;
  visibility: 'public' | 'private';
  content_json: Record<string, unknown> | null;
  seo_title: string | null;
  seo_description: string | null;
  updated_at: string;
}

export interface PropertyHighlight { label: string; body: string; }
export interface PropertyGalleryItem { src: string; alt: string; }
export interface PropertyTour { src: string; poster: string; label: string; description: string; duration?: string; }

export interface Property {
  id: string;
  client_id: string;
  slug: string;
  name: string;
  address: string;
  area: string;
  district: string;
  listing: ListingType;
  segment: Segment;
  property_type: string;
  tenure: string;
  bedrooms: number;
  bathrooms: number;
  price: number | null;
  psf: number | null;
  size_sqft: number | null;
  completion_year: number | null;
  furnishing: string | null;
  tagline: string;
  story: string;
  location_note: string;
  highlights: PropertyHighlight[];
  connectivity: string[];
  amenities: string[];
  hero_url: string;
  hero_alt: string;
  gallery: PropertyGalleryItem[];
  available: string | null;
  tour: PropertyTour | null;
  source_url: string | null;
  status: PropertyStatus;
  seo_title: string | null;
  seo_description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Revision {
  id: string;
  client_id: string;
  entity_type: string;
  entity_id: string;
  snapshot: Record<string, unknown>;
  author_id: string | null;
  created_at: string;
}

export interface PreviewToken {
  id: string;
  client_id: string;
  entity_type: string;
  entity_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export type CollectionStorage = 'generic' | 'native';
export type CollectionItemStatus = 'draft' | 'published' | 'archived';

export interface Collection {
  id: string;
  client_id: string | null; // null = global/system template (out of scope for Phase 4 UI)
  slug: string;
  name: string;
  name_singular: string;
  icon: string | null;
  description: string | null;
  storage: CollectionStorage; // Phase 4 only builds 'generic'
  native_table: 'posts' | 'pages' | 'properties' | null;
  fields: FieldDef[]; // this repo's contract, schema column is JSONB
  options: CollectionOptions;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionOptions {
  title_field?: string; // FieldDef.key whose value is shown as the item's display title (no denormalized title column exists)
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  client_id: string;
  slug: string;
  status: CollectionItemStatus;
  data: Record<string, unknown>; // keyed by FieldDef.key
  sort_order: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MenuItemLocation = 'cms_sidebar' | 'public';
export type MenuItemLinkType = 'collection' | 'url' | 'custom';

export interface MenuItem {
  id: string;
  client_id: string;
  location: MenuItemLocation;
  label: string;
  icon: string | null;
  link_type: MenuItemLinkType;
  collection_slug: string | null;
  url: string | null;
  parent_id: string | null;
  sort_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * `public.site_globals` DB row. `key`/`value` are typed loosely here
 * (`string` / `Record<string, unknown>`) since this is the raw row shape;
 * the per-reserved-key `value` contract (`FooterGlobal`, `AnnouncementGlobal`,
 * etc.) lives in `src/lib/globals/types.ts`, mirroring how `Collection.fields`
 * is typed here as `FieldDef[]` from `src/lib/collections/types.ts`.
 */
export interface SiteGlobal {
  id: string;
  client_id: string;
  key: string;
  value: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
