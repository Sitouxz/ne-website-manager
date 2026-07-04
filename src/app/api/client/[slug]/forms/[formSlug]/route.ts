import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateEntry } from '@/lib/collections/validate';
import type { FieldDef } from '@/lib/collections/types';

/**
 * Public form-submission endpoint (Task 5.2) —
 * `POST /api/client/[slug]/forms/[formSlug]`. This is the ONLY way a
 * submission can reach `form_submissions`: that table's RLS (migration
 * 010_forms.sql) grants no anon-insert policy at all, specifically so every
 * submission passes through this route's honeypot check, rate limit, and
 * `validateEntry` schema validation rather than a raw anon insert that would
 * bypass all three. Both `forms` and `form_submissions` are read/written here
 * via the service-role admin client — `forms` because a `.single()` lookup by
 * (client_id, slug) needs to succeed for an anonymous caller regardless of
 * `forms_public_read`'s policy shape, and `form_submissions` because the
 * insert must bypass RLS entirely (see above).
 */

// Rate limit: 10 submissions per rolling 60s window, per (IP, form) pair.
// Exported so the test suite can compute exactly how many requests are
// needed to trip the limit without hardcoding a duplicate magic number here
// and in the test file (see route.test.ts) — production behavior is
// unaffected, this is just the single source of truth for both.
export const RATE_LIMIT = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Module-scope, in-memory rate-limit store keyed by `${ip}:${formId}`.
 *
 * NOT distributed or durable: this Map lives only in the memory of whichever
 * Fluid Compute instance happens to handle a given request. A cold start or
 * a request routed to a different warm instance sees an empty Map and the
 * caller's budget resets. Per the brief this is an accepted tradeoff
 * ("in-memory Map... good enough on Fluid Compute"), not a bug to fix with
 * Redis or similar — rate limiting here is a best-effort deterrent against
 * casual abuse, not a hard guarantee.
 *
 * Memory management: `checkRateLimit` prunes a key's own stale timestamps
 * (older than the current window) every time that exact key is queried
 * again, so an actively-hit key never grows unboundedly. Keys that stop
 * being hit (e.g. a bot moves on, or an IP churns) are never proactively
 * swept, so the Map's total key count can grow slowly over a long-lived
 * instance's uptime. Accepted as-is: Fluid Compute instances recycle
 * periodically (resetting the whole Map), and the realistic key space —
 * distinct (IP, form) pairs that actually submit — is small relative to
 * typical instance memory. A periodic full sweep or an LRU cap would be the
 * next step if this ever became a real problem, but building that now would
 * be speculative for a feature whose own brief calls for "good enough."
 */
const requestLog = new Map<string, number[]>();

function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (!forwarded) return 'unknown';
  const first = forwarded.split(',')[0]?.trim();
  return first || 'unknown';
}

/** Returns true (and records this request) if under budget; false if the limit is already hit. */
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLog.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= RATE_LIMIT) {
    requestLog.set(key, timestamps);
    return false;
  }

  timestamps.push(now);
  requestLog.set(key, timestamps);
  return true;
}

function isFilled(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function corsHeaders(): Record<string, string> {
  return { 'Access-Control-Allow-Origin': '*' };
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; formSlug: string }> }
) {
  const { slug, formSlug } = await params;
  const admin = createAdminClient();

  const { data: client } = await admin.from('clients').select('id').eq('slug', slug).single();
  if (!client) return json({ error: 'Client not found' }, 404);

  const { data: form } = await admin
    .from('forms')
    .select('*')
    .eq('client_id', client.id as string)
    .eq('slug', formSlug)
    .single();
  if (!form) return json({ error: 'Form not found' }, 404);

  const rateLimitKey = `${getClientIp(req)}:${form.id as string}`;
  if (!checkRateLimit(rateLimitKey)) {
    return json({ error: 'Too many submissions. Please try again in a minute.' }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const data = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;

  const referrer = req.headers.get('referer') ?? null;
  const honeypotField = (form.honeypot_field as string) || 'website';
  const isSpam = isFilled(data[honeypotField]);

  if (isSpam) {
    // Honeypot triggered: still 200 (never tip off a bot that it was
    // caught), but filed as spam instead of a real lead.
    //
    // Deliberately SKIP validateEntry entirely for this path, rather than
    // still validating and only changing the inserted `status`. The whole
    // point of "don't tip off bots" is that a bot with garbage data
    // (missing required fields, wrong types) shouldn't get a 400 with a
    // field-by-field error list either — that response shape is itself a
    // signal a bot could use to iterate its way past detection. Accepting
    // whatever `data` shape arrived keeps the response identical (200,
    // `{ success: true }`) whether the honeypot was tripped by a careless
    // bot with otherwise-valid data or a more sophisticated one that also
    // sent malformed field values.
    const { error: insertError } = await admin.from('form_submissions').insert({
      form_id: form.id,
      client_id: client.id,
      data,
      status: 'spam',
      referrer,
    });
    if (insertError) {
      // Don't let a spam-row insert failure change the response shape (that
      // would itself tip off the bot) — just surface it for monitoring.
      console.error('forms POST: failed to insert spam submission', insertError);
    }
    return json({ success: true });
  }

  // Real submission — validate against the form's actual FieldDef[] schema.
  // `honeypot_field` is never a real FieldDef (it's a separate anti-spam
  // mechanism per migration 010), so it's naturally excluded here:
  // `validateEntry` only iterates `form.fields`, and silently ignores any
  // extra key present in `data` — including the (empty, for a real
  // submission) honeypot key — that doesn't match a FieldDef.
  const fields = (form.fields as FieldDef[]) ?? [];
  const validation = validateEntry(fields, data);
  if (!validation.ok) {
    return json({ error: 'Validation failed', errors: validation.errors }, 400);
  }

  const { data: inserted, error: insertError } = await admin
    .from('form_submissions')
    .insert({ form_id: form.id, client_id: client.id, data, status: 'new', referrer })
    .select()
    .single();

  if (insertError) return json({ error: insertError.message }, 500);

  return json({ success: true, id: (inserted as { id: string }).id });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
