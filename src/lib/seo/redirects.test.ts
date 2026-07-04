import { describe, expect, it } from 'vitest';
import { isSameOriginRedirectPath } from './redirects';

describe('isSameOriginRedirectPath', () => {
  it('accepts a normal relative path', () => {
    expect(isSameOriginRedirectPath('/about')).toBe(true);
  });

  it('accepts the bare root path', () => {
    expect(isSameOriginRedirectPath('/')).toBe(true);
  });

  it('rejects a protocol-relative URL', () => {
    expect(isSameOriginRedirectPath('//evil.com')).toBe(false);
  });

  it('rejects an absolute https URL', () => {
    expect(isSameOriginRedirectPath('https://evil.com')).toBe(false);
  });

  it('rejects a javascript: URI', () => {
    expect(isSameOriginRedirectPath('javascript:alert(1)')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isSameOriginRedirectPath('')).toBe(false);
  });

  it('accepts a deeper relative path', () => {
    expect(isSameOriginRedirectPath('/blog/new-slug')).toBe(true);
  });

  it('rejects an absolute http URL', () => {
    expect(isSameOriginRedirectPath('http://evil.com')).toBe(false);
  });

  it('rejects a data: URI', () => {
    expect(isSameOriginRedirectPath('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects a path not starting with a slash', () => {
    expect(isSameOriginRedirectPath('about')).toBe(false);
  });
});
