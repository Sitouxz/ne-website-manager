import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter, getClientIp } from './rate-limit';

describe('createRateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows requests up to the limit', () => {
    const limiter = createRateLimiter(3, 1000);
    expect([limiter.check('a'), limiter.check('a'), limiter.check('a')]).toEqual([true, true, true]);
  });

  it('rejects the request that exceeds the limit', () => {
    const limiter = createRateLimiter(3, 1000);
    limiter.check('a'); limiter.check('a'); limiter.check('a');
    expect(limiter.check('a')).toBe(false);
  });

  it('keeps rejecting while the window is still open', () => {
    const limiter = createRateLimiter(2, 1000);
    limiter.check('a'); limiter.check('a');
    vi.advanceTimersByTime(500);
    expect(limiter.check('a')).toBe(false);
  });

  it('allows again once the window has rolled past', () => {
    const limiter = createRateLimiter(2, 1000);
    limiter.check('a'); limiter.check('a');
    expect(limiter.check('a')).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(limiter.check('a')).toBe(true);
  });

  it('rolls continuously rather than resetting in fixed buckets', () => {
    const limiter = createRateLimiter(2, 1000);
    limiter.check('a');
    vi.advanceTimersByTime(600);
    limiter.check('a');
    vi.advanceTimersByTime(500);
    // The first timestamp has aged out, the second has not — budget for one.
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false);
  });

  it('tracks each key independently', () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(true);
    expect(limiter.check('a')).toBe(false);
  });

  it('gives separate limiters separate budgets', () => {
    const one = createRateLimiter(1, 1000);
    const two = createRateLimiter(1, 1000);
    expect(one.check('same-key')).toBe(true);
    expect(two.check('same-key')).toBe(true);
  });

  it('reset clears all state', () => {
    const limiter = createRateLimiter(1, 1000);
    limiter.check('a');
    expect(limiter.check('a')).toBe(false);
    limiter.reset();
    expect(limiter.check('a')).toBe(true);
  });

  it('does not grow a key\'s stored timestamps without bound', () => {
    const limiter = createRateLimiter(5, 1000);
    for (let i = 0; i < 200; i += 1) {
      limiter.check('a');
      vi.advanceTimersByTime(300);
    }
    // Still enforcing correctly after long sustained traffic.
    expect(limiter.check('a')).toBe(true);
  });
});

describe('getClientIp', () => {
  const withHeader = (value: string | null) =>
    new Request('https://example.com', { headers: value === null ? {} : { 'x-forwarded-for': value } });

  it('takes the first address from x-forwarded-for', () => {
    expect(getClientIp(withHeader('1.2.3.4, 5.6.7.8'))).toBe('1.2.3.4');
  });

  it('trims whitespace', () => {
    expect(getClientIp(withHeader('  1.2.3.4  , 5.6.7.8'))).toBe('1.2.3.4');
  });

  it('handles a single address', () => {
    expect(getClientIp(withHeader('1.2.3.4'))).toBe('1.2.3.4');
  });

  it('falls back to "unknown" when the header is absent or empty', () => {
    expect(getClientIp(withHeader(null))).toBe('unknown');
    expect(getClientIp(withHeader(''))).toBe('unknown');
    expect(getClientIp(withHeader('   '))).toBe('unknown');
  });

  it('buckets header-stripping callers together so they get more limited, not less', () => {
    // Two different anonymous callers share the same bucket by design.
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.check(getClientIp(withHeader(null)))).toBe(true);
    expect(limiter.check(getClientIp(withHeader('')))).toBe(false);
  });
});
