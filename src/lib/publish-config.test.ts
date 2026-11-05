import { describe, expect, it } from 'vitest';
import { isPublishingConnected } from './publish-config';

describe('isPublishingConnected', () => {
  it('is true when either mechanism is set', () => {
    expect(isPublishingConnected({ deploy_hook: 'https://hook', revalidate_url: null })).toBe(true);
    expect(isPublishingConnected({ deploy_hook: null, revalidate_url: 'https://site/api/revalidate' })).toBe(true);
    expect(isPublishingConnected({ deploy_hook: 'https://hook', revalidate_url: 'https://site' })).toBe(true);
  });

  it('is false when neither is set', () => {
    expect(isPublishingConnected({ deploy_hook: null, revalidate_url: null })).toBe(false);
    expect(isPublishingConnected({})).toBe(false);
  });

  it('treats a missing row as not connected', () => {
    // No `client_publish_config` row at all is the state a brand new client
    // starts in, and it is exactly the case the alert exists for.
    expect(isPublishingConnected(null)).toBe(false);
    expect(isPublishingConnected(undefined)).toBe(false);
  });

  it('does not count a whitespace-only value as configured', () => {
    // An input the operator tabbed through is not an endpoint, and counting
    // it would silence the alert meant to catch precisely this.
    expect(isPublishingConnected({ deploy_hook: '   ', revalidate_url: '' })).toBe(false);
    expect(isPublishingConnected({ deploy_hook: '  ', revalidate_url: '\n' })).toBe(false);
  });
});
