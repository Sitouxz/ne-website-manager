import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { POST, OPTIONS, RATE_LIMIT } from './route';

function setAdmin(fixtures: Record<string, unknown[]>) {
  const admin = mockSupabase(fixtures);
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return admin;
}

const CLIENT = { id: 'client-1', slug: 'acme' };

const CONTACT_FORM = {
  id: 'form-1',
  client_id: 'client-1',
  slug: 'contact',
  name: 'Contact Us',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
  ],
  notify_emails: [],
  honeypot_field: 'website',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

function postReq(
  formSlug: string,
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request(`https://example.com/api/client/acme/forms/${formSlug}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function params(slug = 'acme', formSlug = 'contact') {
  return Promise.resolve({ slug, formSlug });
}

function fixtures(extra: Record<string, unknown[]> = {}) {
  return {
    clients: [CLIENT],
    forms: [CONTACT_FORM],
    form_submissions: [],
    ...extra,
  };
}

describe('POST /api/client/[slug]/forms/[formSlug] — 404s', () => {
  it('404s for an unknown client slug', async () => {
    setAdmin(fixtures());

    const res = await POST(postReq('contact', {}), {
      params: params('missing-client', 'contact'),
    });

    expect(res.status).toBe(404);
  });

  it('404s for an unknown form slug', async () => {
    setAdmin(fixtures());

    const res = await POST(postReq('does-not-exist', {}), {
      params: params('acme', 'does-not-exist'),
    });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/client/[slug]/forms/[formSlug] — successful submission', () => {
  it('200s and inserts a row with status "new" and the submitted data', async () => {
    const admin = setAdmin(fixtures());

    const res = await POST(
      postReq('contact', { name: 'Ada Lovelace', email: 'ada@example.com', website: '' }),
      { params: params() }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const { data: rows } = await admin.from('form_submissions').select('*');
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      form_id: 'form-1',
      client_id: 'client-1',
      status: 'new',
      data: { name: 'Ada Lovelace', email: 'ada@example.com', website: '' },
    });
  });

  it('sets CORS header on success and OPTIONS returns 204', async () => {
    setAdmin(fixtures());

    const res = await POST(
      postReq('contact', { name: 'Ada', email: 'ada@example.com' }),
      { params: params() }
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const optRes = await OPTIONS();
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('POST /api/client/[slug]/forms/[formSlug] — validation', () => {
  it('400s with per-field errors when a required field is empty', async () => {
    setAdmin(fixtures());

    const res = await POST(postReq('contact', { name: '', email: '' }), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errors).toHaveProperty('name');
    expect(body.errors).toHaveProperty('email');
  });

  it('does not insert a row when validation fails', async () => {
    const admin = setAdmin(fixtures());

    await POST(postReq('contact', { name: '' }), { params: params() });

    const { data: rows } = await admin.from('form_submissions').select('*');
    expect(rows).toHaveLength(0);
  });
});

describe('POST /api/client/[slug]/forms/[formSlug] — honeypot', () => {
  it('200s but inserts with status "spam" when the honeypot field is filled', async () => {
    const admin = setAdmin(fixtures());

    const res = await POST(
      postReq('contact', { name: 'Bot', email: 'bot@example.com', website: 'http://spam.example' }),
      { params: params() }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const { data: rows } = await admin.from('form_submissions').select('*');
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe('spam');
  });

  it('still 200s (not 400) when the honeypot is filled AND real fields are missing/invalid', async () => {
    const admin = setAdmin(fixtures());

    const res = await POST(
      postReq('contact', { website: 'http://spam.example' }), // name/email missing entirely
      { params: params() }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const { data: rows } = await admin.from('form_submissions').select('*');
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe('spam');
  });
});

describe('POST /api/client/[slug]/forms/[formSlug] — rate limiting', () => {
  // Each test in this describe block uses its own form slug/id so the
  // module-scope rate-limit Map (keyed by ip:formId) can't leak budget
  // between tests that happen to run in the same file/process.
  const RATE_LIMIT_FORM = { ...CONTACT_FORM, id: 'form-rl-1', slug: 'rate-limited-1' };

  it(`allows exactly ${RATE_LIMIT} requests then 429s on the next one, for the same IP+form`, async () => {
    setAdmin(fixtures({ forms: [RATE_LIMIT_FORM] }));

    const body = { name: 'Ada', email: 'ada@example.com' };
    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMIT + 1; i++) {
      const res = await POST(postReq('rate-limited-1', body), {
        params: params('acme', 'rate-limited-1'),
      });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, RATE_LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses[RATE_LIMIT]).toBe(429);
  });

  it('scopes the limit per IP+form: a different form for the same IP is unaffected', async () => {
    const OTHER_FORM = { ...CONTACT_FORM, id: 'form-rl-2', slug: 'rate-limited-2' };
    setAdmin(fixtures({ forms: [{ ...CONTACT_FORM, id: 'form-rl-3', slug: 'rate-limited-3' }, OTHER_FORM] }));

    const body = { name: 'Ada', email: 'ada@example.com' };
    // Exhaust the budget for rate-limited-3.
    for (let i = 0; i < RATE_LIMIT; i++) {
      await POST(postReq('rate-limited-3', body), { params: params('acme', 'rate-limited-3') });
    }
    const exhausted = await POST(postReq('rate-limited-3', body), { params: params('acme', 'rate-limited-3') });
    expect(exhausted.status).toBe(429);

    // A different form, same (mocked) IP, should still be fresh.
    const otherRes = await POST(postReq('rate-limited-2', body), { params: params('acme', 'rate-limited-2') });
    expect(otherRes.status).toBe(200);
  });

  it('scopes the limit per IP: a different x-forwarded-for is unaffected', async () => {
    const FORM = { ...CONTACT_FORM, id: 'form-rl-4', slug: 'rate-limited-4' };
    setAdmin(fixtures({ forms: [FORM] }));

    const body = { name: 'Ada', email: 'ada@example.com' };
    for (let i = 0; i < RATE_LIMIT; i++) {
      await POST(postReq('rate-limited-4', body), { params: params('acme', 'rate-limited-4') });
    }
    const exhausted = await POST(postReq('rate-limited-4', body), { params: params('acme', 'rate-limited-4') });
    expect(exhausted.status).toBe(429);

    const otherIpRes = await POST(
      postReq('rate-limited-4', body, { 'x-forwarded-for': '9.9.9.9' }),
      { params: params('acme', 'rate-limited-4') }
    );
    expect(otherIpRes.status).toBe(200);
  });
});
