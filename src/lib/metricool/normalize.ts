/**
 * Pure helpers for the Metricool integration — no I/O, unit-tested. Kept
 * separate from `./client.ts` so date-range and response-shaping logic can be
 * tested without hitting the network (mirrors how `lib/finance` / `lib/seo`
 * split pure logic from I/O elsewhere in the codebase).
 */
import type { MetricoolTimelinePoint, MetricoolInstagramPost } from './types';

/**
 * ISO-8601 instant for `from`/`to` on Metricool analytics calls (the spec's
 * example format is `2021-01-01T10:00:00+01:00`). We anchor to UTC midnight so
 * ranges are stable regardless of server timezone.
 */
export function isoRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  start.setUTCHours(0, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * Metricool timeline responses vary in shape across networks/versions. This
 * coerces the common forms — an array of `[timestamp, value]` tuples, an array
 * of `{ date/dateTime, value }` objects, or a `{ values: [...] }` wrapper —
 * into a single normalized point list. Unknown/garbage entries are dropped
 * rather than throwing, so one odd row never blanks the whole chart.
 */
export function normalizeTimeline(raw: unknown): MetricoolTimelinePoint[] {
  const arr = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.values)
      ? raw.values
      : isRecord(raw) && Array.isArray(raw.data)
        ? raw.data
        : [];

  const points: MetricoolTimelinePoint[] = [];
  for (const entry of arr) {
    if (Array.isArray(entry) && entry.length >= 2) {
      const date = toDate(entry[0]);
      const value = toNumber(entry[1]);
      if (date !== null && value !== null) points.push({ date, value });
      continue;
    }
    if (isRecord(entry)) {
      const date = toDate(entry.date ?? entry.dateTime ?? entry.day ?? entry.timestamp);
      const value = toNumber(entry.value ?? entry.count ?? entry.total);
      if (date !== null && value !== null) points.push({ date, value });
    }
  }
  return points;
}

export function sumTimeline(points: MetricoolTimelinePoint[]): number {
  return points.reduce((total, point) => total + point.value, 0);
}

/** Coerces one raw Instagram post object into our shape; returns null if unusable. */
export function normalizeInstagramPost(raw: unknown): MetricoolInstagramPost | null {
  if (!isRecord(raw)) return null;
  const id = raw.id ?? raw.postId ?? raw.mediaId;
  if (id === undefined || id === null) return null;
  return {
    id: String(id),
    text: typeof raw.text === 'string' ? raw.text : typeof raw.caption === 'string' ? raw.caption : null,
    publishedAt: toDate(raw.publishedAt ?? raw.date ?? raw.publishedDate) ?? null,
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : typeof raw.picture === 'string' ? raw.picture : null,
    permalink: typeof raw.permalink === 'string' ? raw.permalink : typeof raw.url === 'string' ? raw.url : null,
    likes: toNumber(raw.likes ?? raw.likeCount) ?? 0,
    comments: toNumber(raw.comments ?? raw.commentCount) ?? 0,
    engagement: toNumber(raw.engagement),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function toDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Metricool timeline tuples use epoch milliseconds.
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}
