/**
 * Verifies API keys presented to the public, per-client read endpoints
 * (`/api/client/[slug]/...`). Keys are sent as:
 *
 *   Authorization: Bearer ne_<prefix>_<secret>
 *
 * `prefix` is a short, non-secret identifier used to look the row up;
 * `secret` is the high-entropy part. Only a SHA-256 hash of the *full*
 * presented key (`ne_<prefix>_<secret>`) is ever stored or compared —
 * the plaintext key is shown to the user exactly once, at generation
 * time, and is never persisted or logged anywhere.
 */

import { createHash, randomBytes } from 'crypto';

export type ApiAccessLevel = 'public' | 'keyed';

export interface ApiAccessResult {
  level: ApiAccessLevel;
  clientId: string | null;
}

type Row = Record<string, unknown>;

/**
 * Minimal shape `resolveApiAccess` needs from a Supabase client — matches
 * both the real `SupabaseClient` and `mockSupabase()` from Task 1.1.
 */
export interface ApiAuthClient {
  from(table: string): {
    select(columns?: string): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): unknown;
        single(): PromiseLike<{ data: Row | null; error: unknown }>;
      };
    };
  };
}

const KEY_PATTERN = /^ne_([A-Za-z0-9]+)_([A-Za-z0-9]+)$/;

function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function extractKeyPrefix(presentedKey: string): string | null {
  const match = KEY_PATTERN.exec(presentedKey);
  return match ? match[1] : null;
}

/** SHA-256 hex digest of a full presented/generated key string. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface GeneratedApiKey {
  /** Shown to the caller exactly once — never persisted. */
  plaintext: string;
  /** Non-secret identifier, safe to display and store for lookup. */
  prefix: string;
  /** SHA-256 hex digest of `plaintext` — the only form persisted to the DB. */
  keyHash: string;
}

/** Generates a new `ne_<prefix>_<secret>` API key. Uses `crypto.randomBytes` for both parts. */
export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(4).toString('hex'); // 8 hex chars — display/lookup identifier
  const secret = randomBytes(24).toString('hex'); // 48 hex chars — high-entropy secret
  const plaintext = `ne_${prefix}_${secret}`;
  return { plaintext, prefix, keyHash: hashApiKey(plaintext) };
}

/**
 * Resolves the access level a request should be granted against
 * `clientSlug`'s public content.
 *
 * Always resolves `clientId` from `clientSlug` first (needed for the
 * `public` fallback too). If a well-formed, unrevoked key is presented
 * whose stored hash matches and whose `client_id` matches the resolved
 * client, access is `'keyed'`. Any failure along the way (no header,
 * malformed key, unknown prefix, revoked key, hash mismatch, or a key
 * that belongs to a *different* client) falls back to `'public'` — never
 * throws, so a bad `Authorization` header degrades to public access
 * rather than breaking the request.
 */
export async function resolveApiAccess(
  req: Request,
  clientSlug: string,
  supabase: ApiAuthClient
): Promise<ApiAccessResult> {
  const { data: clientRow } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', clientSlug)
    .single();

  const clientId = typeof clientRow?.id === 'string' ? clientRow.id : null;
  if (!clientId) {
    return { level: 'public', clientId: null };
  }

  const presentedKey = extractBearerToken(req.headers.get('authorization'));
  if (!presentedKey) return { level: 'public', clientId };

  const prefix = extractKeyPrefix(presentedKey);
  if (!prefix) return { level: 'public', clientId };

  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('*')
    .eq('prefix', prefix)
    .single();

  if (!keyRow) return { level: 'public', clientId };
  if (keyRow.revoked_at) return { level: 'public', clientId };
  if (keyRow.client_id !== clientId) return { level: 'public', clientId };
  if (hashApiKey(presentedKey) !== keyRow.key_hash) return { level: 'public', clientId };

  return { level: 'keyed', clientId };
}
