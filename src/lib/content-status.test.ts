import { describe, expect, it } from 'vitest';
import {
  isLiveStatus,
  liveUrl,
  statusDescription,
  statusLabel,
  statusPresentation,
  type AnyContentStatus,
} from './content-status';

const ALL: AnyContentStatus[] = ['draft', 'in_review', 'scheduled', 'published', 'archived', 'active'];

describe('statusLabel', () => {
  it('never shows a raw database value with an underscore', () => {
    expect(statusLabel('in_review')).toBe('Waiting for approval');
    for (const status of ALL) {
      expect(statusLabel(status)).not.toContain('_');
    }
  });

  it('calls published content "Live", because that is what a visitor sees', () => {
    expect(statusLabel('published')).toBe('Live');
  });

  it('gives properties the same label as posts for the equivalent state', () => {
    // `properties.status` is active|archived while posts are published|archived
    // — the user should not have to learn two vocabularies.
    expect(statusLabel('active')).toBe(statusLabel('published'));
    expect(statusLabel('archived')).toBe('Archived');
  });

  it('starts every label with a capital letter', () => {
    for (const status of ALL) {
      expect(statusLabel(status)[0]).toBe(statusLabel(status)[0].toUpperCase());
    }
  });
});

describe('statusDescription', () => {
  it('answers "can anyone see this?" for every status', () => {
    for (const status of ALL) {
      const description = statusDescription(status);
      expect(description.length).toBeGreaterThan(20);
      expect(description).toMatch(/[.]$/);
    }
  });

  it('is explicit that a draft is not on the website', () => {
    expect(statusDescription('draft')).toContain('not on your website');
  });

  it('explains that approval is needed, not just that review is pending', () => {
    expect(statusDescription('in_review')).toContain('approve');
  });

  it('reassures that archived content still exists', () => {
    expect(statusDescription('archived')).toContain('kept here');
  });

  it('never uses developer vocabulary', () => {
    for (const status of ALL) {
      expect(statusDescription(status)).not.toMatch(/status|boolean|null|database|record|RLS/i);
    }
  });
});

describe('isLiveStatus', () => {
  it('treats published and active as visible to visitors', () => {
    expect(isLiveStatus('published')).toBe(true);
    expect(isLiveStatus('active')).toBe(true);
  });

  it('treats everything else as not visible', () => {
    for (const status of ['draft', 'in_review', 'scheduled', 'archived']) {
      expect(isLiveStatus(status)).toBe(false);
    }
  });
});

describe('statusPresentation', () => {
  it('degrades gracefully for unknown, null and undefined values', () => {
    for (const input of ['something_new', null, undefined, '']) {
      const result = statusPresentation(input);
      expect(result.label).toBe('Unknown');
      expect(result.isLive).toBe(false);
    }
  });

  it('marks only the live statuses with the success tone', () => {
    for (const status of ALL) {
      const { tone, isLive } = statusPresentation(status);
      expect(tone === 'success').toBe(isLive);
    }
  });
});

describe('liveUrl', () => {
  it('joins the site address and the live path', () => {
    expect(liveUrl('https://alisla.vercel.app', '/blog/ramadan')).toBe(
      'https://alisla.vercel.app/blog/ramadan'
    );
  });

  it('does not double the slash when the site address has a trailing one', () => {
    expect(liveUrl('https://example.com/', '/about')).toBe('https://example.com/about');
    expect(liveUrl('https://example.com///', '/about')).toBe('https://example.com/about');
  });

  it('adds the missing slash when a path lacks one', () => {
    expect(liveUrl('https://example.com', 'about')).toBe('https://example.com/about');
  });

  it('returns null when there is nothing sensible to link to', () => {
    expect(liveUrl(null, '/about')).toBeNull();
    expect(liveUrl(undefined, '/about')).toBeNull();
    expect(liveUrl('', '/about')).toBeNull();
    expect(liveUrl('https://example.com', null)).toBeNull();
  });

  it('never produces a double slash in the path portion', () => {
    const cases: [string, string][] = [
      ['https://example.com/', '/a'],
      ['https://example.com', '/a'],
      ['https://example.com/', 'a'],
      ['https://example.com', 'a'],
    ];
    for (const [site, path] of cases) {
      const url = liveUrl(site, path)!;
      expect(url.slice('https://'.length)).not.toContain('//');
    }
  });
});
