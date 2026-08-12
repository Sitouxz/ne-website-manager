import { SEO_DESCRIPTION_KEY, SEO_TITLE_KEY } from '@/lib/seo/entries';
import type { FieldDef } from '@/lib/collections/types';
import type { SiteTemplate, TemplateCollection } from './types';

/**
 * The built-in site templates. See `./types.ts` for why these live in code.
 *
 * Two rules every template here follows, both learned from the audit:
 *
 *  1. **No developer vocabulary in anything a client reads.** Labels and help
 *     text say "web address" and "search description", never "slug" or "meta".
 *     These strings land directly in a client's entry editor.
 *  2. **Every collection configures its list view.** A collection that ships
 *     with no `list_columns` or `sort_default` gives an editor a flat list of
 *     identical-looking rows, which is exactly the failure that kept the
 *     bespoke properties editor alive.
 */

/** The reserved SEO pair, appended to any collection whose entries get a public page. */
const SEO_FIELDS: FieldDef[] = [
  {
    key: SEO_TITLE_KEY,
    label: 'Search title',
    type: 'text',
    group: 'Search',
    help: 'The headline shown on Google. Leave blank to use the name above.',
  },
  {
    key: SEO_DESCRIPTION_KEY,
    label: 'Search description',
    type: 'textarea',
    group: 'Search',
    help: 'The short summary shown under the headline on Google. One or two sentences.',
  },
];

const BLANK: SiteTemplate = {
  slug: 'blank',
  name: 'Blank',
  description: 'No collections or starter content. Everything is set up by hand afterwards.',
  collections: [],
};

const BROCHURE: SiteTemplate = {
  slug: 'brochure',
  name: 'Business website',
  description: 'Pages, a services list and a team list — the shape most company sites start from.',
  capabilities: { properties: false },
  collections: [
    {
      slug: 'services',
      name: 'Services',
      name_singular: 'Service',
      icon: 'Briefcase',
      description: 'What the business offers, shown on the services page.',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true, group: 'Overview' },
        { key: 'summary', label: 'Short summary', type: 'textarea', group: 'Overview', help: 'One or two sentences, used on the services list.' },
        { key: 'body', label: 'Full description', type: 'richtext', group: 'Overview' },
        { key: 'image', label: 'Image', type: 'image', group: 'Media' },
        {
          key: 'highlights',
          label: 'Highlight',
          type: 'repeater',
          group: 'Details',
          help: 'Short selling points shown as a list.',
          fields: [
            { key: 'heading', label: 'Heading', type: 'text', required: true },
            { key: 'detail', label: 'Detail', type: 'textarea' },
          ],
        },
        ...SEO_FIELDS,
      ],
      options: { title_field: 'name', list_columns: ['summary'], sort_default: 'manual' },
    },
    {
      slug: 'team',
      name: 'Team',
      name_singular: 'Team member',
      icon: 'Users',
      description: 'People shown on the about or team page.',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true, group: 'Person' },
        { key: 'role', label: 'Role', type: 'text', group: 'Person' },
        { key: 'photo', label: 'Photo', type: 'image', group: 'Person' },
        { key: 'bio', label: 'Biography', type: 'textarea', group: 'Person' },
        { key: 'email', label: 'Email', type: 'email', group: 'Contact' },
        { key: 'linkedin', label: 'LinkedIn', type: 'url', group: 'Contact' },
      ],
      options: { title_field: 'name', list_columns: ['role'], sort_default: 'manual' },
    },
  ],
  globals: {
    footer: { text: '', links: [] },
    announcement: { enabled: false, message: '', variant: 'info' },
  },
  navigation: [
    { label: 'Home', url: '/' },
    { label: 'About', url: '/about' },
    { label: 'Services', url: '/services' },
    { label: 'Contact', url: '/contact' },
  ],
};

const PUBLICATION: SiteTemplate = {
  slug: 'publication',
  name: 'Blog or publication',
  description: 'Article-led site. Blog posts do the work; adds a topics list and author profiles.',
  capabilities: { properties: false },
  collections: [
    {
      slug: 'authors',
      name: 'Authors',
      name_singular: 'Author',
      icon: 'PenLine',
      description: 'Bylines shown on articles.',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'photo', label: 'Photo', type: 'image' },
        { key: 'bio', label: 'Short bio', type: 'textarea' },
        { key: 'website', label: 'Website', type: 'url' },
      ],
      options: { title_field: 'name', sort_default: 'title' },
    },
    {
      slug: 'topics',
      name: 'Topics',
      name_singular: 'Topic',
      icon: 'Tags',
      description: 'Groups articles together for readers browsing by subject.',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'summary', label: 'Summary', type: 'textarea' },
        ...SEO_FIELDS,
      ],
      options: { title_field: 'name', sort_default: 'title' },
    },
  ],
  globals: {
    footer: { text: '', links: [] },
    announcement: { enabled: false, message: '', variant: 'info' },
  },
  navigation: [
    { label: 'Home', url: '/' },
    { label: 'Articles', url: '/blog' },
    { label: 'Topics', url: '/topics' },
    { label: 'About', url: '/about' },
  ],
};

/**
 * The generic replacement for the bespoke `properties` table — Stage 4's
 * target shape, expressed entirely in collection fields. It is in the catalog
 * on its own merit (any listings-style client needs it), and it doubles as the
 * proof that the generic path can now express what forced a native table.
 */
const LISTINGS: SiteTemplate = {
  slug: 'listings',
  name: 'Property or product listings',
  description: 'A searchable list of items with price, location, photos and features.',
  capabilities: { properties: false },
  collections: [
    {
      slug: 'listings',
      name: 'Listings',
      name_singular: 'Listing',
      icon: 'Building2',
      description: 'Everything shown on the listings pages.',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true, group: 'Overview' },
        { key: 'tagline', label: 'Tagline', type: 'text', group: 'Overview', help: 'One short line shown under the name.' },
        { key: 'story', label: 'Description', type: 'richtext', group: 'Overview' },
        { key: 'segment', label: 'Segment', type: 'select', options: ['Luxury', 'Mid-market', 'Mass market'], group: 'Overview' },

        { key: 'price', label: 'Price', type: 'number', group: 'Pricing', format: { precision: 0, prefix: 'S$' } },
        { key: 'psf', label: 'Price per square foot', type: 'number', group: 'Pricing', format: { precision: 2, prefix: 'S$', suffix: 'psf' } },
        { key: 'size_sqft', label: 'Size', type: 'number', group: 'Pricing', format: { precision: 0, suffix: 'sq ft' } },

        { key: 'address', label: 'Address', type: 'text', group: 'Location' },
        { key: 'district', label: 'District', type: 'text', group: 'Location' },
        { key: 'location_note', label: 'About the area', type: 'textarea', group: 'Location' },
        { key: 'connectivity', label: 'Getting around', type: 'taglist', group: 'Location', help: 'Nearby stations, roads and travel times.' },

        { key: 'hero', label: 'Main photo', type: 'image', group: 'Media' },
        { key: 'gallery', label: 'Photo gallery', type: 'gallery', group: 'Media' },
        { key: 'tour_url', label: 'Virtual tour link', type: 'url', group: 'Media' },

        { key: 'bedrooms', label: 'Bedrooms', type: 'number', group: 'Features' },
        { key: 'bathrooms', label: 'Bathrooms', type: 'number', group: 'Features' },
        { key: 'amenities', label: 'Amenities', type: 'taglist', group: 'Features' },
        {
          key: 'highlights',
          label: 'Highlight',
          type: 'repeater',
          group: 'Features',
          help: 'The two or three things that sell this listing.',
          fields: [
            { key: 'heading', label: 'Heading', type: 'text', required: true },
            { key: 'detail', label: 'Detail', type: 'textarea' },
          ],
        },

        { key: 'available', label: 'Available now', type: 'boolean', group: 'Availability' },
        { key: 'completion_year', label: 'Completion year', type: 'number', group: 'Availability', format: { precision: 0 } },

        ...SEO_FIELDS,
      ],
      options: {
        title_field: 'name',
        list_columns: ['district', 'price', 'available'],
        list_filters: ['segment', 'amenities', 'available'],
        sort_default: 'recently_updated',
      },
    },
  ],
  globals: {
    footer: { text: '', links: [] },
    announcement: { enabled: false, message: '', variant: 'info' },
  },
  navigation: [
    { label: 'Home', url: '/' },
    { label: 'Listings', url: '/listings' },
    { label: 'About', url: '/about' },
    { label: 'Contact', url: '/contact' },
  ],
};

const COMMUNITY: SiteTemplate = {
  slug: 'community',
  name: 'Community or place of worship',
  description: 'Events, notices and programmes — for mosques, churches, schools and clubs.',
  capabilities: { properties: false },
  collections: [
    {
      slug: 'events',
      name: 'Events',
      name_singular: 'Event',
      icon: 'CalendarDays',
      description: "What's on, shown on the events page.",
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true, group: 'Overview' },
        { key: 'summary', label: 'Short summary', type: 'textarea', group: 'Overview' },
        { key: 'body', label: 'Full details', type: 'richtext', group: 'Overview' },
        { key: 'starts_on', label: 'Date', type: 'date', required: true, group: 'When and where' },
        { key: 'time_note', label: 'Time', type: 'text', group: 'When and where', help: 'Written however you say it out loud, e.g. "After Maghrib".' },
        { key: 'venue', label: 'Venue', type: 'text', group: 'When and where' },
        { key: 'image', label: 'Poster', type: 'image', group: 'Media' },
        { key: 'audience', label: 'Who it is for', type: 'taglist', group: 'Details' },
        { key: 'registration_url', label: 'Registration link', type: 'url', group: 'Details' },
        ...SEO_FIELDS,
      ],
      options: {
        title_field: 'name',
        list_columns: ['starts_on', 'venue'],
        list_filters: ['audience'],
        sort_default: 'newest',
      },
    },
    {
      slug: 'programmes',
      name: 'Programmes',
      name_singular: 'Programme',
      icon: 'BookOpen',
      description: 'Regular classes and activities that run week to week.',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'summary', label: 'Short summary', type: 'textarea' },
        { key: 'schedule', label: 'When it runs', type: 'text', help: 'e.g. "Every Saturday, 10am – 12pm".' },
        { key: 'audience', label: 'Who it is for', type: 'taglist' },
        { key: 'image', label: 'Image', type: 'image' },
        ...SEO_FIELDS,
      ],
      options: { title_field: 'name', list_columns: ['schedule'], list_filters: ['audience'], sort_default: 'manual' },
    },
  ],
  globals: {
    footer: { text: '', links: [] },
    announcement: { enabled: false, message: '', variant: 'info' },
  },
  navigation: [
    { label: 'Home', url: '/' },
    { label: 'Events', url: '/events' },
    { label: 'Programmes', url: '/programmes' },
    { label: 'Contact', url: '/contact' },
  ],
};

/** Blank first — it is the safe choice and the current behaviour. */
export const SITE_TEMPLATES: SiteTemplate[] = [BLANK, BROCHURE, PUBLICATION, LISTINGS, COMMUNITY];

export const DEFAULT_TEMPLATE_SLUG = BLANK.slug;

export function getTemplate(slug: string | null | undefined): SiteTemplate | null {
  if (!slug) return null;
  return SITE_TEMPLATES.find((t) => t.slug === slug) ?? null;
}

/** A template's collection, offered on its own as a starting point for a new one. */
export interface CollectionBlueprint extends TemplateCollection {
  /** The template it came from, so the picker can say where it is used. */
  fromTemplate: string;
}

/**
 * Every collection in the catalog, flattened and deduplicated by slug, for
 * the "New Collection → start from" picker.
 *
 * These schemas were designed once, reviewed in a diff, and are covered by
 * `templates.test.ts`. A client who adds Events six months after onboarding
 * should get that same schema rather than a blank field builder and whatever
 * the operator remembers to type — which is how two clients end up with
 * `start_date` and `starts_on` meaning the same thing.
 *
 * Deduplicated first-wins on slug: catalog order puts the more general
 * template earlier, and two collections sharing a slug are the same idea.
 */
export function collectionBlueprints(): CollectionBlueprint[] {
  const seen = new Set<string>();
  const out: CollectionBlueprint[] = [];

  for (const template of SITE_TEMPLATES) {
    for (const collection of template.collections) {
      if (seen.has(collection.slug)) continue;
      seen.add(collection.slug);
      out.push({ ...collection, fromTemplate: template.name });
    }
  }
  return out;
}

export function getCollectionBlueprint(slug: string | null | undefined): CollectionBlueprint | null {
  if (!slug) return null;
  return collectionBlueprints().find((b) => b.slug === slug) ?? null;
}
