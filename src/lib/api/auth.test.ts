import { describe, expect, it } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';
import { resolveApiAccess, generateApiKey, hashApiKey } from './auth';

function reqWith(authorization?: string): Request {
  return new Request('https://example.com/api/client/acme/posts', {
    headers: authorization ? { authorization } : {},
  });
}

describe('generateApiKey', () => {
  it('produces a plaintext key matching ne_<prefix>_<secret>, and a matching SHA-256 hash', () => {
    const { plaintext, prefix, keyHash } = generateApiKey();

    expect(plaintext).toMatch(/^ne_[a-f0-9]+_[a-f0-9]+$/);
    expect(plaintext).toContain(`ne_${prefix}_`);
    expect(keyHash).toBe(hashApiKey(plaintext));
    expect(keyHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex digest length
  });

  it('generates unique keys on successive calls', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.prefix).not.toBe(b.prefix);
  });
});

describe('resolveApiAccess', () => {
  it('returns public with clientId=null when the client slug does not exist', async () => {
    const supabase = mockSupabase({ clients: [], api_keys: [] });

    const result = await resolveApiAccess(reqWith(), 'missing-slug', supabase);

    expect(result).toEqual({ level: 'public', clientId: null });
  });

  it('returns public (with the resolved clientId) when no Authorization header is sent', async () => {
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
      api_keys: [],
    });

    const result = await resolveApiAccess(reqWith(), 'acme', supabase);

    expect(result).toEqual({ level: 'public', clientId: 'client-1' });
  });

  it('returns public when the Authorization header is malformed (not "Bearer ne_...")', async () => {
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
      api_keys: [],
    });

    const result = await resolveApiAccess(reqWith('Bearer not-a-real-key'), 'acme', supabase);

    expect(result).toEqual({ level: 'public', clientId: 'client-1' });
  });

  it('returns public when the presented key prefix has no matching row', async () => {
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
      api_keys: [],
    });
    const { plaintext } = generateApiKey();

    const result = await resolveApiAccess(reqWith(`Bearer ${plaintext}`), 'acme', supabase);

    expect(result).toEqual({ level: 'public', clientId: 'client-1' });
  });

  it('returns public when the hash does not match (tampered/wrong secret)', async () => {
    const { prefix, keyHash } = generateApiKey();
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
      api_keys: [{ client_id: 'client-1', prefix, key_hash: keyHash, revoked_at: null }],
    });

    // Right prefix, but a different secret than the one that produced keyHash.
    const forged = `ne_${prefix}_0000000000000000000000000000000000000000000000`;
    const result = await resolveApiAccess(reqWith(`Bearer ${forged}`), 'acme', supabase);

    expect(result).toEqual({ level: 'public', clientId: 'client-1' });
  });

  it('returns public when the matching key has been revoked', async () => {
    const { plaintext, prefix, keyHash } = generateApiKey();
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
      api_keys: [{ client_id: 'client-1', prefix, key_hash: keyHash, revoked_at: '2026-01-01T00:00:00Z' }],
    });

    const result = await resolveApiAccess(reqWith(`Bearer ${plaintext}`), 'acme', supabase);

    expect(result).toEqual({ level: 'public', clientId: 'client-1' });
  });

  it('returns public when the key belongs to a different client than the requested slug', async () => {
    const { plaintext, prefix, keyHash } = generateApiKey();
    const supabase = mockSupabase({
      clients: [
        { id: 'client-1', slug: 'acme' },
        { id: 'client-2', slug: 'other' },
      ],
      api_keys: [{ client_id: 'client-2', prefix, key_hash: keyHash, revoked_at: null }],
    });

    const result = await resolveApiAccess(reqWith(`Bearer ${plaintext}`), 'acme', supabase);

    expect(result).toEqual({ level: 'public', clientId: 'client-1' });
  });

  it('returns keyed with the clientId when the key is valid, unrevoked, and matches the client', async () => {
    const { plaintext, prefix, keyHash } = generateApiKey();
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
      api_keys: [{ client_id: 'client-1', prefix, key_hash: keyHash, revoked_at: null }],
    });

    const result = await resolveApiAccess(reqWith(`Bearer ${plaintext}`), 'acme', supabase);

    expect(result).toEqual({ level: 'keyed', clientId: 'client-1' });
  });

  // The hash comparison uses crypto.timingSafeEqual (not `!==`) to avoid
  // leaking timing information about how many leading hex chars of the
  // stored hash match a guess. These tests confirm the swap didn't change
  // observable behavior: a matching key is still accepted, a near-miss
  // (same length, differs by one char) is still rejected, and a corrupted
  // (wrong-length) stored hash is rejected rather than throwing.
  it('accepts a key whose hash matches exactly (constant-time comparison, matching case)', async () => {
    const { plaintext, prefix, keyHash } = generateApiKey();
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
      api_keys: [{ client_id: 'client-1', prefix, key_hash: keyHash, revoked_at: null }],
    });

    const result = await resolveApiAccess(reqWith(`Bearer ${plaintext}`), 'acme', supabase);

    expect(result).toEqual({ level: 'keyed', clientId: 'client-1' });
  });

  it('rejects a key whose hash differs by a single trailing character (constant-time comparison, near-miss case)', async () => {
    const { plaintext, prefix, keyHash } = generateApiKey();
    const flippedLastChar = keyHash.slice(0, -1) + (keyHash.at(-1) === '0' ? '1' : '0');
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
      api_keys: [{ client_id: 'client-1', prefix, key_hash: flippedLastChar, revoked_at: null }],
    });

    const result = await resolveApiAccess(reqWith(`Bearer ${plaintext}`), 'acme', supabase);

    expect(result).toEqual({ level: 'public', clientId: 'client-1' });
  });

  it('does not throw and returns public when the stored key_hash is a corrupted, non-64-char value', async () => {
    const { plaintext, prefix } = generateApiKey();
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
      api_keys: [{ client_id: 'client-1', prefix, key_hash: 'too-short', revoked_at: null }],
    });

    const result = await resolveApiAccess(reqWith(`Bearer ${plaintext}`), 'acme', supabase);

    expect(result).toEqual({ level: 'public', clientId: 'client-1' });
  });
});
