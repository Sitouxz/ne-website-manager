import { describe, expect, it } from 'vitest';
import { getClientCapabilities } from './client-capabilities';
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

  it('uses the legacy property-site profile until the database is migrated', () => {
    const capabilities = getClientCapabilities(client({ slug: 'kamal-karim' }));
    expect(capabilities.properties).toBe(true);
    expect(capabilities.posts).toBe(false);
    expect(capabilities.pages).toBe(false);
  });

  it('lets stored capabilities override defaults', () => {
    expect(getClientCapabilities(client({ capabilities: { properties: true } })).properties).toBe(true);
  });
});
