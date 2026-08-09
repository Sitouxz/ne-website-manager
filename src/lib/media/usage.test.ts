import { describe, expect, it } from 'vitest';
import {
  describeUsage,
  findEntryUsages,
  findPageUsages,
  findPostUsages,
  findPropertyUsages,
  type MediaUsage,
} from './usage';

const URL = 'https://x.supabase.co/storage/v1/object/public/media/hero.jpg';
const OTHER = 'https://x.supabase.co/storage/v1/object/public/media/other.jpg';

describe('findPostUsages', () => {
  it('finds a post using the file as its cover image', () => {
    const rows = [{ id: 'p1', title: 'Ramadan Timings', status: 'published', cover_url: URL }];
    expect(findPostUsages(rows, URL)).toEqual([
      { entityType: 'post', id: 'p1', title: 'Ramadan Timings', isLive: true, href: '/cms/posts/p1' },
    ]);
  });

  it('finds a file embedded in the post body HTML', () => {
    const rows = [{ id: 'p1', title: 'A', status: 'draft', content: `<p><img src="${URL}"></p>` }];
    expect(findPostUsages(rows, URL)).toHaveLength(1);
  });

  it('finds a file embedded in the Tiptap JSON document', () => {
    const rows = [{
      id: 'p1', title: 'A', status: 'published',
      content_json: { type: 'doc', content: [{ type: 'image', attrs: { src: URL } }] },
    }];
    expect(findPostUsages(rows, URL)).toHaveLength(1);
  });

  it('ignores posts that use a different file', () => {
    const rows = [{ id: 'p1', title: 'A', status: 'published', cover_url: OTHER }];
    expect(findPostUsages(rows, URL)).toEqual([]);
  });

  it('marks only published posts as live', () => {
    const rows = [
      { id: 'p1', title: 'Live', status: 'published', cover_url: URL },
      { id: 'p2', title: 'Draft', status: 'draft', cover_url: URL },
    ];
    expect(findPostUsages(rows, URL).map((u) => u.isLive)).toEqual([true, false]);
  });

  it('falls back to the slug then a placeholder for the title', () => {
    const rows = [
      { id: 'p1', title: '', slug: 'my-slug', status: 'draft', cover_url: URL },
      { id: 'p2', status: 'draft', cover_url: URL },
    ];
    expect(findPostUsages(rows, URL).map((u) => u.title)).toEqual(['my-slug', '(Untitled post)']);
  });
});

describe('findPageUsages', () => {
  it('treats a page as live only when published AND public', () => {
    const rows = [
      { id: 'a', title: 'Home',    status: 'published', visibility: 'public',  content: URL },
      { id: 'b', title: 'Private', status: 'published', visibility: 'private', content: URL },
      { id: 'c', title: 'Draft',   status: 'draft',     visibility: 'public',  content: URL },
    ];
    expect(findPageUsages(rows, URL).map((u) => u.isLive)).toEqual([true, false, false]);
  });
});

describe('findPropertyUsages', () => {
  it('finds a file in the hero or the gallery JSON', () => {
    const rows = [
      { id: 'x', name: 'Cavenagh', status: 'active', hero_url: URL },
      { id: 'y', name: 'Orchard',  status: 'active', gallery: [{ url: URL, alt: 'a' }] },
      { id: 'z', name: 'Other',    status: 'active', hero_url: OTHER },
    ];
    expect(findPropertyUsages(rows, URL).map((u) => u.id)).toEqual(['x', 'y']);
  });

  it('treats an active property as live', () => {
    const rows = [
      { id: 'x', name: 'A', status: 'active',   hero_url: URL },
      { id: 'y', name: 'B', status: 'archived', hero_url: URL },
    ];
    expect(findPropertyUsages(rows, URL).map((u) => u.isLive)).toEqual([true, false]);
  });
});

describe('findEntryUsages', () => {
  it('finds a file anywhere inside the entry data blob', () => {
    const rows = [{
      id: 'e1', collection_id: 'c1', slug: 'friday', status: 'published',
      data: { title: 'Friday Sermon', photo: { url: URL, alt: '' } },
    }];
    const result = findEntryUsages(rows, URL, { c1: 'sermons' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Friday Sermon');
    expect(result[0].href).toBe('/cms/collections/sermons/entries/e1');
  });

  it('falls back to the collection id in the link when the slug is unknown', () => {
    const rows = [{ id: 'e1', collection_id: 'c1', slug: 's', status: 'draft', data: { photo: URL } }];
    expect(findEntryUsages(rows, URL)[0].href).toBe('/cms/collections/c1/entries/e1');
  });
});

describe('describeUsage', () => {
  const usage = (over: Partial<MediaUsage> = {}): MediaUsage => ({
    entityType: 'post', id: '1', title: 'A post', isLive: true, href: '/x', ...over,
  });

  it('reassures the user when the file is unused', () => {
    const lines = describeUsage([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('nothing on your website will change');
  });

  it('counts usages per content type in plain words', () => {
    const lines = describeUsage([
      usage({ entityType: 'post' }),
      usage({ entityType: 'post', id: '2' }),
      usage({ entityType: 'page', id: '3' }),
    ]);
    expect(lines[0]).toBe('This file is used in 2 blog posts and 1 page.');
  });

  it('uses singular nouns for a single usage', () => {
    expect(describeUsage([usage()])[0]).toBe('This file is used in 1 blog post.');
  });

  it('names the live page when exactly one is live', () => {
    const lines = describeUsage([usage({ title: 'Ramadan Timings' })]);
    expect(lines[1]).toContain('break on your live website');
    expect(lines[1]).toContain('"Ramadan Timings"');
  });

  it('lists up to three live usages and summarises the rest', () => {
    const lines = describeUsage([
      usage({ id: '1', title: 'One' }),
      usage({ id: '2', title: 'Two' }),
      usage({ id: '3', title: 'Three' }),
      usage({ id: '4', title: 'Four' }),
      usage({ id: '5', title: 'Five' }),
    ]);
    expect(lines[1]).toContain('5 places');
    expect(lines[1]).toContain('"One", "Two" and "Three"');
    expect(lines[1]).toContain('2 more');
  });

  it('says visitors are unaffected when no usage is live', () => {
    const lines = describeUsage([usage({ isLive: false }), usage({ id: '2', isLive: false })]);
    expect(lines[1]).toContain('visitors will not see a broken image');
  });

  it('always ends with actionable advice', () => {
    const lines = describeUsage([usage()]);
    expect(lines[lines.length - 1]).toContain('Replace the image');
  });

  it('never uses developer vocabulary', () => {
    const lines = describeUsage([usage(), usage({ id: '2', entityType: 'entry', isLive: false })]);
    for (const line of lines) {
      expect(line).not.toMatch(/reference|foreign key|entity|record|null|url/i);
    }
  });
});
