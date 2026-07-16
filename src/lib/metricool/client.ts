import type {
  MetricoolBrand,
  MetricoolNetwork,
  MetricoolTimelinePoint,
  MetricoolInstagramPost,
} from './types';
import { normalizeTimeline, normalizeInstagramPost } from './normalize';

/**
 * Server-only Metricool REST client. Auth is account-level (Neu Entity's own
 * Metricool account): `userToken` goes in the `X-Mc-Auth` header and `userId`
 * on every query, both from env — they are never sent to the browser and never
 * stored per-client. The per-client `blogId` (brand) is passed in by the
 * caller (looked up from `client_social_config`).
 *
 * Spec: https://app.metricool.com/api/swagger.json (base https://app.metricool.com/api)
 */

const BASE = 'https://app.metricool.com/api';

export class MetricoolNotConfiguredError extends Error {
  constructor() {
    super('Metricool is not configured — set METRICOOL_USER_TOKEN and METRICOOL_USER_ID.');
    this.name = 'MetricoolNotConfiguredError';
  }
}

/** True when the account-level credentials are present. */
export function isMetricoolConfigured(): boolean {
  return Boolean(process.env.METRICOOL_USER_TOKEN && process.env.METRICOOL_USER_ID);
}

function credentials(): { userToken: string; userId: string } {
  const userToken = process.env.METRICOOL_USER_TOKEN;
  const userId = process.env.METRICOOL_USER_ID;
  if (!userToken || !userId) throw new MetricoolNotConfiguredError();
  return { userToken, userId };
}

async function mcGet<T>(path: string, query: Record<string, string | number | undefined>): Promise<T> {
  const { userToken, userId } = credentials();
  const url = new URL(BASE + path);
  url.searchParams.set('userId', userId);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    headers: { 'X-Mc-Auth': userToken, Accept: 'application/json' },
    // Social stats move slowly and the upstream is rate-limited; cache for 30 min.
    next: { revalidate: 1800 },
  });
  if (!res.ok) {
    throw new Error(`Metricool ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** `GET /admin/simpleProfiles` — the brands on this Metricool account. */
export async function listBrands(): Promise<MetricoolBrand[]> {
  const data = await mcGet<unknown>('/admin/simpleProfiles', {});
  const arr = Array.isArray(data) ? data : [];
  const brands: MetricoolBrand[] = [];
  for (const raw of arr) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const id = record.id ?? record.blogId;
    if (id === undefined || id === null) continue;
    brands.push({
      id: Number(id),
      label: typeof record.label === 'string' ? record.label : typeof record.title === 'string' ? record.title : String(id),
      networks: Array.isArray(record.networks) ? (record.networks as string[]) : undefined,
    });
  }
  return brands;
}

/** `GET /v2/analytics/timelines` — a metric time series for one network. */
export async function getTimeline(args: {
  blogId: string;
  network: MetricoolNetwork;
  metric: string;
  from: string;
  to: string;
  timezone?: string;
}): Promise<MetricoolTimelinePoint[]> {
  const raw = await mcGet<unknown>('/v2/analytics/timelines', {
    blogId: args.blogId,
    network: args.network,
    metric: args.metric,
    from: args.from,
    to: args.to,
    timezone: args.timezone,
  });
  return normalizeTimeline(raw);
}

/** `GET /v2/analytics/posts/instagram` — Instagram posts created in the period. */
export async function getInstagramPosts(args: {
  blogId: string;
  from: string;
  to: string;
  timezone?: string;
}): Promise<MetricoolInstagramPost[]> {
  const raw = await mcGet<unknown>('/v2/analytics/posts/instagram', {
    blogId: args.blogId,
    from: args.from,
    to: args.to,
    timezone: args.timezone,
  });
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { data?: unknown[] }).data)
      ? (raw as { data: unknown[] }).data
      : [];
  return arr.map(normalizeInstagramPost).filter((post): post is MetricoolInstagramPost => post !== null);
}
