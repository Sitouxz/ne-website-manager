import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { mockSupabase } from '@/test/supabase-mock';
import { notifyPublish, signPayload, type NotifyPublishClient } from './publish';

describe('signPayload', () => {
  it('computes the HMAC-SHA256 hex digest, matching an independently-computed value', () => {
    const body = '{"hello":"world"}';
    const secret = 'my-secret';
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    expect(signPayload(body, secret)).toBe(expected);
  });

  it('matches a fixed, hand-verified known-answer test vector', () => {
    // Independently computed via `node -e "console.log(require('crypto')
    // .createHmac('sha256','test-secret').update('test-payload').digest('hex'))"`
    // — a hardcoded expectation, not just "the function agrees with itself".
    expect(signPayload('test-payload', 'test-secret')).toBe(
      '5b12467d7c448555779e70d76204105c67d27d1c991f3080c19732f9ac1988ef'
    );
  });

  it('produces different signatures for different secrets over the same body', () => {
    const body = '{"a":1}';
    expect(signPayload(body, 'secret-a')).not.toBe(signPayload(body, 'secret-b'));
  });
});

describe('notifyPublish', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does nothing (no deliveries) when neither revalidate_url nor deploy_hook is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const supabase = mockSupabase({ webhook_deliveries: [] });
    const client: NotifyPublishClient = { id: 'client-1' };

    await notifyPublish(client, { event: 'content.published', entityType: 'post', entityId: 'p1' }, supabase);

    expect(fetchMock).not.toHaveBeenCalled();
    const { data } = await supabase.from('webhook_deliveries').select('*');
    expect(data).toHaveLength(0);
  });

  it('signs the revalidate_url request body with a verifiable HMAC-SHA256 signature', async () => {
    let capturedBody = '';
    let capturedHeaders: Record<string, string> = {};
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      capturedHeaders = init.headers as Record<string, string>;
      return { ok: true, status: 200 } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const supabase = mockSupabase({ webhook_deliveries: [] });
    const client: NotifyPublishClient = {
      id: 'client-1',
      revalidate_url: 'https://example.com/api/revalidate',
      revalidate_secret: 'top-secret',
    };

    await notifyPublish(
      client,
      { event: 'content.published', entityType: 'post', entityId: 'p1', slug: 'hello-world', path: '/blog/hello-world' },
      supabase
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/revalidate',
      expect.objectContaining({ method: 'POST' })
    );

    // Verify the actual HMAC math independently, over the exact bytes sent.
    const expectedSignature = createHmac('sha256', 'top-secret').update(capturedBody).digest('hex');
    expect(capturedHeaders['x-ne-signature']).toBe(expectedSignature);

    // And the payload shape is what we documented — including `path`, the
    // field a generated `createRevalidateHandler` actually revalidates with
    // (see the Phase 7 final-review fix: `slug` alone is ambiguous across
    // entity types, `path` is not).
    const parsed = JSON.parse(capturedBody);
    expect(parsed).toMatchObject({
      event: 'content.published',
      entityType: 'post',
      entityId: 'p1',
      slug: 'hello-world',
      path: '/blog/hello-world',
      clientId: 'client-1',
    });
    expect(typeof parsed.timestamp).toBe('string');

    const { data } = await supabase.from('webhook_deliveries').select('*');
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      client_id: 'client-1',
      url: 'https://example.com/api/revalidate',
      event: 'content.published',
      status_code: 200,
      ok: true,
    });
  });

  it('fires both revalidate_url and deploy_hook when both are set, producing two delivery rows', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      return { ok: true, status: url.includes('deploy') ? 201 : 200 } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const supabase = mockSupabase({ webhook_deliveries: [] });
    const client: NotifyPublishClient = {
      id: 'client-1',
      revalidate_url: 'https://example.com/api/revalidate',
      revalidate_secret: 'shh',
      deploy_hook: 'https://api.vercel.com/v1/integrations/deploy/xyz',
    };

    await notifyPublish(client, { event: 'content.updated', entityType: 'page', entityId: 'pg1' }, supabase);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const { data } = await supabase.from('webhook_deliveries').select('*');
    expect(data).toHaveLength(2);
    const urls = (data ?? []).map((r) => r.url).sort();
    expect(urls).toEqual(['https://api.vercel.com/v1/integrations/deploy/xyz', 'https://example.com/api/revalidate'].sort());
    // Both rows are stamped ok — deploy_hook's row records the logical
    // publish payload for observability even though the wire body it POSTs
    // is empty.
    for (const row of data ?? []) {
      expect(row.ok).toBe(true);
      expect(row.payload).toMatchObject({ event: 'content.updated', entityType: 'page', entityId: 'pg1' });
    }
  });

  describe('path field (Phase 7 final-review fix)', () => {
    async function captureDeliveredPath(params: Parameters<typeof notifyPublish>[1]): Promise<unknown> {
      let capturedBody = '';
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return { ok: true, status: 200 } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);
      const supabase = mockSupabase({ webhook_deliveries: [] });
      const client: NotifyPublishClient = { id: 'client-1', revalidate_url: 'https://example.com/api/revalidate' };

      await notifyPublish(client, params, supabase);

      return JSON.parse(capturedBody).path;
    }

    it('carries a page\'s canonical path through unchanged (already absolute)', async () => {
      const path = await captureDeliveredPath({
        event: 'content.published',
        entityType: 'page',
        entityId: 'pg1',
        slug: '/about',
        path: '/about',
      });
      expect(path).toBe('/about');
    });

    it('carries a collection entry\'s canonical /{collectionSlug}/{itemSlug} path', async () => {
      const path = await captureDeliveredPath({
        event: 'content.published',
        entityType: 'collection_entry',
        entityId: 'ci1',
        slug: 'friday-sermon',
        path: '/sermons/friday-sermon',
      });
      expect(path).toBe('/sermons/friday-sermon');
    });

    it('defaults to null when the caller passes no path at all (e.g. site_globals/menu_item events)', async () => {
      const path = await captureDeliveredPath({
        event: 'content.updated',
        entityType: 'site_globals',
        entityId: 'footer',
        slug: 'footer',
      });
      expect(path).toBeNull();
    });

    it('carries an explicit path: null through as null, not omitted', async () => {
      const path = await captureDeliveredPath({
        event: 'content.updated',
        entityType: 'menu_item',
        entityId: 'm1',
        slug: 'Home',
        path: null,
      });
      expect(path).toBeNull();
    });
  });

  it('records a non-2xx response as a failed (ok: false) delivery and does not throw', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const supabase = mockSupabase({ webhook_deliveries: [] });
    const client: NotifyPublishClient = { id: 'client-1', revalidate_url: 'https://example.com/api/revalidate', revalidate_secret: 's' };

    await expect(
      notifyPublish(client, { event: 'content.published', entityType: 'post', entityId: 'p1' }, supabase)
    ).resolves.toBeUndefined();

    const { data } = await supabase.from('webhook_deliveries').select('*');
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ ok: false, status_code: 500 });
  });

  it('records a network failure (fetch throws) as ok: false, status_code null, and does not throw', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('network down'); });
    vi.stubGlobal('fetch', fetchMock);
    const supabase = mockSupabase({ webhook_deliveries: [] });
    const client: NotifyPublishClient = { id: 'client-1', deploy_hook: 'https://api.vercel.com/v1/integrations/deploy/xyz' };

    await expect(
      notifyPublish(client, { event: 'content.deleted', entityType: 'post', entityId: 'p1' }, supabase)
    ).resolves.toBeUndefined();

    const { data } = await supabase.from('webhook_deliveries').select('*');
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ ok: false, status_code: null });
  });

  it('never throws, and swallows the error, when supabase.insert itself throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const throwingSupabase = {
      from: () => ({
        insert: async () => { throw new Error('db unreachable'); },
      }),
    };
    const client: NotifyPublishClient = { id: 'client-1', revalidate_url: 'https://example.com/api/revalidate' };

    await expect(
      notifyPublish(client, { event: 'content.published', entityType: 'post', entityId: 'p1' }, throwingSupabase)
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('aborts a hanging request once the timeout elapses, never hangs the caller, and records ok: false', async () => {
      // A fetch mock that mimics real `fetch`'s AbortController integration:
      // it never resolves on its own, only rejects once the signal aborts.
      const hangingFetch = vi.fn((_url: string, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            const err = new DOMException('The operation was aborted', 'AbortError');
            reject(err);
          });
        });
      });
      vi.stubGlobal('fetch', hangingFetch);

      const supabase = mockSupabase({ webhook_deliveries: [] });
      const client: NotifyPublishClient = {
        id: 'client-1',
        revalidate_url: 'https://example.com/api/revalidate',
        revalidate_secret: 's',
      };

      // Use a short, test-only timeout override so we don't have to fast-
      // forward the default 5000ms in lockstep, and to prove the bound is
      // actually configurable/enforced rather than hardcoded.
      const resultPromise = notifyPublish(
        client,
        { event: 'content.published', entityType: 'post', entityId: 'p1' },
        supabase,
        { timeoutMs: 50 }
      );

      // Advance exactly past the configured timeout — this is what proves
      // the bound, not just "eventually resolves" with an unrelated wait.
      await vi.advanceTimersByTimeAsync(50);

      await expect(resultPromise).resolves.toBeUndefined();

      const { data } = await supabase.from('webhook_deliveries').select('*');
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({ ok: false, status_code: null });
    });
  });
});
