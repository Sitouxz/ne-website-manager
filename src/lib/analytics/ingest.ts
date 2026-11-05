import { isBotUserAgent } from '@/lib/analytics/bots';

/**
 * Validation and server-side derivation for analytics beacon payloads, shared
 * by the single-event route (`POST /api/client/[slug]/analytics`) and the
 * batch route (`POST …/analytics/batch`). Pure: takes the parsed body plus
 * request context and returns the row to insert (or null to drop it).
 *
 * Never trust the client: every field is type-checked, length-capped and
 * range-clamped here, and device/browser/bot/country/referrer host are
 * derived from request headers or normalized server-side.
 */

/** Cap on the serialized `metadata` blob (public, unauthenticated endpoint). */
export const MAX_METADATA_BYTES = 2_000;
/** Longest engaged time one `page_leave` flush may report (30 min). */
export const MAX_ENGAGED_MS = 30 * 60_000;
/** How far back a queued event may be backdated via `age_ms`. */
export const MAX_EVENT_AGE_MS = 5 * 60_000;
/** Max events per batch request. */
export const MAX_BATCH_EVENTS = 20;

export type IngestContext = {
  clientId: string;
  userAgent: string;
  country: string | null;
  nowMs: number;
};

export type AnalyticsEventRow = {
  client_id: string;
  event_name: string;
  path: string;
  title: string | null;
  referrer: string | null;
  referrer_host: string | null;
  visitor_id: string | null;
  session_id: string | null;
  device: string;
  browser: string;
  country: string | null;
  metadata: Record<string, unknown>;
  is_bot: boolean;
  is_entry: boolean | null;
  is_new_visitor: boolean | null;
  screen_w: number | null;
  lang: string | null;
  tracker_version: number | null;
  engaged_ms: number | null;
  scroll_pct: number | null;
  created_at: string;
};

export function boundedMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    if (JSON.stringify(value).length > MAX_METADATA_BYTES) return {};
  } catch {
    // Circular or otherwise unserializable — not something to persist.
    return {};
  }
  return value as Record<string, unknown>;
}

export function parseDevice(userAgent: string) {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  if (/mobile|iphone|android/i.test(userAgent)) return 'mobile';
  if (!userAgent) return 'unknown';
  return 'desktop';
}

export function parseBrowser(userAgent: string) {
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/opr\//i.test(userAgent)) return 'Opera';
  if (/chrome|crios/i.test(userAgent)) return 'Chrome';
  if (/firefox|fxios/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  return userAgent ? 'Other' : 'unknown';
}

export function cleanPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '/';
  try {
    return new URL(value).pathname || '/';
  } catch {
    return value.startsWith('/') ? value.slice(0, 300) : `/${value.slice(0, 299)}`;
  }
}

/** Lower-cased hostname without a leading `www.`, or null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Referrer reduced to origin + path: query strings and fragments on a
 * referring URL can carry search terms, emails or tokens, and nothing in the
 * dashboard needs them.
 */
export function cleanReferrer(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'android-app:') return null;
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
function int(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Turns one beacon payload into an `analytics_events` row. Returns null for a
 * payload that is not an object.
 *
 * Accepted fields (all optional): `event_name`, `path`, `title`, `referrer`,
 * `visitor_id`, `session_id`, `metadata`, and from tracker v3: `tv` (tracker
 * version), `is_entry`, `is_new_visitor`, `screen_w`, `lang`, `engaged_ms`,
 * `scroll_pct`, `age_ms` (how long the event sat in the client queue).
 */
export function normalizeEvent(body: unknown, ctx: IngestContext): AnalyticsEventRow | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  const eventName = str(b.event_name, 80)?.trim() || 'page_view';
  const isLeave = eventName === 'page_leave';
  const referrer = cleanReferrer(b.referrer);
  const ageMs = int(b.age_ms, 0, MAX_EVENT_AGE_MS) ?? 0;
  const lang = str(b.lang, 35)?.toLowerCase().replace(/[^a-z0-9-]/g, '') || null;

  return {
    client_id: ctx.clientId,
    event_name: eventName,
    path: cleanPath(b.path),
    title: str(b.title, 200),
    referrer,
    referrer_host: hostOf(referrer),
    visitor_id: str(b.visitor_id, 120),
    session_id: str(b.session_id, 120),
    device: parseDevice(ctx.userAgent),
    browser: parseBrowser(ctx.userAgent),
    country: ctx.country ? ctx.country.slice(0, 8).toUpperCase() : null,
    metadata: boundedMetadata(b.metadata),
    is_bot: isBotUserAgent(ctx.userAgent),
    is_entry: eventName === 'page_view' ? bool(b.is_entry) : null,
    is_new_visitor: bool(b.is_new_visitor),
    screen_w: int(b.screen_w, 0, 20_000),
    lang,
    tracker_version: int(b.tv, 1, 1_000),
    engaged_ms: isLeave ? int(b.engaged_ms, 0, MAX_ENGAGED_MS) : null,
    scroll_pct: isLeave ? int(b.scroll_pct, 0, 100) : null,
    created_at: new Date(ctx.nowMs - ageMs).toISOString(),
  };
}

/** Country from the edge's geo header (Vercel, then Cloudflare). */
export function countryFromHeaders(headers: Headers): string | null {
  const c = headers.get('x-vercel-ip-country') ?? headers.get('cf-ipcountry');
  return c && /^[A-Za-z0-9]{2}$/.test(c) ? c.toUpperCase() : null;
}
