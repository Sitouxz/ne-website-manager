import type { SupabaseClient } from '@supabase/supabase-js';
import type { Collection, CollectionOptions, FieldDef, NativeTable } from '@/lib/supabase/types';

const EPOCH = new Date(0).toISOString();

function systemCollection(input: {
  slug: string;
  name: string;
  nameSingular: string;
  icon: string;
  description: string;
  nativeTable: NativeTable;
  fields: FieldDef[];
  options: CollectionOptions;
}): Collection {
  return {
    id: `system:${input.slug}`,
    client_id: null,
    slug: input.slug,
    name: input.name,
    name_singular: input.nameSingular,
    icon: input.icon,
    description: input.description,
    storage: 'native',
    native_table: input.nativeTable,
    fields: input.fields,
    options: input.options,
    is_system: true,
    sort_order: 0,
    created_at: EPOCH,
    updated_at: EPOCH,
  };
}

export const POSTS_COLLECTION: Collection = systemCollection({
  slug: 'posts',
  name: 'Blog Posts',
  nameSingular: 'Post',
  icon: 'FileText',
  description: 'Blog articles and news updates.',
  nativeTable: 'posts',
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, showInList: true },
    { key: 'slug', label: 'Slug', type: 'text', required: true },
    { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
    { key: 'content', label: 'Content', type: 'richtext' },
    { key: 'cover_url', label: 'Cover Image', type: 'media' },
    { key: 'category', label: 'Category', type: 'text', showInList: true },
    { key: 'tags', label: 'Tags', type: 'multiselect' },
    { key: 'seo_title', label: 'SEO Title', type: 'text' },
    { key: 'seo_description', label: 'SEO Description', type: 'textarea' },
  ],
  options: {
    hasStatus: true,
    statusValues: ['draft', 'published', 'archived'],
    titleField: 'title',
    slugField: 'slug',
    listColumns: ['title', 'category', 'status'],
    publishedFilter: { status: 'published' },
  },
});

export const PAGES_COLLECTION: Collection = systemCollection({
  slug: 'pages',
  name: 'Pages',
  nameSingular: 'Page',
  icon: 'FileEdit',
  description: 'CMS-managed static pages.',
  nativeTable: 'pages',
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, showInList: true },
    { key: 'path', label: 'URL Path', type: 'text', required: true, showInList: true },
    { key: 'content', label: 'Content', type: 'richtext' },
    {
      key: 'visibility',
      label: 'Visibility',
      type: 'select',
      options: { choices: [{ label: 'Public', value: 'public' }, { label: 'Private', value: 'private' }] },
    },
  ],
  options: {
    hasStatus: true,
    statusValues: ['draft', 'published'],
    titleField: 'title',
    slugField: 'path',
    listColumns: ['title', 'path', 'status'],
    publishedFilter: { status: 'published', visibility: 'public' },
  },
});

export const PROPERTIES_COLLECTION: Collection = systemCollection({
  slug: 'properties',
  name: 'Properties',
  nameSingular: 'Property',
  icon: 'Home',
  description: 'Real-estate listings for sale or rent.',
  nativeTable: 'properties',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, showInList: true },
    { key: 'slug', label: 'Slug', type: 'text', required: true },
    { key: 'address', label: 'Address', type: 'text' },
    { key: 'area', label: 'Area', type: 'text' },
    { key: 'district', label: 'District', type: 'text' },
    {
      key: 'listing', label: 'Listing Type', type: 'select', showInList: true,
      options: { choices: [{ label: 'For Sale', value: 'sale' }, { label: 'For Rent', value: 'rent' }] },
    },
    {
      key: 'segment', label: 'Segment', type: 'select',
      options: { choices: [{ label: 'Prime', value: 'Prime' }, { label: 'City fringe', value: 'City fringe' }, { label: 'Suburban', value: 'Suburban' }] },
    },
    { key: 'property_type', label: 'Property Type', type: 'text' },
    { key: 'tenure', label: 'Tenure', type: 'text' },
    { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
    { key: 'bathrooms', label: 'Bathrooms', type: 'number' },
    { key: 'price', label: 'Price (SGD)', type: 'number', showInList: true },
    { key: 'psf', label: 'PSF (SGD)', type: 'number' },
    { key: 'size_sqft', label: 'Size (sqft)', type: 'number' },
    { key: 'completion_year', label: 'Completion Year', type: 'number' },
    { key: 'furnishing', label: 'Furnishing', type: 'text' },
    { key: 'tagline', label: 'Tagline', type: 'text' },
    { key: 'story', label: 'Story', type: 'textarea' },
    { key: 'location_note', label: 'Location Note', type: 'textarea' },
    {
      key: 'highlights', label: 'Highlights', type: 'json',
      options: { subFields: [{ key: 'label', label: 'Label', type: 'text' }, { key: 'body', label: 'Body', type: 'text' }] },
    },
    { key: 'connectivity', label: 'Connectivity', type: 'multiselect' },
    { key: 'amenities', label: 'Amenities', type: 'multiselect' },
    { key: 'hero_url', label: 'Hero Image', type: 'media' },
    { key: 'hero_alt', label: 'Hero Alt Text', type: 'text' },
    {
      key: 'gallery', label: 'Gallery', type: 'json',
      options: { subFields: [{ key: 'src', label: 'Image URL', type: 'media' }, { key: 'alt', label: 'Alt Text', type: 'text' }] },
    },
    { key: 'available', label: 'Availability', type: 'text' },
    { key: 'source_url', label: 'Source URL', type: 'url' },
    { key: 'seo_title', label: 'SEO Title', type: 'text' },
    { key: 'seo_description', label: 'SEO Description', type: 'textarea' },
  ],
  options: {
    hasStatus: true,
    statusValues: ['active', 'archived'],
    titleField: 'name',
    slugField: 'slug',
    listColumns: ['name', 'listing', 'price', 'status'],
    publishedFilter: { status: 'active' },
  },
});

export const SYSTEM_COLLECTIONS: Collection[] = [POSTS_COLLECTION, PAGES_COLLECTION, PROPERTIES_COLLECTION];

export function getSystemCollection(slug: string): Collection | undefined {
  return SYSTEM_COLLECTIONS.find((c) => c.slug === slug);
}

/** Loads a client-created (generic) collection definition by slug. */
export async function getGenericCollection(
  sb: SupabaseClient,
  clientId: string | null,
  slug: string
): Promise<Collection | null> {
  if (!clientId) return null;
  const { data } = await sb
    .from('collections')
    .select('*')
    .eq('client_id', clientId)
    .eq('slug', slug)
    .maybeSingle();
  return (data as Collection | null) ?? null;
}

/** Resolves a collection definition by slug — system collections first, then this client's custom ones. */
export async function getCollectionDef(
  sb: SupabaseClient,
  clientId: string | null,
  slug: string
): Promise<Collection | null> {
  const system = getSystemCollection(slug);
  if (system) return system;
  return getGenericCollection(sb, clientId, slug);
}

/** Lists this client's custom (generic) collections, e.g. for the collection builder and menu builder. */
export async function listClientCollections(
  sb: SupabaseClient,
  clientId: string | null
): Promise<Collection[]> {
  if (!clientId) return [];
  const { data } = await sb
    .from('collections')
    .select('*')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  return (data as Collection[]) ?? [];
}

/** All collections available to a client: system collections + their custom ones. */
export async function listAllCollections(
  sb: SupabaseClient,
  clientId: string | null
): Promise<Collection[]> {
  const custom = await listClientCollections(sb, clientId);
  return [...SYSTEM_COLLECTIONS, ...custom];
}
