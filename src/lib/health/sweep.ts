import { checkArticleBeforePublish, checkEntryBeforePublish } from '@/lib/publish-checks';
import { isMissingSeo, type SeoAuditRow } from '@/lib/seo/audit';
import type { FieldDef } from '@/lib/collections/types';

/**
 * The weekly sweep over content that is **already live**.
 *
 * Every check this product owns fires at the moment of publishing:
 * `publish-checks.ts` warns before a save, the SEO manager audits on demand,
 * `webhook_deliveries` records a failed revalidation. All of them answer
 * "is this change good?" — and none of them ever answer "is the website
 * still good?" A page published correctly in March and quietly broken in
 * June by a deleted media file, a retired collection field or a failed
 * revalidation is invisible to all of it, because nobody publishes that page
 * again.
 *
 * That gap is the whole reason a client finds the stale page before NE does.
 * This module closes it by running the existing checks in the one direction
 * they were never pointed: backwards, over published rows, on a schedule.
 *
 * ## Computed, never stored
 *
 * There is deliberately no `site_health_reports` table. A stored report is a
 * second copy of facts the content tables already hold, and it is wrong the
 * moment someone fixes something — which produces the worst possible
 * outcome for a trust-building feature: a dashboard nagging about a problem
 * that was solved yesterday. The sweep is cheap enough to compute on read,
 * so the cron and the dashboard call exactly the same function and can never
 * disagree.
 *
 * ## Severity is about the visitor, not the rule
 *
 * `problem` means a visitor is having a worse time right now (a broken link,
 * a picture no screen reader can describe, a site serving stale content).
 * `tidy` means nobody is harmed but the site is drifting (an unused upload,
 * a page untouched for two years). The dashboard leads with the first and
 * the operator triages the second, which is what keeps the report worth
 * opening every week rather than becoming another number that is always red.
 */

export type FindingSeverity = 'problem' | 'tidy';

export type FindingCode =
  | 'publish-failing'
  | 'missing-seo'
  | 'image-missing-alt'
  | 'broken-internal-link'
  | 'orphan-media'
  | 'stale-content';

export interface HealthFinding {
  code: FindingCode;
  severity: FindingSeverity;
  /** One plain sentence naming what a visitor or the client experiences. */
  message: string;
  /** Where to go and fix it, when there is a single place. */
  href?: string;
  /** What it is about, for grouping in the UI. */
  subject?: string;
}

export interface HealthReport {
  clientId: string;
  clientName: string;
  generatedAt: string;
  findings: HealthFinding[];
  problemCount: number;
  tidyCount: number;
}

/** Published rows from `posts` / `pages`, loosely typed so both fit. */
export interface HealthArticle {
  id: string;
  title?: string | null;
  slug?: string | null;
  path?: string | null;
  status: string;
  updated_at?: string | null;
  cover_url?: string | null;
  cover_alt?: string | null;
  content?: string | null;
  content_json?: unknown;
  seo_title?: string | null;
  seo_description?: string | null;
}

export interface HealthEntry {
  id: string;
  collection_id: string;
  slug?: string | null;
  status: string;
  updated_at?: string | null;
  data: Record<string, unknown> | null;
}

export interface HealthCollection {
  id: string;
  name: string;
  fields: FieldDef[];
}

export interface HealthMedia {
  id: string;
  url: string;
  filename?: string | null;
  created_at?: string | null;
}

export interface HealthDelivery {
  ok: boolean;
  url: string;
  created_at?: string | null;
}

export interface SweepInput {
  clientId: string;
  clientName: string;
  posts: HealthArticle[];
  pages: HealthArticle[];
  entries: HealthEntry[];
  collections: HealthCollection[];
  media: HealthMedia[];
  deliveries: HealthDelivery[];
  /** Injected so tests are deterministic and the cron can pin one timestamp. */
  now?: Date;
}

/** Published content untouched for longer than this is flagged as drifting. */
export const STALE_AFTER_MONTHS = 18;

/** Uploads older than this with no reference anywhere are worth a clear-out. */
const ORPHAN_GRACE_DAYS = 30;

const isPublished = (row: { status: string }) => row.status === 'published';

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function articleTitle(row: HealthArticle): string {
  return row.title?.trim() || row.slug?.trim() || row.path?.trim() || 'Untitled';
}

/**
 * Every internal path a piece of content links to.
 *
 * Only same-site links are collected: an external URL that 404s is the other
 * site's problem and not something an administrator here can fix, so
 * reporting it would be noise in a report whose whole value is that every
 * line is actionable. Anchors, query strings, `mailto:` and `tel:` are
 * dropped for the same reason.
 */
export function extractInternalLinks(content: string): string[] {
  const found = new Set<string>();
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;

  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(content)) !== null) {
    const raw = match[1].trim();
    if (!raw.startsWith('/')) continue;
    if (raw.startsWith('//')) continue; // protocol-relative — external
    const path = raw.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
    found.add(path);
  }
  return [...found];
}

function contentOf(row: HealthArticle): string {
  const parts = [row.content ?? ''];
  if (row.content_json) parts.push(JSON.stringify(row.content_json));
  return parts.join(' ');
}

/**
 * Paths a visitor can actually reach. Pages contribute their `path`; posts
 * contribute the `/blog/<slug>` convention the SDK and the publish helper
 * already assume.
 */
function livePaths(pages: HealthArticle[], posts: HealthArticle[]): Set<string> {
  const paths = new Set<string>(['/']);
  for (const page of pages.filter(isPublished)) {
    const path = (page.path ?? '').trim().replace(/\/+$/, '');
    if (path) paths.add(path.startsWith('/') ? path : `/${path}`);
  }
  for (const post of posts.filter(isPublished)) {
    const slug = (post.slug ?? '').trim();
    if (slug) paths.add(`/blog/${slug}`);
  }
  return paths;
}

export function sweep(input: SweepInput): HealthReport {
  const now = input.now ?? new Date();
  const findings: HealthFinding[] = [];

  // --- Is the live site even receiving updates? -------------------------
  // Listed first because it invalidates everything below it: if publishing
  // is failing, the website is not showing what this CMS says it shows, and
  // no other finding can be trusted.
  const recentFailures = input.deliveries.filter((d) => !d.ok);
  if (recentFailures.length > 0) {
    findings.push({
      code: 'publish-failing',
      severity: 'problem',
      subject: 'Publishing',
      message:
        recentFailures.length === 1
          ? 'The last update could not be delivered to the website, so visitors may still be seeing the previous version.'
          : `${recentFailures.length} updates could not be delivered to the website, so visitors may still be seeing older versions.`,
      href: '/settings',
    });
  }

  // --- Published content that search engines cannot describe ------------
  for (const post of input.posts.filter(isPublished)) {
    if (isMissingSeo(post as SeoAuditRow)) {
      findings.push({
        code: 'missing-seo',
        severity: 'problem',
        subject: articleTitle(post),
        message: `"${articleTitle(post)}" is live with no search description, so Google writes its own summary for it.`,
        href: `/cms/posts/${post.id}`,
      });
    }
  }
  for (const page of input.pages.filter(isPublished)) {
    if (isMissingSeo(page as SeoAuditRow)) {
      findings.push({
        code: 'missing-seo',
        severity: 'problem',
        subject: articleTitle(page),
        message: `"${articleTitle(page)}" is live with no search description, so Google writes its own summary for it.`,
        href: `/cms/pages/${page.id}`,
      });
    }
  }

  // --- Pictures nobody can describe, on pages already live --------------
  // Reuses the pre-publish checks verbatim rather than reimplementing them,
  // so the sweep and the publish dialog can never disagree about what counts
  // as a problem.
  for (const { row, href, kind } of [
    ...input.posts.filter(isPublished).map((row) => ({ row, href: `/cms/posts/${row.id}`, kind: 'post' })),
    ...input.pages.filter(isPublished).map((row) => ({ row, href: `/cms/pages/${row.id}`, kind: 'page' })),
  ]) {
    const missingAlt = checkArticleBeforePublish({
      html: row.content ?? '',
      seoTitle: row.seo_title ?? null,
      seoDescription: row.seo_description ?? null,
      coverUrl: row.cover_url ?? null,
      coverAlt: row.cover_alt ?? null,
    }).filter((w) => w.code === 'image-missing-alt');

    if (missingAlt.length === 0) continue;
    // The warning's own wording is reused verbatim rather than re-derived —
    // it already counts the images correctly and is already phrased in the
    // product's voice. Rewriting it here is how the sweep and the publish
    // dialog would drift into describing the same problem two ways.
    findings.push({
      code: 'image-missing-alt',
      severity: 'problem',
      subject: articleTitle(row),
      message: `On the live ${kind} "${articleTitle(row)}": ${missingAlt.map((w) => w.message).join(' ')}`,
      href,
    });
  }

  const collectionsById = new Map(input.collections.map((c) => [c.id, c]));
  for (const entry of input.entries.filter(isPublished)) {
    const collection = collectionsById.get(entry.collection_id);
    if (!collection) continue;

    const warnings = checkEntryBeforePublish({ fields: collection.fields, data: entry.data ?? {} });
    const label = entry.slug?.trim() || 'an entry';
    const href = `/cms/collections/${collection.id}/entries/${entry.id}`;

    const missingAlt = warnings.filter((w) => w.code === 'image-missing-alt');
    if (missingAlt.length > 0) {
      findings.push({
        code: 'image-missing-alt',
        severity: 'problem',
        subject: `${collection.name}: ${label}`,
        message: `On the live ${collection.name} entry "${label}": ${missingAlt.map((w) => w.message).join(' ')}`,
        href,
      });
    }

    if (warnings.some((w) => w.code === 'seo-description-missing')) {
      findings.push({
        code: 'missing-seo',
        severity: 'problem',
        subject: `${collection.name}: ${label}`,
        message: `The live ${collection.name} entry "${label}" has no search description, so Google writes its own summary for it.`,
        href,
      });
    }
  }

  // --- Links that go nowhere --------------------------------------------
  const reachable = livePaths(input.pages, input.posts);
  const articles = [
    ...input.posts.filter(isPublished).map((row) => ({ row, href: `/cms/posts/${row.id}` })),
    ...input.pages.filter(isPublished).map((row) => ({ row, href: `/cms/pages/${row.id}` })),
  ];

  for (const { row, href } of articles) {
    for (const link of extractInternalLinks(contentOf(row))) {
      if (reachable.has(link)) continue;
      findings.push({
        code: 'broken-internal-link',
        severity: 'problem',
        subject: articleTitle(row),
        message: `"${articleTitle(row)}" links to ${link}, which is not a published page — visitors clicking it get an error.`,
        href,
      });
    }
  }

  // --- Uploads nothing points at ----------------------------------------
  // A grace period matters: an image uploaded ten minutes ago for a draft
  // that is still being written is not an orphan, and flagging it teaches
  // people to ignore the report.
  const haystack = [
    ...input.posts.map(contentOf),
    ...input.pages.map(contentOf),
    ...input.posts.map((p) => p.cover_url ?? ''),
    ...input.pages.map((p) => p.cover_url ?? ''),
    ...input.entries.map((e) => JSON.stringify(e.data ?? {})),
  ].join(' ');

  for (const item of input.media) {
    if (!item.url) continue;
    if (haystack.includes(item.url)) continue;
    const uploaded = item.created_at ? new Date(item.created_at) : null;
    if (uploaded && daysBetween(uploaded, now) < ORPHAN_GRACE_DAYS) continue;

    findings.push({
      code: 'orphan-media',
      severity: 'tidy',
      subject: item.filename ?? item.url,
      message: `"${item.filename ?? item.url}" is in the media library but is not used on any page.`,
      href: '/cms/media',
    });
  }

  // --- Content nobody has touched in a very long time -------------------
  for (const { row, href } of articles) {
    if (!row.updated_at) continue;
    const months = monthsBetween(new Date(row.updated_at), now);
    if (months < STALE_AFTER_MONTHS) continue;

    findings.push({
      code: 'stale-content',
      severity: 'tidy',
      subject: articleTitle(row),
      message: `"${articleTitle(row)}" has been live and unchanged for ${months} months — worth checking it is still accurate.`,
      href,
    });
  }

  return {
    clientId: input.clientId,
    clientName: input.clientName,
    generatedAt: now.toISOString(),
    findings,
    problemCount: findings.filter((f) => f.severity === 'problem').length,
    tidyCount: findings.filter((f) => f.severity === 'tidy').length,
  };
}

/**
 * One line for a digest or an activity-log entry. Says nothing at all when
 * there is nothing wrong — a weekly "0 problems" notification is how a
 * useful alert becomes an ignored one.
 */
export function summarizeReport(report: HealthReport): string | null {
  if (report.problemCount === 0 && report.tidyCount === 0) return null;

  const parts: string[] = [];
  if (report.problemCount > 0) {
    parts.push(`${report.problemCount} ${report.problemCount === 1 ? 'problem' : 'problems'} on the live website`);
  }
  if (report.tidyCount > 0) {
    parts.push(`${report.tidyCount} to tidy up`);
  }
  return parts.join(', ');
}
