import { describe, expect, it } from 'vitest';
import {
  buildPublicUrl,
  canonicalUrlError,
  displayHost,
  displayUrl,
  resolveShareImage,
  truncateForSearch,
} from './preview';

describe('truncateForSearch', () => {
  it('returns short text unchanged, with whitespace collapsed', () => {
    expect(truncateForSearch('  Friday   sermon ', 60)).toBe('Friday sermon');
  });

  it('cuts on a word boundary and adds an ellipsis', () => {
    const text = 'Annual community open house with food, talks and a guided tour of the new hall';
    const out = truncateForSearch(text, 40);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).not.toMatch(/\s…$/);
    expect(text.startsWith(out.slice(0, -1))).toBe(true);
  });

  it('hard-cuts a single long word rather than returning nothing', () => {
    const out = truncateForSearch('a'.repeat(100), 20);
    expect(out).toBe(`${'a'.repeat(19)}…`);
  });
});

describe('buildPublicUrl', () => {
  it('joins the site origin and path', () => {
    expect(buildPublicUrl('https://example.com', '/blog/hello')).toBe('https://example.com/blog/hello');
  });

  it('ignores any path already on the website URL and normalises slashes', () => {
    expect(buildPublicUrl('https://example.com/home/', 'about')).toBe('https://example.com/about');
  });

  it('returns null without a valid site URL', () => {
    expect(buildPublicUrl(null, '/a')).toBeNull();
    expect(buildPublicUrl('not a url', '/a')).toBeNull();
  });
});

describe('displayUrl / displayHost', () => {
  it('renders a breadcrumb of host and path segments', () => {
    expect(displayUrl('https://example.com/blog/hello')).toBe('example.com › blog › hello');
  });

  it('falls back to a placeholder when there is no URL', () => {
    expect(displayUrl(null)).toBe('your-website.com');
    expect(displayHost(null)).toBe('YOUR-WEBSITE.COM');
  });

  it('upper-cases the host for social cards', () => {
    expect(displayHost('https://www.example.com/x')).toBe('WWW.EXAMPLE.COM');
  });
});

describe('resolveShareImage', () => {
  it('prefers the explicit social image', () => {
    expect(resolveShareImage('https://cdn/og.jpg', 'https://cdn/cover.jpg')).toBe('https://cdn/og.jpg');
  });

  it('falls back when the social image is empty or blank', () => {
    expect(resolveShareImage('', 'https://cdn/cover.jpg')).toBe('https://cdn/cover.jpg');
    expect(resolveShareImage('   ', 'https://cdn/cover.jpg')).toBe('https://cdn/cover.jpg');
    expect(resolveShareImage(null, null)).toBeNull();
  });
});

describe('canonicalUrlError', () => {
  it('accepts empty and absolute http(s) URLs', () => {
    expect(canonicalUrlError('')).toBeNull();
    expect(canonicalUrlError('https://example.com/a')).toBeNull();
    expect(canonicalUrlError('http://example.com/a')).toBeNull();
  });

  it('rejects relative paths and other protocols', () => {
    expect(canonicalUrlError('/blog/a')).not.toBeNull();
    expect(canonicalUrlError('ftp://example.com')).not.toBeNull();
    expect(canonicalUrlError('javascript:alert(1)')).not.toBeNull();
  });
});
