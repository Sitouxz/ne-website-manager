/**
 * One vocabulary for content status across the whole CMS.
 *
 * The database uses developer words — `draft`, `in_review`, `scheduled`,
 * `published`, `archived`, `active` — and every screen was rendering them
 * raw. Two problems for the people who actually use this:
 *
 *  - `in_review` appeared literally, underscore and all.
 *  - "Published" describes what *you* did. "Live" describes what a visitor
 *    can see, which is the thing the user is actually trying to find out.
 *
 * Each status also carries a one-line explanation of who can see the content,
 * because "is this visible yet?" is the question behind nearly every support
 * message about a CMS.
 *
 * Pure and dependency-free so lists, editors, badges and dialogs all read from
 * the same place and cannot drift.
 */

/** Every status string any content table can hold (`properties` uses `active`). */
export type AnyContentStatus =
  | 'draft'
  | 'in_review'
  | 'scheduled'
  | 'published'
  | 'archived'
  | 'active';

export type StatusTone = 'success' | 'warning' | 'neutral' | 'muted';

export interface StatusPresentation {
  /** Short label for badges, filters and dropdowns. */
  label: string;
  /** One sentence on who can see this content right now. */
  description: string;
  tone: StatusTone;
  /** Whether a website visitor can see this content. */
  isLive: boolean;
}

const PRESENTATION: Record<AnyContentStatus, StatusPresentation> = {
  draft: {
    label: 'Draft',
    description: 'Only you and your team can see this. It is not on your website.',
    tone: 'neutral',
    isLive: false,
  },
  in_review: {
    label: 'Waiting for approval',
    description: 'Someone with publishing access needs to approve this before it goes live.',
    tone: 'warning',
    isLive: false,
  },
  scheduled: {
    label: 'Scheduled',
    description: 'This will appear on your website automatically at the time you chose.',
    tone: 'warning',
    isLive: false,
  },
  published: {
    // "Live" rather than "Published": the user wants to know what a visitor
    // sees, not what action was taken.
    label: 'Live',
    description: 'Anyone visiting your website can see this now.',
    tone: 'success',
    isLive: true,
  },
  active: {
    label: 'Live',
    description: 'Anyone visiting your website can see this now.',
    tone: 'success',
    isLive: true,
  },
  archived: {
    label: 'Archived',
    description: 'Removed from your website, but kept here in case you need it again.',
    tone: 'muted',
    isLive: false,
  },
};

const UNKNOWN: StatusPresentation = {
  label: 'Unknown',
  description: 'This item has an unrecognised status. Contact support if it stays this way.',
  tone: 'muted',
  isLive: false,
};

/** Full presentation for a status. Unknown values degrade rather than throw. */
export function statusPresentation(status: string | null | undefined): StatusPresentation {
  if (!status) return UNKNOWN;
  return PRESENTATION[status as AnyContentStatus] ?? UNKNOWN;
}

/** Short label for badges and filters — `in_review` -> "Waiting for approval". */
export function statusLabel(status: string | null | undefined): string {
  return statusPresentation(status).label;
}

/** One-sentence explanation of who can currently see the content. */
export function statusDescription(status: string | null | undefined): string {
  return statusPresentation(status).description;
}

/** Whether a website visitor can see content in this status. */
export function isLiveStatus(status: string | null | undefined): boolean {
  return statusPresentation(status).isLive;
}

/**
 * Builds the address a piece of content is (or would be) live at, for a
 * "View live page" link. Returns `null` when there's nothing sensible to link
 * to — no website configured, or no path for this entity type.
 *
 * `livePath` is whatever `computeLivePath` in `lib/publish-client.ts` produced,
 * so the link a user clicks and the address the publish webhook revalidates are
 * always the same string.
 */
export function liveUrl(websiteUrl: string | null | undefined, livePath: string | null): string | null {
  if (!websiteUrl || !livePath) return null;
  return `${websiteUrl.replace(/\/+$/, '')}${livePath.startsWith('/') ? livePath : `/${livePath}`}`;
}
