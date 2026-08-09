import { describe, expect, it } from 'vitest';
import { normalizePath, slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates ordinary titles', () => {
    expect(slugify('Ramadan Timings 2026')).toBe('ramadan-timings-2026');
  });

  it('collapses runs of punctuation into a single hyphen', () => {
    expect(slugify('Hello --- World!!!')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  !Hello!  ')).toBe('hello');
  });

  it('returns an empty string for input with nothing usable', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('matches the behaviour the editors relied on before extraction', () => {
    const inline = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    for (const input of ['Hello World', 'A--B', ' Spaced ', 'Ünïcode', '2026 Plans']) {
      expect(slugify(input)).toBe(inline(input));
    }
  });
});

describe('normalizePath', () => {
  it('adds the leading slash a user will forget', () => {
    expect(normalizePath('about')).toBe('/about');
  });

  it('fixes the exact input that used to save a broken address', () => {
    expect(normalizePath('About Us')).toBe('/about-us');
  });

  it('removes a trailing slash', () => {
    expect(normalizePath('/our-team/')).toBe('/our-team');
  });

  it('preserves multi-segment paths, slugifying each segment', () => {
    expect(normalizePath('blog/my post')).toBe('/blog/my-post');
    expect(normalizePath('/Services/Brand Strategy')).toBe('/services/brand-strategy');
  });

  it('collapses duplicate slashes', () => {
    expect(normalizePath('//blog///post//')).toBe('/blog/post');
  });

  it('treats empty input as the homepage', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('   ')).toBe('/');
    expect(normalizePath('///')).toBe('/');
  });

  it('is idempotent — normalising twice changes nothing', () => {
    for (const input of ['About Us', '/blog/post/', 'a//b', '', 'Ünïcode Page']) {
      const once = normalizePath(input);
      expect(normalizePath(once)).toBe(once);
    }
  });

  it('always produces something safe to put in a URL', () => {
    const inputs = ['About Us', 'a b c', '/A/B/', '!!!', '', 'Hello, World?'];
    for (const input of inputs) {
      const result = normalizePath(input);
      expect(result.startsWith('/')).toBe(true);
      expect(result).not.toMatch(/[^a-z0-9/-]/);
      expect(result).not.toMatch(/\/\//);
      if (result !== '/') expect(result.endsWith('/')).toBe(false);
    }
  });
});
