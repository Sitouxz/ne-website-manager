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
