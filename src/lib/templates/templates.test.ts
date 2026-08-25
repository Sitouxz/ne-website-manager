import { describe, expect, it } from 'vitest';
import { validateFieldDefs } from '@/lib/collections/validate';
import { collectSectionsErrors } from '@/lib/collections/sections';
import { FILTERABLE_TYPES, MAX_LIST_COLUMNS } from '@/lib/collections/display';
import { collectionHasSeoFields } from '@/lib/seo/entries';
import { mockSupabase } from '@/test/supabase-mock';
import { DEFAULT_TEMPLATE_SLUG, SITE_TEMPLATES, collectionBlueprints, getCollectionBlueprint, getTemplate } from './catalog';
import { applyTemplate, describeApplied, type TemplateWriteClient } from './apply';

/**
 * The catalog tests are the reason templates live in code: a broken starter
 * schema fails here rather than on a real client's first login.
 */
describe('SITE_TEMPLATES catalog', () => {
  it('has a unique slug per template, and a usable default', () => {
    const slugs = SITE_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(getTemplate(DEFAULT_TEMPLATE_SLUG)).not.toBeNull();
  });

  it('returns null for an unknown or missing slug', () => {
    expect(getTemplate('does-not-exist')).toBeNull();
    expect(getTemplate(null)).toBeNull();
    expect(getTemplate('')).toBeNull();
  });

  for (const template of SITE_TEMPLATES) {
    describe(`${template.name} (${template.slug})`, () => {
      it('has a description written for an operator', () => {
        expect(template.description.trim().length).toBeGreaterThan(10);
      });

      it('has collections with unique slugs', () => {
        const slugs = template.collections.map((c) => c.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
      });

      it('has a valid field schema in every collection', () => {
        for (const collection of template.collections) {
          const result = validateFieldDefs(collection.fields);
          if (!result.ok) {
            throw new Error(`${collection.slug}: ${result.errors.join('; ')}`);
          }
          expect(result.ok).toBe(true);
        }
      });

      it('follows the page-sections convention wherever it declares sections', () => {
        // The convention is not enforced by `validateFieldDefs` (it would
        // retroactively invalidate existing client schemas — see
        // `lib/collections/sections.ts`), so templates are gated here
        // instead. A starter schema is the one place a broken sections
        // field would reach every future client at once.
        for (const collection of template.collections) {
          for (const field of collection.fields) {
            const errors = collectSectionsErrors(field);
            if (errors.length > 0) {
              throw new Error(`${collection.slug}: ${errors.join('; ')}`);
            }
          }
        }
      });

      it('only names real fields in title_field, list_columns and list_filters', () => {
        for (const collection of template.collections) {
          const keys = new Set(collection.fields.map((f) => f.key));
          const options = collection.options ?? {};

          if (options.title_field) expect(keys.has(options.title_field)).toBe(true);
          for (const key of options.list_columns ?? []) expect(keys.has(key)).toBe(true);
          for (const key of options.list_filters ?? []) expect(keys.has(key)).toBe(true);
        }
      });

      it('configures no more list columns than the list can render', () => {
        for (const collection of template.collections) {
          expect((collection.options?.list_columns ?? []).length).toBeLessThanOrEqual(MAX_LIST_COLUMNS);
        }
      });

      it('only offers filters on field types that can actually filter', () => {
        for (const collection of template.collections) {
          const byKey = new Map(collection.fields.map((f) => [f.key, f]));
          for (const key of collection.options?.list_filters ?? []) {
            const field = byKey.get(key);
            expect(field && FILTERABLE_TYPES.has(field.type)).toBe(true);
          }
        }
      });

      it('gives every collection a title field, so entries are never listed by slug alone', () => {
        for (const collection of template.collections) {
          expect(collection.options?.title_field).toBeTruthy();
        }
      });

      it('uses no developer vocabulary in anything a client reads', () => {
        // The product constraint: these strings land in a client's own editor.
        const banned = /\b(slug|meta|json|payload|schema|boolean|nullable)\b/i;
        for (const collection of template.collections) {
          for (const field of collection.fields) {
            expect(field.label).not.toMatch(banned);
            if (field.help) expect(field.help).not.toMatch(banned);
          }
        }
      });
    });
  }

  it('gives the listings template everything the bespoke properties table had', () => {
    // Stage 4's exit condition, asserted rather than assumed: the generic path
    // can express the columns that justified a native table.
    const listings = getTemplate('listings');
    expect(listings).not.toBeNull();
    const fields = listings!.collections[0].fields;
    const keys = new Set(fields.map((f) => f.key));

    for (const key of [
      'name', 'tagline', 'story', 'segment', 'price', 'psf', 'size_sqft',
      'address', 'district', 'location_note', 'connectivity',
      'hero', 'gallery', 'bedrooms', 'bathrooms', 'amenities', 'highlights',
      'available', 'completion_year',
    ]) {
      expect(keys.has(key)).toBe(true);
    }

    // The two shapes that used to force a raw JSON textarea.
    expect(fields.find((f) => f.key === 'highlights')?.type).toBe('repeater');
    expect(fields.find((f) => f.key === 'connectivity')?.type).toBe('taglist');
    // And prices render as money, not bare integers.
    expect(fields.find((f) => f.key === 'price')?.format?.prefix).toBe('S$');
  });

  it('opts collections whose entries get their own page into the SEO audit', () => {
    // `team` and `authors` are reference data rendered inside somebody else's
    // page, so they correctly have no search title of their own — opting them
    // in would report them as "missing SEO" forever.
    const NO_PAGE_OF_THEIR_OWN = new Set(['team', 'authors']);

    for (const template of SITE_TEMPLATES) {
      for (const collection of template.collections) {
        expect(collectionHasSeoFields(collection.fields))
          .toBe(!NO_PAGE_OF_THEIR_OWN.has(collection.slug));
      }
    }
  });
});

describe('applyTemplate', () => {
  const template = getTemplate('brochure')!;

  function db() {
    return mockSupabase({ collections: [], site_globals: [], menu_items: [] }) as unknown as TemplateWriteClient;
  }

  it('writes collections, globals and navigation for the client', async () => {
    const supabase = db();
    const result = await applyTemplate(supabase, 'client-1', template);

    expect(result.errors).toEqual([]);
    expect(result.collections).toBe(template.collections.length);
    expect(result.globals).toBe(Object.keys(template.globals ?? {}).length);
    expect(result.navigation).toBe((template.navigation ?? []).length);
  });

  it('scopes every written row to the client', async () => {
    const supabase = mockSupabase({ collections: [], site_globals: [], menu_items: [] });
    await applyTemplate(supabase as unknown as TemplateWriteClient, 'client-1', template);

    for (const table of ['collections', 'site_globals', 'menu_items']) {
      const { data } = await supabase.from(table).select('*');
      expect(data!.length).toBeGreaterThan(0);
      for (const row of data as { client_id: string }[]) {
        expect(row.client_id).toBe('client-1');
      }
    }
  });

  it('writes collections as generic, never as a native table', async () => {
    const supabase = mockSupabase({ collections: [], site_globals: [], menu_items: [] });
    await applyTemplate(supabase as unknown as TemplateWriteClient, 'client-1', template);

    const { data } = await supabase.from('collections').select('*');
    for (const row of data as { storage: string; native_table: string | null }[]) {
      expect(row.storage).toBe('generic');
      expect(row.native_table).toBeNull();
    }
  });

  it('writes navigation as public url links, in order', async () => {
    const supabase = mockSupabase({ collections: [], site_globals: [], menu_items: [] });
    await applyTemplate(supabase as unknown as TemplateWriteClient, 'client-1', template);

    const { data } = await supabase.from('menu_items').select('*');
    const rows = data as { location: string; link_type: string; sort_order: number; label: string }[];
    expect(rows.every((r) => r.location === 'public' && r.link_type === 'url')).toBe(true);
    expect(rows.map((r) => r.sort_order)).toEqual(rows.map((_, i) => i));
    expect(rows[0].label).toBe(template.navigation![0].label);
  });

  it('writes nothing for the blank template', async () => {
    const supabase = db();
    const result = await applyTemplate(supabase, 'client-1', getTemplate('blank')!);
    expect(result).toEqual({ collections: 0, globals: 0, navigation: 0, errors: [] });
  });

  it('skips a collection whose schema is invalid, and says so', async () => {
    const broken = {
      ...template,
      collections: [
        { slug: 'bad', name: 'Bad', name_singular: 'Bad', fields: [{ key: 'Not A Key', label: 'X', type: 'text' as const }] },
        template.collections[0],
      ],
    };
    const supabase = mockSupabase({ collections: [], site_globals: [], menu_items: [] });
    const result = await applyTemplate(supabase as unknown as TemplateWriteClient, 'client-1', broken);

    expect(result.collections).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Bad');

    const { data } = await supabase.from('collections').select('*');
    expect((data as { slug: string }[]).map((r) => r.slug)).toEqual([template.collections[0].slug]);
  });

  it('keeps going when one table fails, reporting what did not land', async () => {
    // The client and its login already exist by this point; losing them over a
    // failed nav insert would be far more destructive than a partial template.
    const failing: TemplateWriteClient = {
      from: (table: string) => ({
        insert: async () => (table === 'menu_items' ? { error: { message: 'permission denied' } } : { error: null }),
      }),
    };

    const result = await applyTemplate(failing, 'client-1', template);
    expect(result.collections).toBe(template.collections.length);
    expect(result.globals).toBeGreaterThan(0);
    expect(result.navigation).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('permission denied');
  });
});

describe('describeApplied', () => {
  it('reads as a sentence for each shape of result', () => {
    expect(describeApplied({ collections: 0, globals: 0, navigation: 0 })).toBe('no starter content');
    expect(describeApplied({ collections: 1, globals: 0, navigation: 0 })).toBe('1 collection');
    expect(describeApplied({ collections: 2, globals: 0, navigation: 0 })).toBe('2 collections');
    expect(describeApplied({ collections: 2, globals: 2, navigation: 4 }))
      .toBe('2 collections, 2 site settings and 4 menu items');
  });
});

describe('collectionBlueprints', () => {
  it('offers every distinct collection in the catalog', () => {
    const blueprints = collectionBlueprints();
    const allSlugs = new Set(SITE_TEMPLATES.flatMap((t) => t.collections.map((c) => c.slug)));
    expect(new Set(blueprints.map((b) => b.slug))).toEqual(allSlugs);
  });

  it('deduplicates by slug and says which template each came from', () => {
    const blueprints = collectionBlueprints();
    const slugs = blueprints.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const blueprint of blueprints) {
      expect(blueprint.fromTemplate.length).toBeGreaterThan(0);
    }
  });

  it('carries the full schema, not just a name', () => {
    const listings = getCollectionBlueprint('listings');
    expect(listings).not.toBeNull();
    expect(listings!.fields.length).toBeGreaterThan(10);
    expect(listings!.options?.title_field).toBe('name');
  });

  it('returns null for an unknown slug', () => {
    expect(getCollectionBlueprint('nope')).toBeNull();
    expect(getCollectionBlueprint(null)).toBeNull();
  });
});

describe('template navigation matches its collections', () => {
  it('links to every collection whose entries get their own page', () => {
    // Ties two independent decisions together: a collection that opted into
    // the SEO audit has public pages, and public pages nobody can navigate to
    // are a broken starting point. `/api/client/[slug]/seo` builds entry paths
    // as `/{collection.slug}/{item.slug}`, so the section link is
    // `/{collection.slug}`.
    for (const template of SITE_TEMPLATES) {
      const navUrls = new Set((template.navigation ?? []).map((n) => n.url));
      for (const collection of template.collections) {
        if (!collectionHasSeoFields(collection.fields)) continue;
        expect(navUrls.has(`/${collection.slug}`)).toBe(true);
      }
    }
  });

  it('gives every template with collections a home link', () => {
    for (const template of SITE_TEMPLATES) {
      if (template.collections.length === 0) continue;
      expect((template.navigation ?? []).some((n) => n.url === '/')).toBe(true);
    }
  });

  it('uses site-relative paths only — a template cannot know a client domain', () => {
    for (const template of SITE_TEMPLATES) {
      for (const item of template.navigation ?? []) {
        expect(item.url.startsWith('/')).toBe(true);
      }
    }
  });
});
