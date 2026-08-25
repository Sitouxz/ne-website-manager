/**
 * Content Releases — publishing a set of changes together, or not at all.
 *
 * Scheduling in this CMS is per-entity: one post, one page, one entry, each
 * with its own `scheduled_at`, each flipped independently by the five-minute
 * cron. That is right for an article and wrong for a campaign. A Ramadan
 * launch is a schedule entry, a banner, a nav item and three posts; scheduled
 * individually they go live in whatever order the cron selects them, each
 * firing its own revalidation, and the window in between is a half-published
 * website.
 *
 * A release makes the set the unit: named, previewed together, published
 * together, and — the part that also makes it cheaper — revalidated **once**
 * instead of once per member.
 *
 * This module is the decision layer only: what is due, what may be published,
 * what a release is going to do. The database work lives in the cron and the
 * publish route, so every rule here is testable without a database.
 */

export type ReleaseStatus = 'draft' | 'scheduled' | 'published' | 'cancelled';

export interface Release {
  id: string;
  client_id: string;
  name: string;
  description: string;
  status: ReleaseStatus;
  scheduled_at: string | null;
  published_at: string | null;
}

export type ReleaseEntityType = 'post' | 'page' | 'collection_entry';

export interface ReleaseMember {
  id: string;
  entityType: ReleaseEntityType;
  title: string;
  /** The member's own status right now, before the release publishes. */
  status: string;
}

/**
 * Whether a release is due to go live.
 *
 * Deliberately mirrors the per-entity cron's rule (`scheduled_at <= now`)
 * rather than inventing a second notion of "due" — the two run in the same
 * pass and must not disagree about what a scheduled time means.
 */
export function isDue(release: Release, now: Date = new Date()): boolean {
  if (release.status !== 'scheduled') return false;
  if (!release.scheduled_at) return false;
  return new Date(release.scheduled_at).getTime() <= now.getTime();
}

export type PublishCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether a release can be published at all.
 *
 * The empty-release case is the one worth being strict about: publishing
 * nothing succeeds silently, marks the release done, and fires a
 * revalidation that changes nothing — so the operator believes a campaign
 * went live when it did not. A refusal here is far kinder than that.
 */
export function canPublish(release: Release, members: ReleaseMember[]): PublishCheck {
  if (release.status === 'published') {
    return { ok: false, reason: 'This release has already been published.' };
  }
  if (release.status === 'cancelled') {
    return { ok: false, reason: 'This release was cancelled. Reopen it before publishing.' };
  }
  if (members.length === 0) {
    return { ok: false, reason: 'This release is empty — add the content that should go live together.' };
  }
  return { ok: true };
}

export type ScheduleCheck = { ok: true } | { ok: false; reason: string };

export function canSchedule(release: Release, at: Date, now: Date = new Date()): ScheduleCheck {
  if (release.status === 'published') {
    return { ok: false, reason: 'This release has already been published.' };
  }
  if (Number.isNaN(at.getTime())) {
    return { ok: false, reason: 'That is not a valid date and time.' };
  }
  if (at.getTime() <= now.getTime()) {
    return { ok: false, reason: 'Pick a time in the future, or publish it now instead.' };
  }
  return { ok: true };
}

/**
 * Members grouped by table, so the publisher can issue one bulk UPDATE per
 * table rather than one per row. Order within a group does not matter — the
 * whole point is that they become live in the same pass.
 */
export function groupMembers(members: ReleaseMember[]): Record<ReleaseEntityType, string[]> {
  const grouped: Record<ReleaseEntityType, string[]> = { post: [], page: [], collection_entry: [] };
  for (const member of members) grouped[member.entityType].push(member.id);
  return grouped;
}

/**
 * What publishing this release will actually change, in the product's voice
 * — stated before the button is pressed rather than after.
 *
 * Members already published are called out separately: they are in the
 * release because their *content* changed, and saying "3 pages will go live"
 * when one of them is already live would misdescribe the action.
 */
export function describeRelease(members: ReleaseMember[]): string {
  if (members.length === 0) return 'Nothing is in this release yet.';

  const alreadyLive = members.filter((m) => m.status === 'published').length;
  const goingLive = members.length - alreadyLive;
  const parts: string[] = [];

  if (goingLive > 0) {
    parts.push(`${goingLive} ${goingLive === 1 ? 'item goes' : 'items go'} live`);
  }
  if (alreadyLive > 0) {
    parts.push(
      `${alreadyLive} already-published ${alreadyLive === 1 ? 'item is' : 'items are'} updated`,
    );
  }
  return `${parts.join(' and ')}, all at the same moment.`;
}

/**
 * The single publish event a release fires.
 *
 * One release, one notification — not one per member. This is the efficiency
 * half of the feature: a ten-item campaign currently costs ten webhook
 * deliveries and ten rebuild triggers, and every one of them is a chance for
 * the partial-publish window the release exists to close.
 */
export interface ReleasePublishEvent {
  event: 'content.published';
  releaseId: string;
  releaseName: string;
  memberCount: number;
}

export function publishEventFor(release: Release, members: ReleaseMember[]): ReleasePublishEvent {
  return {
    event: 'content.published',
    releaseId: release.id,
    releaseName: release.name,
    memberCount: members.length,
  };
}
