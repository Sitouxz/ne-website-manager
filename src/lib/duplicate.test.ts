import { describe, expect, it } from 'vitest';
import { copyTitle, nextCopySlug } from './duplicate';

describe('nextCopySlug', () => {
  it('starts at 1 when nothing has been copied yet', () => {
    expect(nextCopySlug('about', [])).toBe('about-copy-1');
    expect(nextCopySlug('about', ['about', 'contact'])).toBe('about-copy-1');
  });

  it('goes one past the highest existing copy', () => {
    expect(nextCopySlug('about', ['about', 'about-copy-1', 'about-copy-2'])).toBe('about-copy-3');
  });

  it('does not reuse a freed number', () => {
    // `-copy-1` was deleted. Reusing it is fine for a human but the unique
    // index does not care, and a collision here surfaces as a raw database
    // error on an action that should always succeed.
    expect(nextCopySlug('about', ['about', 'about-copy-2'])).toBe('about-copy-3');
  });

  it('ignores gaps and unordered input', () => {
    expect(nextCopySlug('about', ['about-copy-5', 'about-copy-1'])).toBe('about-copy-6');
  });

  it('only counts direct copies of the base', () => {
    // `about-us-copy-1` is a copy of `about-us`, not of `about`.
    expect(nextCopySlug('about', ['about-us-copy-1', 'about-us-copy-9'])).toBe('about-copy-1');
  });

  it('does not treat a copy-of-a-copy as a copy of the original', () => {
    expect(nextCopySlug('about', ['about-copy-1', 'about-copy-1-copy-1'])).toBe('about-copy-2');
  });

  it('ignores non-numeric suffixes', () => {
    expect(nextCopySlug('about', ['about-copy-', 'about-copy-abc', 'about-copy'])).toBe('about-copy-1');
  });

  it('treats regex metacharacters in the base literally', () => {
    // Page paths are slashed and can hold dots; an unescaped base would make
    // `.` match anything and miscount.
    expect(nextCopySlug('/about.us', ['/about.us-copy-1'])).toBe('/about.us-copy-2');
    expect(nextCopySlug('/a+b', ['/aaab-copy-9'])).toBe('/a+b-copy-1');
    expect(nextCopySlug('a(b)', ['a(b)-copy-4'])).toBe('a(b)-copy-5');
  });
});

describe('copyTitle', () => {
  it('appends "(copy)"', () => {
    expect(copyTitle('About us')).toBe('About us (copy)');
  });

  it('falls back for untitled content rather than producing " (copy)"', () => {
    expect(copyTitle('')).toBe('(Untitled) (copy)');
    expect(copyTitle('   ')).toBe('(Untitled) (copy)');
    expect(copyTitle(null)).toBe('(Untitled) (copy)');
    expect(copyTitle(undefined)).toBe('(Untitled) (copy)');
  });

  it('accepts a caller-specific fallback', () => {
    expect(copyTitle(null, '(Untitled entry)')).toBe('(Untitled entry) (copy)');
  });
});
