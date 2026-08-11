import { describe, expect, it } from 'vitest';
import { selectActiveClient } from './workspace-selection';
import type { Client, Profile } from './supabase/types';

const client = (id: string): Client => ({
  id,
  name: id,
  slug: id,
  website_url: null,
  github_repo: null,
  plan: 'standard',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('selectActiveClient', () => {
  it('uses a valid admin selection', () => {
    const profile = { role: 'ne_admin' } as Profile;
    expect(selectActiveClient(profile, [client('a'), client('b')], 'b')?.id).toBe('b');
  });

  it('falls back to the first client for missing or invalid admin selections', () => {
    const profile = { role: 'ne_admin' } as Profile;
    expect(selectActiveClient(profile, [client('a'), client('b')], null)?.id).toBe('a');
    expect(selectActiveClient(profile, [client('a'), client('b')], 'missing')?.id).toBe('a');
  });

  it('pins non-admin users to their assigned client', () => {
    const assigned = client('assigned');
    const profile = { role: 'editor', clients: assigned } as Profile;
    expect(selectActiveClient(profile, [client('other')], 'other')?.id).toBe('assigned');
  });
});
