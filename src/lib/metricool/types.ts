/**
 * Metricool API — feature types (no I/O). The concrete HTTP client lives in
 * `./client.ts` (server-only). Endpoint shapes here are derived from the
 * official OpenAPI spec at https://app.metricool.com/api/swagger.json
 * (base URL https://app.metricool.com/api).
 */

/** One brand ("blog") from `GET /admin/simpleProfiles`. */
export interface MetricoolBrand {
  /** The `blogId` used on every analytics call. */
  id: number;
  label: string;
  /** Networks Metricool reports this brand has connected, when provided. */
  networks?: string[];
}

/** A single point from `GET /v2/analytics/timelines`. */
export interface MetricoolTimelinePoint {
  /** ISO-8601 date (day granularity) of the bucket. */
  date: string;
  value: number;
}

/** Networks the timeline endpoint accepts (spec: `network` param). */
export type MetricoolNetwork =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'tiktok'
  | 'youtube'
  | 'pinterest'
  | 'gmb';

/** One Instagram post from `GET /v2/analytics/posts/instagram`. */
export interface MetricoolInstagramPost {
  id: string;
  /** Caption / text, when present. */
  text: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
  permalink: string | null;
  likes: number;
  comments: number;
  /** Metricool's computed engagement for the post, when present. */
  engagement: number | null;
}

/** Normalized per-client social summary returned by `/api/social`. */
export interface SocialSummary {
  configured: boolean;
  brand: { blogId: string; label: string | null } | null;
  /** One entry per requested network + metric timeline. */
  timelines: {
    network: MetricoolNetwork;
    metric: string;
    label: string;
    total: number;
    points: MetricoolTimelinePoint[];
  }[];
  instagramPosts: MetricoolInstagramPost[];
  /** Present when a network is configured but the upstream call failed. */
  warning?: string;
}
