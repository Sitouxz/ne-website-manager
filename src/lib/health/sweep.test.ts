import { describe, expect, it } from 'vitest';
import {
  extractInternalLinks,
  summarizeReport,
  sweep,
  STALE_AFTER_MONTHS,
  type SweepInput,
} from './sweep';

const NOW = new Date('2026-08-13T00:00:00Z');

const base: SweepInput = {
  clientId: 'client-1',
  clientName: 'Al-Islah',
  posts: [],
  pages: [],
  entries: [],
  collections: [],
  media: [],
  deliveries: [],
  now: NOW,
};

const publishedPost = (over: Partial<SweepInput['posts'][number]> = {}) => ({
  id: 'p1',
  title: 'Ramadan Timings',
  slug: 'ramadan-timings',
  status: 'published',
  updated_at: '2026-08-01T00:00:00Z',
  seo_title: 'Ramadan Timings',
  seo_description: 'When prayers are held during Ramadan.',
  content: '',
  ...over,
});

describe('extractInternalLinks', () => {
  it('collects same-site paths only', () => {
    const links = extractInternalLinks(
      '<a href="/about">a</a><a href="https://example.com/x">b</a><a href="//cdn.com/y">c</a>',
    );
    expect(links).toEqual(['/about']);
  });

  it('normalises anchors, query strings and trailing slashes to one path', () => {
    const links = extractInternalLinks(
      '<a href="/contact/">a</a><a href="/contact#form">b</a><a href="/contact?ref=x">c</a>',
    );
    expect(links).toEqual(['/contact']);
  });

  it('keeps the site root addressable', () => {
    expect(extractInternalLinks('<a href="/">home</a>')).toEqual(['/']);
  });

  it('finds nothing in content with no links', () => {
    expect(extractInternalLinks('<p>Just words</p>')).toEqual([]);
  });
});

describe('sweep — publishing failures', () => {
  it('leads with a failed delivery, because nothing below it can be trusted', () => {
    const report = sweep({
      ...base,
      deliveries: [{ ok: false, url: 'https://alislah.sg/api/revalidate' }],
    });
    expect(report.findings[0].code).toBe('publish-failing');
    expect(report.findings[0].severity).toBe('problem');
    expect(report.findings[0].message).toContain('previous version');
  });

  it('says nothing when deliveries are succeeding', () => {
    const report = sweep({ ...base, deliveries: [{ ok: true, url: 'https://alislah.sg' }] });
    expect(report.findings).toHaveLength(0);
  });
});

describe('sweep — live content quality', () => {
  it('reports published content with no search description', () => {
    const report = sweep({
      ...base,
      posts: [publishedPost({ seo_description: null })],
    });
    expect(report.findings.map((f) => f.code)).toContain('missing-seo');
    expect(report.problemCount).toBe(1);
  });

  it('ignores drafts — the sweep is about what visitors can see', () => {
    const report = sweep({
      ...base,
      posts: [publishedPost({ status: 'draft', seo_description: null })],
    });
    expect(report.findings).toHaveLength(0);
  });

  it('reports pictures on live pages that have no description', () => {
    const report = sweep({
      ...base,
      posts: [publishedPost({ content: '<img src="/a.jpg">' })],
    });
    const finding = report.findings.find((f) => f.code === 'image-missing-alt');
    expect(finding).toBeDefined();
    expect(finding?.href).toBe('/cms/posts/p1');
  });

  it('groups several undescribed pictures into one finding per page', () => {
    // One line per page, not per image: a gallery of twelve would otherwise
    // bury every other finding in the report. The count comes from the
    // publish check's own wording, so the two can never disagree.
    const report = sweep({
      ...base,
      posts: [publishedPost({ content: '<img src="/a.jpg"><img src="/b.jpg"><img src="/c.jpg">' })],
    });
    const alt = report.findings.filter((f) => f.code === 'image-missing-alt');
    expect(alt).toHaveLength(1);
    expect(alt[0].message).toContain('3 pictures');
    expect(alt[0].message).toContain('On the live post "Ramadan Timings"');
  });
});

describe('sweep — broken internal links', () => {
  it('reports a link to a path no published page serves', () => {
    const report = sweep({
      ...base,
      posts: [publishedPost({ content: '<a href="/donate">Donate</a>' })],
    });
    const finding = report.findings.find((f) => f.code === 'broken-internal-link');
    expect(finding?.message).toContain('/donate');
    expect(finding?.message).toContain('visitors clicking it get an error');
  });

  it('accepts a link to a published page', () => {
    const report = sweep({
      ...base,
      posts: [publishedPost({ content: '<a href="/donate">Donate</a>' })],
      pages: [{ id: 'pg1', title: 'Donate', path: '/donate', status: 'published' }],
    });
    expect(report.findings.filter((f) => f.code === 'broken-internal-link')).toHaveLength(0);
  });

  it('accepts a link to a published post at its blog path', () => {
    const report = sweep({
      ...base,
      posts: [
        publishedPost({ id: 'p1', content: '<a href="/blog/eid">Eid</a>' }),
        publishedPost({ id: 'p2', slug: 'eid' }),
      ],
    });
    expect(report.findings.filter((f) => f.code === 'broken-internal-link')).toHaveLength(0);
  });

  it('does not accept a link to a page that is only a draft', () => {
    // The page exists in the CMS, which is exactly why this is easy to miss.
    const report = sweep({
      ...base,
      posts: [publishedPost({ content: '<a href="/donate">Donate</a>' })],
      pages: [{ id: 'pg1', title: 'Donate', path: '/donate', status: 'draft' }],
    });
    expect(report.findings.filter((f) => f.code === 'broken-internal-link')).toHaveLength(1);
  });
});

describe('sweep — tidying', () => {
  it('reports an unreferenced upload once it is past the grace period', () => {
    const report = sweep({
      ...base,
      media: [{ id: 'm1', url: '/media/old.jpg', filename: 'old.jpg', created_at: '2026-01-01T00:00:00Z' }],
    });
    const finding = report.findings.find((f) => f.code === 'orphan-media');
    expect(finding?.severity).toBe('tidy');
  });

  it('leaves a freshly uploaded file alone', () => {
    // Uploaded for a draft still being written — flagging it teaches people
    // to ignore the report.
    const report = sweep({
      ...base,
      media: [{ id: 'm1', url: '/media/new.jpg', filename: 'new.jpg', created_at: '2026-08-10T00:00:00Z' }],
    });
    expect(report.findings).toHaveLength(0);
  });

  it('leaves a file that content actually references', () => {
    const report = sweep({
      ...base,
      posts: [publishedPost({ content: '<img src="/media/used.jpg" alt="In use">' })],
      media: [{ id: 'm1', url: '/media/used.jpg', filename: 'used.jpg', created_at: '2026-01-01T00:00:00Z' }],
    });
    expect(report.findings.filter((f) => f.code === 'orphan-media')).toHaveLength(0);
  });

  it('finds a file referenced only by a collection entry', () => {
    const report = sweep({
      ...base,
      entries: [
        {
          id: 'e1',
          collection_id: 'c1',
          slug: 'a-listing',
          status: 'published',
          data: { photo: { url: '/media/used.jpg', alt: 'A photo' } },
        },
      ],
      collections: [{ id: 'c1', name: 'Listings', fields: [{ key: 'photo', label: 'Photo', type: 'image' }] }],
      media: [{ id: 'm1', url: '/media/used.jpg', filename: 'used.jpg', created_at: '2026-01-01T00:00:00Z' }],
    });
    expect(report.findings.filter((f) => f.code === 'orphan-media')).toHaveLength(0);
  });

  it('reports content that has been live and untouched for a very long time', () => {
    const longAgo = new Date(NOW);
    longAgo.setMonth(longAgo.getMonth() - (STALE_AFTER_MONTHS + 2));
    const report = sweep({
      ...base,
      posts: [publishedPost({ updated_at: longAgo.toISOString() })],
    });
    const finding = report.findings.find((f) => f.code === 'stale-content');
    expect(finding?.severity).toBe('tidy');
    expect(finding?.message).toContain('still accurate');
  });

  it('leaves recently updated content alone', () => {
    const report = sweep({ ...base, posts: [publishedPost({ updated_at: '2026-07-01T00:00:00Z' })] });
    expect(report.findings.filter((f) => f.code === 'stale-content')).toHaveLength(0);
  });
});

describe('summarizeReport', () => {
  it('says nothing at all when the site is healthy', () => {
    // A weekly "0 problems" notification is how a useful alert becomes an
    // ignored one.
    expect(summarizeReport(sweep(base))).toBeNull();
  });

  it('leads with problems and mentions tidying second', () => {
    const report = sweep({
      ...base,
      posts: [publishedPost({ seo_description: null })],
      media: [{ id: 'm1', url: '/media/old.jpg', filename: 'old.jpg', created_at: '2026-01-01T00:00:00Z' }],
    });
    expect(summarizeReport(report)).toBe('1 problem on the live website, 1 to tidy up');
  });
});
