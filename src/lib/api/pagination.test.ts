import { describe, expect, it } from 'vitest';
import { parsePagination } from './pagination';

const OPTIONS = { defaultLimit: 100, maxLimit: 100 };

function urlWith(query: string): URL {
  return new URL(`https://example.com/api/client/acme/posts${query}`);
}

describe('parsePagination', () => {
  it('applies defaultLimit and offset 0 when no params are present', () => {
    const result = parsePagination(urlWith(''), OPTIONS);
    expect(result).toEqual({ limit: 100, offset: 0 });
  });

  it('passes through a limit within range', () => {
    const result = parsePagination(urlWith('?limit=25'), OPTIONS);
    expect(result.limit).toBe(25);
  });

  it('passes through an explicit offset', () => {
    const result = parsePagination(urlWith('?offset=40'), OPTIONS);
    expect(result.offset).toBe(40);
  });

  it('combines an explicit limit and offset', () => {
    const result = parsePagination(urlWith('?limit=10&offset=20'), OPTIONS);
    expect(result).toEqual({ limit: 10, offset: 20 });
  });

  it('clamps a limit above maxLimit down to maxLimit', () => {
    const result = parsePagination(urlWith('?limit=500'), { defaultLimit: 50, maxLimit: 100 });
    expect(result.limit).toBe(100);
  });

  it('falls back to defaultLimit when limit is negative', () => {
    const result = parsePagination(urlWith('?limit=-5'), { defaultLimit: 50, maxLimit: 100 });
    expect(result.limit).toBe(50);
  });

  it('falls back to defaultLimit when limit is non-numeric', () => {
    const result = parsePagination(urlWith('?limit=banana'), { defaultLimit: 50, maxLimit: 100 });
    expect(result.limit).toBe(50);
  });

  it('allows an explicit limit of exactly 0 (distinct from an invalid/negative limit)', () => {
    const result = parsePagination(urlWith('?limit=0'), { defaultLimit: 50, maxLimit: 100 });
    expect(result.limit).toBe(0);
  });

  it('clamps a negative offset to 0', () => {
    const result = parsePagination(urlWith('?offset=-10'), OPTIONS);
    expect(result.offset).toBe(0);
  });

  it('clamps a non-numeric offset to 0', () => {
    const result = parsePagination(urlWith('?offset=banana'), OPTIONS);
    expect(result.offset).toBe(0);
  });

  it('truncates fractional limit and offset values', () => {
    const result = parsePagination(urlWith('?limit=10.9&offset=5.9'), OPTIONS);
    expect(result).toEqual({ limit: 10, offset: 5 });
  });

  it('a default limit is used as-is without being clamped by maxLimit (server-controlled default)', () => {
    // Pages route relies on this: pass a defaultLimit larger than maxLimit
    // to express "effectively unbounded unless the caller opts into paging".
    const result = parsePagination(urlWith(''), { defaultLimit: 100000, maxLimit: 100 });
    expect(result.limit).toBe(100000);
  });
});
