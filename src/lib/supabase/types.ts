export type Role = 'ne_admin' | 'client_admin' | 'editor';
export type PostStatus = 'draft' | 'published' | 'archived';
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

// =============================================================
// Collections engine — flexible, no-code content types
// =============================================================

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'media'
  | 'url'
  | 'json';

export interface FieldChoice { label: string; value: string; }

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  default?: unknown;
  showInList?: boolean;
  options?: {
    choices?: FieldChoice[];
    subFields?: FieldDef[];
  };
}

export type CollectionStorage = 'generic' | 'native';
export type NativeTable = 'posts' | 'pages' | 'properties';

export interface CollectionOptions {
  hasStatus: boolean;
  statusValues: string[];
  titleField: string;
  slugField: string;
  listColumns: string[];
  publishedFilter?: Record<string, unknown>;
}

export interface Collection {
  id: string;
  client_id: string | null;
  slug: string;
  name: string;
  name_singular: string;
  icon: string;
  description: string;
  storage: CollectionStorage;
  native_table: NativeTable | null;
  fields: FieldDef[];
  options: CollectionOptions;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type CollectionItemStatus = 'draft' | 'published' | 'archived';

export interface CollectionItem {
  id: string;
  collection_id: string;
  client_id: string;
  slug: string;
  status: CollectionItemStatus;
  data: Record<string, unknown>;
  sort_order: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MenuLocation = 'cms_sidebar' | 'public';
export type MenuLinkType = 'collection' | 'url' | 'custom';

export interface MenuItem {
  id: string;
  client_id: string;
  location: MenuLocation;
  label: string;
  icon: string | null;
  link_type: MenuLinkType;
  collection_slug: string | null;
  url: string | null;
  parent_id: string | null;
  sort_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuTree extends MenuItem {
  children: MenuTree[];
}
