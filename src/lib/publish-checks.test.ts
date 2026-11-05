import { describe, expect, it } from 'vitest';
import type { FieldDef } from '@/lib/collections/types';
import { SEO_DESCRIPTION_KEY, SEO_TITLE_KEY } from '@/lib/seo/entries';
import {
  checkArticleBeforePublish,
  checkEntryBeforePublish,
  summarizeWarnings,
} from './publish-checks';

const codes = (warnings: { code: string }[]) => warnings.map((w) => w.code);

const SEO_FIELDS: FieldDef[] = [
  { key: SEO_TITLE_KEY, label: 'Search title', type: 'text' },
  { key: SEO_DESCRIPTION_KEY, label: 'Search description', type: 'textarea' },
];

describe('checkEntryBeforePublish', () => {
  it('says nothing about a complete entry', () => {
    const fields: FieldDef[] = [
      { key: 'hero', label: 'Main photo', type: 'image' },
      ...SEO_FIELDS,
    ];
    const warnings = checkEntryBeforePublish({
      fields,
      data: {
        hero: { url: 'https://x/y.jpg', alt: 'A front door' },
        [SEO_TITLE_KEY]: 'A title',
        [SEO_DESCRIPTION_KEY]: 'A description.',
      },
    });
    expect(warnings).toEqual([]);
  });

  it('flags an image with no description', () => {
    const fields: FieldDef[] = [{ key: 'hero', label: 'Main photo', type: 'image' }];
    const warnings = checkEntryBeforePublish({ fields, data: { hero: { url: 'https://x/y.jpg', alt: '' } } });
    expect(codes(warnings)).toEqual(['image-missing-alt']);
    expect(warnings[0].field).toBe('hero');
    expect(warnings[0].message).toContain('Main photo');
  });

  it('ignores an image field with no image in it', () => {
    const fields: FieldDef[] = [{ key: 'hero', label: 'Main photo', type: 'image' }];
    expect(checkEntryBeforePublish({ fields, data: {} })).toEqual([]);
    expect(checkEntryBeforePublish({ fields, data: { hero: { url: '', alt: null } } })).toEqual([]);
  });

  it('counts gallery pictures missing a description, and pluralises', () => {
    const fields: FieldDef[] = [{ key: 'gallery', label: 'Photos', type: 'gallery' }];
    const one = checkEntryBeforePublish({
      fields,
      data: { gallery: [{ url: 'a', alt: 'ok' }, { url: 'b', alt: '' }] },
    });
    expect(one).toHaveLength(1);
    expect(one[0].message).toContain('1 picture');
    expect(one[0].message).toContain('it shows');

    const two = checkEntryBeforePublish({
      fields,
      data: { gallery: [{ url: 'a', alt: '' }, { url: 'b', alt: null }] },
    });
    expect(two[0].message).toContain('2 pictures');
    expect(two[0].message).toContain('they show');
  });

  it('looks inside repeater rows', () => {
    const fields: FieldDef[] = [
      {
        key: 'sections',
        label: 'Section',
        type: 'repeater',
        fields: [
          { key: 'heading', label: 'Heading', type: 'text' },
          { key: 'image', label: 'Picture', type: 'image' },
        ],
      },
    ];
    const warnings = checkEntryBeforePublish({
      fields,
      data: {
        sections: [
          { heading: 'A', image: { url: 'a', alt: 'fine' } },
          { heading: 'B', image: { url: 'b', alt: '  ' } },
        ],
      },
    });
    expect(codes(warnings)).toEqual(['image-missing-alt']);
    expect(warnings[0].field).toBe('sections[1].image');
  });

  it('flags placeholder links', () => {
    const fields: FieldDef[] = [{ key: 'booking', label: 'Booking link', type: 'url' }];
    for (const href of ['#', 'https://', 'https://example.com', 'https://example.com/']) {
      expect(codes(checkEntryBeforePublish({ fields, data: { booking: href } }))).toEqual(['link-placeholder']);
    }
    expect(checkEntryBeforePublish({ fields, data: { booking: 'https://real.example.org/book' } })).toEqual([]);
  });

  it('checks SEO only for collections that opted in', () => {
    const withoutSeo: FieldDef[] = [{ key: 'name', label: 'Name', type: 'text' }];
    expect(checkEntryBeforePublish({ fields: withoutSeo, data: { name: 'A' } })).toEqual([]);

    const withSeo: FieldDef[] = [...withoutSeo, ...SEO_FIELDS];
    expect(codes(checkEntryBeforePublish({ fields: withSeo, data: { name: 'A' } })))
      .toEqual(['seo-title-missing', 'seo-description-missing']);
  });

  it('only asks for the SEO fields the collection actually declares', () => {
    const titleOnly: FieldDef[] = [{ key: SEO_TITLE_KEY, label: 'Search title', type: 'text' }];
    expect(codes(checkEntryBeforePublish({ fields: titleOnly, data: {} }))).toEqual(['seo-title-missing']);
  });

  it('warns when a search description will be cut off', () => {
    const fields = SEO_FIELDS;
    const long = 'a'.repeat(201);
    const warnings = checkEntryBeforePublish({
      fields,
      data: { [SEO_TITLE_KEY]: 'T', [SEO_DESCRIPTION_KEY]: long },
    });
    expect(codes(warnings)).toEqual(['seo-description-long']);
    expect(warnings[0].message).toContain('201 characters');

    // A well-judged description is left alone.
    expect(checkEntryBeforePublish({
      fields,
      data: { [SEO_TITLE_KEY]: 'T', [SEO_DESCRIPTION_KEY]: 'a'.repeat(160) },
    })).toEqual([]);
  });
});

describe('checkArticleBeforePublish', () => {
  const complete = {
    html: '<p>Real words.</p>',
    seoTitle: 'A title',
    seoDescription: 'A description.',
  };

  it('says nothing about a complete article', () => {
    expect(checkArticleBeforePublish(complete)).toEqual([]);
  });

  it('counts body images with no description', () => {
    const warnings = checkArticleBeforePublish({
      ...complete,
      html: '<p><img src="a.jpg" alt="described"><img src="b.jpg" alt=""><img src="c.jpg"></p>',
    });
    expect(codes(warnings)).toEqual(['image-missing-alt']);
    expect(warnings[0].message).toContain('2 pictures');
  });

  it('flags a cover image with no description, but only when there is a cover', () => {
    expect(codes(checkArticleBeforePublish({ ...complete, coverUrl: 'x.jpg', coverAlt: '' })))
      .toEqual(['image-missing-alt']);
    expect(checkArticleBeforePublish({ ...complete, coverUrl: 'x.jpg', coverAlt: 'A cover' })).toEqual([]);
    expect(checkArticleBeforePublish({ ...complete, coverUrl: null, coverAlt: null })).toEqual([]);
  });

  it('flags missing SEO', () => {
    expect(codes(checkArticleBeforePublish({ ...complete, seoTitle: '', seoDescription: null })))
      .toEqual(['seo-title-missing', 'seo-description-missing']);
  });

  it('flags an article with no content, including an emptied editor', () => {
    for (const html of ['', '<p></p>', '  <p>  </p> ']) {
      expect(codes(checkArticleBeforePublish({ ...complete, html }))).toContain('empty-content');
    }
  });

  it('does not call an image-only article empty', () => {
    const warnings = checkArticleBeforePublish({ ...complete, html: '<p><img src="a.jpg" alt="A photo"></p>' });
    expect(codes(warnings)).not.toContain('empty-content');
  });
});

describe('summarizeWarnings', () => {
  it('reads as a headline', () => {
    expect(summarizeWarnings([])).toBe('');
    expect(summarizeWarnings([{ code: 'empty-content', message: '' }])).toBe('1 thing worth checking');
    expect(summarizeWarnings([
      { code: 'empty-content', message: '' },
      { code: 'seo-title-missing', message: '' },
    ])).toBe('2 things worth checking');
  });
});

describe('checkArticleBeforePublish — bespoke image columns', () => {
  const base = { html: '<p>Words.</p>', seoTitle: 'T', seoDescription: 'D' };

  it('names which extra image is undescribed', () => {
    const warnings = checkArticleBeforePublish({
      ...base,
      images: [
        { label: 'Hero image', url: 'a.jpg', alt: '' },
        { label: 'Floor plan', url: 'b.jpg', alt: 'A floor plan' },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Hero image');
    expect(warnings[0].field).toBe('Hero image');
  });

  it('ignores an extra image slot with no image in it', () => {
    expect(checkArticleBeforePublish({ ...base, images: [{ label: 'Hero image', url: '', alt: null }] }))
      .toEqual([]);
    expect(checkArticleBeforePublish({ ...base, images: [{ label: 'Hero image' }] })).toEqual([]);
  });

  it('accepts both { url } and { src } gallery rows', () => {
    // `properties.gallery` stores `{ src, alt }`; the generic gallery field
    // stores `{ url, alt }`. Both are real shapes in this database.
    const withSrc = checkArticleBeforePublish({
      ...base,
      galleries: [{ label: 'Photos', items: [{ src: 'a.jpg', alt: '' }, { src: 'b.jpg', alt: 'ok' }] }],
    });
    expect(withSrc[0].message).toContain('1 picture in "Photos"');

    const withUrl = checkArticleBeforePublish({
      ...base,
      galleries: [{ label: 'Photos', items: [{ url: 'a.jpg', alt: null }, { url: 'b.jpg' }] }],
    });
    expect(withUrl[0].message).toContain('2 pictures in "Photos"');
  });

  it('ignores a gallery that is empty or not an array', () => {
    expect(checkArticleBeforePublish({ ...base, galleries: [{ label: 'Photos', items: [] }] })).toEqual([]);
    expect(checkArticleBeforePublish({ ...base, galleries: [{ label: 'Photos', items: null }] })).toEqual([]);
  });

  it('can skip the empty-body check for records where a body is optional', () => {
    // A property listing is complete without a long description; calling it
    // "empty" would be noise on every single publish.
    expect(codes(checkArticleBeforePublish({ ...base, html: '', requireBody: false })))
      .not.toContain('empty-content');
    expect(codes(checkArticleBeforePublish({ ...base, html: '' }))).toContain('empty-content');
  });
});
