import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from './like-escape';

describe('escapeLikePattern', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeLikePattern('annual report')).toBe('annual report');
  });

  it('escapes the single-character wildcard', () => {
    // Without this, a search for `report_v2` also matches `reportXv2`.
    expect(escapeLikePattern('report_v2')).toBe('report\\_v2');
  });

  it('escapes the any-string wildcard', () => {
    // Without this, searching `50%` matches every row in the table.
    expect(escapeLikePattern('50%')).toBe('50\\%');
  });

  it('escapes backslashes before the wildcards it adds, not after', () => {
    // Order is the whole subtlety. Escaping backslashes last would also
    // escape the ones this function just added, so `a\%b` would come out as a
    // pattern matching a literal backslash followed by anything.
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    expect(escapeLikePattern('a\\%b')).toBe('a\\\\\\%b');
  });

  it('handles a string of nothing but wildcards', () => {
    expect(escapeLikePattern('%_%')).toBe('\\%\\_\\%');
  });

  it('returns empty for empty input', () => {
    expect(escapeLikePattern('')).toBe('');
  });
});
