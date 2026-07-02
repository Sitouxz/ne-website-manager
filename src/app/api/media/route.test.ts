// @vitest-environment node
//
// This suite builds real `Request`/`FormData`/`File` objects and reads the
// file's bytes via the route's `req.formData()` call. Under the project's
// default `jsdom` environment, jsdom's own `File`/`Blob` implementation is
// not fully interop-compatible with Node's native `fetch`/`Request`/
// `FormData` (used by Next.js route handlers) — encoding a jsdom `File`
// into a `FormData` body and then re-parsing it via `req.formData()` hangs
// indefinitely instead of resolving. Forcing the Node environment for just
// this file sidesteps that mismatch; nothing here touches the DOM.
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GET, POST, DELETE } from './route';

type Fixtures = Record<string, unknown[]>;
type MockUser = { id: string } | null;

/** Builds a `mockSupabase()` instance augmented with a minimal `auth.getUser()`. */
function supabaseFor(user: MockUser, fixtures: Fixtures) {
  const base = mockSupabase(fixtures);
  return {
    ...base,
    auth: {
      getUser: async () => ({ data: { user } }),
    },
  };
}

function setSupabase(supabase: unknown) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
}

/**
 * Builds the service-role client stub: a `mockSupabase()`-backed `.from()`
 * (so POST's insert / DELETE's delete actually land somewhere inspectable)
 * plus a hand-rolled `.storage.from('media')` — Storage isn't part of
 * `mockSupabase`, so it's stubbed directly with `vi.fn()`s here.
 */
function adminMockFor(fixtures: Fixtures, opts: { uploadError?: { message: string } } = {}) {
  const base = mockSupabase(fixtures);
  const uploadSpy = vi.fn(async (_path: string, _file: unknown, _options?: unknown) => ({
    error: opts.uploadError ?? null,
  }));
  const removeSpy = vi.fn(async () => ({ error: null }));
  const getPublicUrlSpy = vi.fn((path: string) => ({
    data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/media/${path}` },
  }));

  const supabase = {
    ...base,
    storage: {
      from: (_bucket: string) => ({
        upload: uploadSpy,
        remove: removeSpy,
        getPublicUrl: getPublicUrlSpy,
      }),
    },
  };

  return { supabase, uploadSpy, removeSpy, getPublicUrlSpy };
}

function setAdmin(supabase: unknown) {
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(supabase);
}

const EDITOR = { id: 'user-editor', role: 'editor', client_id: 'client-1' };
const CLIENT_ADMIN = { id: 'user-ca', role: 'client_admin', client_id: 'client-1' };
const NE_ADMIN = { id: 'user-ne', role: 'ne_admin', client_id: null };

function postReq(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value as never);
  }
  return new Request('https://example.com/api/media', { method: 'POST', body: form });
}

function textFile(name: string, type: string, content: string | number) {
  const size = typeof content === 'number' ? content : content.length;
  const bytes = typeof content === 'number' ? new Uint8Array(size) : content;
  return new File([bytes], name, { type });
}

function getReq(query = '') {
  return new Request(`https://example.com/api/media${query}`);
}

function deleteReq(id?: string) {
  const url = id ? `https://example.com/api/media?id=${id}` : 'https://example.com/api/media';
  return new Request(url, { method: 'DELETE' });
}

describe('POST /api/media', () => {
  it('returns 401 when unauthenticated', async () => {
    setSupabase(supabaseFor(null, { profiles: [] }));
    setAdmin(adminMockFor({ media: [] }).supabase);

    const res = await POST(postReq({ file: textFile('a.png', 'image/png', 'hello') }));

    expect(res.status).toBe(401);
  });

  it('rejects a disallowed mime type with 400 and never calls storage.upload', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));
    const { supabase: admin, uploadSpy } = adminMockFor({ media: [] });
    setAdmin(admin);

    const res = await POST(postReq({ file: textFile('malware.exe', 'application/x-msdownload', 'x') }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/unsupported file type/i);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('rejects a file over 25 MB with 400 and never calls storage.upload', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));
    const { supabase: admin, uploadSpy } = adminMockFor({ media: [] });
    setAdmin(admin);

    const tooBig = 25 * 1024 * 1024 + 1;
    const res = await POST(postReq({ file: textFile('big.png', 'image/png', tooBig) }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/25 MB/i);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the 25 MB limit', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));
    const { supabase: admin, uploadSpy } = adminMockFor({ media: [] });
    setAdmin(admin);

    const exact = 25 * 1024 * 1024;
    const res = await POST(postReq({ file: textFile('exact.png', 'image/png', exact) }));

    expect(res.status).toBe(200);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it('uploads a non-admin caller to a path prefixed with their own client_id, ignoring any client_id field they pass', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));
    const { supabase: admin, uploadSpy } = adminMockFor({ media: [] });
    setAdmin(admin);

    const res = await POST(
      postReq({
        file: textFile('photo.png', 'image/png', 'hello'),
        client_id: 'someone-elses-client',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    const uploadedPath = uploadSpy.mock.calls[0][0] as string;
    expect(uploadedPath.startsWith('client-1/')).toBe(true);
    expect(uploadedPath).not.toContain('someone-elses-client');
    expect(body.client_id).toBe('client-1');
  });

  it('requires an explicit client_id for ne_admin, and rejects with 400 (no storage call) when missing', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN] }));
    const { supabase: admin, uploadSpy } = adminMockFor({ media: [] });
    setAdmin(admin);

    const res = await POST(postReq({ file: textFile('photo.png', 'image/png', 'hello') }));

    expect(res.status).toBe(400);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('lets ne_admin upload to an explicitly named client_id', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN] }));
    const { supabase: admin, uploadSpy } = adminMockFor({ media: [] });
    setAdmin(admin);

    const res = await POST(
      postReq({ file: textFile('photo.png', 'image/png', 'hello'), client_id: 'client-9' })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    const uploadedPath = uploadSpy.mock.calls[0][0] as string;
    expect(uploadedPath.startsWith('client-9/')).toBe(true);
    expect(body.client_id).toBe('client-9');
  });

  it('sanitizes the filename so no path separator survives into the storage path (no traversal)', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));
    const { supabase: admin, uploadSpy } = adminMockFor({ media: [] });
    setAdmin(admin);

    const res = await POST(
      postReq({ file: textFile('../../etc/passwd.png', 'image/png', 'hello') })
    );

    expect(res.status).toBe(200);
    const uploadedPath = uploadSpy.mock.calls[0][0] as string;
    // Exactly 3 segments: client_id / year / uuid-filename — no extra
    // segments introduced by the original name's slashes.
    expect(uploadedPath.split('/')).toHaveLength(3);
    expect(uploadedPath).not.toContain('/etc/');
  });

  it('inserts a media row with the resolved client_id, mime type, size, alt, and uploader, and returns it', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));
    const { supabase: admin } = adminMockFor({ media: [] });
    setAdmin(admin);

    const res = await POST(
      postReq({
        file: textFile('photo.png', 'image/png', 'hello'),
        alt: 'A nice photo',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      client_id: 'client-1',
      mime_type: 'image/png',
      size_bytes: 5,
      alt: 'A nice photo',
      uploaded_by: 'user-ca',
      filename: 'photo.png',
    });
    expect(typeof body.url).toBe('string');
    expect(body.url).toContain('client-1/');

    const { data } = await admin.from('media').select('*');
    expect(data).toHaveLength(1);
  });

  it('returns 500 and never calls storage.upload... (rejects when file field missing)', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));
    const { supabase: admin, uploadSpy } = adminMockFor({ media: [] });
    setAdmin(admin);

    const res = await POST(postReq({ alt: 'no file here' }));

    expect(res.status).toBe(400);
    expect(uploadSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/media', () => {
  const IMAGE = {
    id: 'm1',
    client_id: 'client-1',
    url: 'https://x/storage/v1/object/public/media/client-1/2026/a-photo.png',
    filename: 'photo.png',
    mime_type: 'image/png',
    size_bytes: 100,
    alt: '',
    uploaded_by: 'user-ca',
    created_at: '2026-01-02T00:00:00Z',
  };
  const PDF = {
    id: 'm2',
    client_id: 'client-1',
    url: 'https://x/storage/v1/object/public/media/client-1/2026/b-doc.pdf',
    filename: 'doc.pdf',
    mime_type: 'application/pdf',
    size_bytes: 200,
    alt: '',
    uploaded_by: 'user-ca',
    created_at: '2026-01-01T00:00:00Z',
  };
  const OTHER_CLIENT_IMAGE = {
    id: 'm3',
    client_id: 'client-2',
    url: 'https://x/storage/v1/object/public/media/client-2/2026/c-photo.png',
    filename: 'other.png',
    mime_type: 'image/png',
    size_bytes: 100,
    alt: '',
    uploaded_by: 'user-other',
    created_at: '2026-01-03T00:00:00Z',
  };

  it('returns 401 when unauthenticated', async () => {
    setSupabase(supabaseFor(null, { profiles: [], media: [] }));

    const res = await GET(getReq());

    expect(res.status).toBe(401);
  });

  it("lists only the caller's own client media, newest first", async () => {
    setSupabase(
      supabaseFor(CLIENT_ADMIN, {
        profiles: [CLIENT_ADMIN],
        media: [IMAGE, PDF, OTHER_CLIENT_IMAGE],
      })
    );

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2']);
  });

  it('filters by ?type=image to only mime_type LIKE image/%', async () => {
    setSupabase(
      supabaseFor(CLIENT_ADMIN, {
        profiles: [CLIENT_ADMIN],
        media: [IMAGE, PDF],
      })
    );

    const res = await GET(getReq('?type=image'));
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('m1');
  });

  it('requires ?client_id= for ne_admin', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN], media: [OTHER_CLIENT_IMAGE] }));

    const res = await GET(getReq());

    expect(res.status).toBe(400);
  });

  it('lets ne_admin list any client via ?client_id=', async () => {
    setSupabase(
      supabaseFor(NE_ADMIN, {
        profiles: [NE_ADMIN],
        media: [IMAGE, OTHER_CLIENT_IMAGE],
      })
    );

    const res = await GET(getReq('?client_id=client-2'));
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('m3');
  });
});

describe('DELETE /api/media', () => {
  const ROW = {
    id: 'm1',
    client_id: 'client-1',
    url: 'https://project.supabase.co/storage/v1/object/public/media/client-1/2026/uuid-photo.png',
    filename: 'photo.png',
    mime_type: 'image/png',
    size_bytes: 100,
    alt: '',
    uploaded_by: 'user-ca',
    created_at: '2026-01-01T00:00:00Z',
  };
  const OTHER_ROW = { ...ROW, id: 'm2', client_id: 'client-2' };

  it('returns 401 when unauthenticated', async () => {
    setSupabase(supabaseFor(null, { profiles: [], media: [ROW] }));
    setAdmin(adminMockFor({ media: [ROW] }).supabase);

    const res = await DELETE(deleteReq('m1'));

    expect(res.status).toBe(401);
  });

  it('returns 404 when the id does not exist', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR], media: [] }));
    setAdmin(adminMockFor({ media: [] }).supabase);

    const res = await DELETE(deleteReq('missing'));

    expect(res.status).toBe(404);
  });

  it("rejects a non-admin caller deleting another client's media with 403, and never calls storage.remove", async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR], media: [OTHER_ROW] }));
    const { supabase: admin, removeSpy } = adminMockFor({ media: [OTHER_ROW] });
    setAdmin(admin);

    const res = await DELETE(deleteReq('m2'));

    expect(res.status).toBe(403);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('allows the owning client (editor role) to delete their own media: removes storage object and row', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR], media: [ROW] }));
    const { supabase: admin, removeSpy } = adminMockFor({ media: [ROW] });
    setAdmin(admin);

    const res = await DELETE(deleteReq('m1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith(['client-1/2026/uuid-photo.png']);

    const { data } = await admin.from('media').select('*');
    expect(data).toHaveLength(0);
  });

  it('allows ne_admin to delete any client media', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN], media: [OTHER_ROW] }));
    const { supabase: admin } = adminMockFor({ media: [OTHER_ROW] });
    setAdmin(admin);

    const res = await DELETE(deleteReq('m2'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
