import { describe, expect, it } from 'vitest';
import { countMissingSeo, isMissingSeo } from './audit';

describe('isMissingSeo', () => {
  it('is false when both fields are present', () => {
    expect(isMissingSeo({ id: '1', seo_title: 'Title', seo_description: 'Description' })).toBe(false);
  });

  it('is true when seo_title is null', () => {
    expect(isMissingSeo({ id: '1', seo_title: null, seo_description: 'Description' })).toBe(true);
  });

  it('is true when seo_description is null', () => {
    expect(isMissingSeo({ id: '1', seo_title: 'Title', seo_description: null })).toBe(true);
  });

  it('is true when seo_title is empty string', () => {
    expect(isMissingSeo({ id: '1', seo_title: '', seo_description: 'Description' })).toBe(true);
  });

  it('is true when seo_title is whitespace-only', () => {
    expect(isMissingSeo({ id: '1', seo_title: '   ', seo_description: 'Description' })).toBe(true);
  });

  it('is true when both fields are missing', () => {
    expect(isMissingSeo({ id: '1', seo_title: null, seo_description: null })).toBe(true);
  });
});

describe('countMissingSeo', () => {
  it('returns 0 when nothing is missing', () => {
    const posts = [{ id: 'p1', seo_title: 'A', seo_description: 'B' }];
    const pages = [{ id: 'g1', seo_title: 'C', seo_description: 'D' }];
    expect(countMissingSeo(posts, pages)).toBe(0);
  });

  it('counts missing posts and pages together', () => {
    const posts = [
      { id: 'p1', seo_title: null, seo_description: 'B' },
      { id: 'p2', seo_title: 'A', seo_description: 'B' },
    ];
    const pages = [
      { id: 'g1', seo_title: null, seo_description: null },
    ];
    expect(countMissingSeo(posts, pages)).toBe(2);
  });

  it('returns 0 for empty arrays', () => {
    expect(countMissingSeo([], [])).toBe(0);
  });
});
