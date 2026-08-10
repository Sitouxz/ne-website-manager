/**
 * Best-effort, in-memory rate limiting for public endpoints.
 *
 * Extracted from `api/client/[slug]/forms/[formSlug]/route.ts`, which had the
 * only implementation. The analytics ingest endpoint is equally public, writes
 * with the service-role client, and had no limiting at all — so the same
 * casual-abuse deterrent now covers both instead of living in one route.
 *
 * NOT distributed or durable: each store lives in the memory of whichever
 * Fluid Compute instance handles a request. A cold start, or a request routed
 * to a different warm instance, sees an empty store and the caller's budget
 * resets. That is an accepted tradeoff — this is a deterrent against casual
 * abuse and runaway clients, not a security guarantee. A shared store (Redis
 * or Supabase) would be the next step if it ever needs to be one.
 *
 * Memory: a key's own stale timestamps are pruned whenever that key is queried
 * again, so an actively-hit key never grows unboundedly. Keys that go quiet
 * are not swept — instances recycle, and the realistic key space is small.
 */

export interface RateLimiter {
  /** Records the request and returns true if it is within budget. */
  check(key: string): boolean;
  /** Test hook — drops all recorded state. */
  reset(): void;
}

/**
 * Creates an isolated limiter. Each caller gets its own store, so one
 * endpoint's traffic can never consume another's budget.
 *
 * @param limit Requests allowed per rolling window.
 * @param windowMs Length of the rolling window in milliseconds.
 */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const requestLog = new Map<string, number[]>();

  return {
    check(key: string): boolean {
      const now = Date.now();
      const windowStart = now - windowMs;
      const timestamps = (requestLog.get(key) ?? []).filter((t) => t > windowStart);

      if (timestamps.length >= limit) {
        requestLog.set(key, timestamps);
        return false;
      }

      timestamps.push(now);
      requestLog.set(key, timestamps);
      return true;
    },
    reset() {
      requestLog.clear();
    },
  };
}

/**
 * First address in `x-forwarded-for`, or `'unknown'`. Every request without a
 * usable address shares the `'unknown'` bucket, which is deliberate: it means
 * a caller stripping the header gets *more* limited, not less.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (!forwarded) return 'unknown';
  const first = forwarded.split(',')[0]?.trim();
  return first || 'unknown';
}
