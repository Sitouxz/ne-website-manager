import { describe, expect, it } from 'vitest';
import {
  canPublish,
  canSchedule,
  describeRelease,
  groupMembers,
  isDue,
  publishEventFor,
  type Release,
  type ReleaseMember,
} from './releases';

const NOW = new Date('2026-08-13T12:00:00Z');

const release = (over: Partial<Release> = {}): Release => ({
  id: 'rel-1',
  client_id: 'client-1',
  name: 'Ramadan 2026',
  description: '',
  status: 'draft',
  scheduled_at: null,
  published_at: null,
  ...over,
});

const member = (over: Partial<ReleaseMember> = {}): ReleaseMember => ({
  id: 'm1',
  entityType: 'post',
  title: 'A post',
  status: 'draft',
  ...over,
});

describe('isDue', () => {
  it('is due once its scheduled time has passed', () => {
    expect(isDue(release({ status: 'scheduled', scheduled_at: '2026-08-13T11:59:00Z' }), NOW)).toBe(true);
  });

  it('is due exactly at its scheduled time', () => {
    // Same boundary the per-entity cron uses — the two run in one pass and
    // must not disagree about what a scheduled time means.
    expect(isDue(release({ status: 'scheduled', scheduled_at: '2026-08-13T12:00:00Z' }), NOW)).toBe(true);
  });

  it('is not due before its time', () => {
    expect(isDue(release({ status: 'scheduled', scheduled_at: '2026-08-13T12:01:00Z' }), NOW)).toBe(false);
  });

  it('ignores releases that are not scheduled', () => {
    expect(isDue(release({ status: 'draft', scheduled_at: '2026-01-01T00:00:00Z' }), NOW)).toBe(false);
    expect(isDue(release({ status: 'published', scheduled_at: '2026-01-01T00:00:00Z' }), NOW)).toBe(false);
    expect(isDue(release({ status: 'cancelled', scheduled_at: '2026-01-01T00:00:00Z' }), NOW)).toBe(false);
  });

  it('ignores a scheduled release with no time', () => {
    expect(isDue(release({ status: 'scheduled', scheduled_at: null }), NOW)).toBe(false);
  });
});

describe('canPublish', () => {
  it('allows a draft release with content', () => {
    expect(canPublish(release(), [member()])).toEqual({ ok: true });
  });

  it('refuses an empty release', () => {
    // Publishing nothing succeeds silently, marks the release done and
    // revalidates for no reason — the operator then believes a campaign
    // went live when it did not.
    const result = canPublish(release(), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('empty');
  });

  it('refuses to publish twice', () => {
    const result = canPublish(release({ status: 'published' }), [member()]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('already been published');
  });

  it('refuses a cancelled release and says how to proceed', () => {
    const result = canPublish(release({ status: 'cancelled' }), [member()]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Reopen');
  });
});

describe('canSchedule', () => {
  it('accepts a future time', () => {
    expect(canSchedule(release(), new Date('2026-08-14T00:00:00Z'), NOW)).toEqual({ ok: true });
  });

  it('refuses a past time and offers the alternative', () => {
    const result = canSchedule(release(), new Date('2026-08-12T00:00:00Z'), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('publish it now instead');
  });

  it('refuses an unparseable date', () => {
    expect(canSchedule(release(), new Date('nonsense'), NOW).ok).toBe(false);
  });

  it('refuses to reschedule something already published', () => {
    expect(canSchedule(release({ status: 'published' }), new Date('2026-09-01T00:00:00Z'), NOW).ok).toBe(false);
  });
});

describe('groupMembers', () => {
  it('groups by table so the publisher can do one update per table', () => {
    const grouped = groupMembers([
      member({ id: 'p1', entityType: 'post' }),
      member({ id: 'p2', entityType: 'post' }),
      member({ id: 'pg1', entityType: 'page' }),
      member({ id: 'e1', entityType: 'collection_entry' }),
    ]);
    expect(grouped).toEqual({ post: ['p1', 'p2'], page: ['pg1'], collection_entry: ['e1'] });
  });

  it('returns every group even when empty, so callers need no guards', () => {
    expect(groupMembers([])).toEqual({ post: [], page: [], collection_entry: [] });
  });
});

describe('describeRelease', () => {
  it('says what publishing will do, before the button is pressed', () => {
    expect(describeRelease([member(), member({ id: 'm2' })]))
      .toBe('2 items go live, all at the same moment.');
  });

  it('distinguishes updates to already-live content from new content', () => {
    // Saying "3 items go live" when one is already live misdescribes it.
    const text = describeRelease([
      member({ id: 'm1' }),
      member({ id: 'm2', status: 'published' }),
    ]);
    expect(text).toBe('1 item goes live and 1 already-published item is updated, all at the same moment.');
  });

  it('handles a release that only updates live content', () => {
    expect(describeRelease([member({ status: 'published' })]))
      .toBe('1 already-published item is updated, all at the same moment.');
  });

  it('says plainly when there is nothing in it', () => {
    expect(describeRelease([])).toBe('Nothing is in this release yet.');
  });
});

describe('publishEventFor', () => {
  it('produces one event for the whole release, not one per member', () => {
    // The efficiency half of the feature: a ten-item campaign currently
    // costs ten webhook deliveries and ten rebuild triggers.
    const event = publishEventFor(release(), [member(), member({ id: 'm2' }), member({ id: 'm3' })]);
    expect(event).toEqual({
      event: 'content.published',
      releaseId: 'rel-1',
      releaseName: 'Ramadan 2026',
      memberCount: 3,
    });
  });
});
