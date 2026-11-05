import { describe, expect, it } from 'vitest';
import { DEFAULT_CLIENT_CAPABILITIES, getClientCapabilities } from './client-capabilities';
import type { Client } from './supabase/types';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: '1', name: 'Site', slug: 'site', website_url: null, github_repo: null,
    plan: 'standard', is_active: true, created_at: '', updated_at: '', ...overrides,
  };
}

describe('getClientCapabilities', () => {
  it('keeps irrelevant properties hidden by default', () => {
    expect(getClientCapabilities(client()).properties).toBe(false);
  });

  it('lets stored capabilities override defaults', () => {
    expect(getClientCapabilities(client({ capabilities: { properties: true } })).properties).toBe(true);
    expect(getClientCapabilities(client({ capabilities: { posts: false } })).posts).toBe(false);
  });

  it('fills in keys a stored row has never heard of', () => {
    // A row written before a capability existed must keep working — the
    // default applies rather than the module silently disappearing.
    const capabilities = getClientCapabilities(client({ capabilities: { posts: false } }));
    expect(capabilities.media).toBe(true);
    expect(Object.keys(capabilities).sort()).toEqual(Object.keys(DEFAULT_CLIENT_CAPABILITIES).sort());
  });

  it('falls back to defaults with no client at all', () => {
    expect(getClientCapabilities(null)).toEqual(DEFAULT_CLIENT_CAPABILITIES);
    expect(getClientCapabilities(undefined)).toEqual(DEFAULT_CLIENT_CAPABILITIES);
  });

  it('has no per-client branch left — a slug alone changes nothing', () => {
    // Guards the removal of `LEGACY_SLUG_OVERRIDES`. Which modules a website
    // sees is a row in the database (migration 023), never a slug compared
    // against a constant in source. Re-adding such a branch fails here.
    expect(getClientCapabilities(client({ slug: 'kamal-karim' })))
      .toEqual(getClientCapabilities(client({ slug: 'any-other-client' })));
  });
});
