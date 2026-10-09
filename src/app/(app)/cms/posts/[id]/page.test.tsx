import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockSupabase } from '@/test/supabase-mock';

/**
 * Regression for posts going live with `published_at = null`. Picking
 * "Publish now" in the Status dropdown writes 'published' into the form
 * before the save button runs, and the save used to compare against that
 * form value, so the publish was never treated as one: no `published_at`
 * stamp, and a `content.updated` notify where `content.published` was due.
 */

const POST_ID = 'post-1';
const CLIENT_ID = 'client-1';

let db: ReturnType<typeof mockSupabase>;
const firePublishNotify = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    ...db,
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/AppShell', () => ({
  useSelectedClient: () => ({ selectedClientId: CLIENT_ID }),
  useSuggestionsEnabled: () => false,
}));
vi.mock('@/components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
vi.mock('@/components/Topbar', () => ({ default: () => null }));
vi.mock('@/components/MediaPicker', () => ({ default: () => null }));
vi.mock('@/components/SuggestButton', () => ({ default: () => null }));
vi.mock('@/components/editor/RichTextEditor', () => ({ default: () => null }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('@/lib/publish-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/publish-client')>()),
  firePublishNotify: (...args: unknown[]) => firePublishNotify(...args),
}));

import PostEditor from './page';

function seed(post: Record<string, unknown>) {
  db = mockSupabase({
    profiles: [{ id: 'user-1', client_id: CLIENT_ID, role: 'client_admin' }],
    clients: [{ id: CLIENT_ID, website_url: 'https://example.com', blog_path: '/insights' }],
    posts: [{
      id: POST_ID,
      client_id: CLIENT_ID,
      title: 'How to choose a freight forwarder',
      slug: 'how-to-choose-a-freight-forwarder',
      // Enough content that the publish preflight has nothing to warn about,
      // so a single click publishes.
      content: `<p>${'Body copy. '.repeat(80)}</p>`,
      excerpt: 'Excerpt',
      seo_title: 'How to choose a freight forwarder',
      seo_description: 'A practical guide to choosing a freight forwarder in Singapore.',
      cover_url: 'https://example.com/cover.jpg',
      cover_alt: 'Cover',
      tags: [],
      published_at: null,
      scheduled_at: null,
      ...post,
    }],
    revisions: [],
  });
}

async function storedPost() {
  const { data } = await db.from('posts').select('*').eq('id', POST_ID).single();
  return data as Record<string, unknown>;
}

async function renderEditor() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PostEditor params={Promise.resolve({ id: POST_ID })} />
      </Suspense>,
    );
  });
  return screen.findByRole('option', { name: 'Publish now' });
}

function pickStatus(value: string) {
  const select = screen.getByRole('option', { name: 'Publish now' }).closest('select');
  if (!select) throw new Error('status select not found');
  fireEvent.change(select, { target: { value } });
}

describe('PostEditor publish', () => {
  beforeEach(() => {
    firePublishNotify.mockReset();
  });

  it('stamps published_at when a draft is published via the Status dropdown', async () => {
    seed({ status: 'draft' });
    await renderEditor();

    pickStatus('published');
    fireEvent.click(screen.getByRole('button', { name: /Publish changes/ }));

    await waitFor(async () => expect((await storedPost()).status).toBe('published'));
    const post = await storedPost();
    expect(post.published_at).toEqual(expect.any(String));
    expect(firePublishNotify).toHaveBeenCalledWith(expect.objectContaining({ event: 'content.published' }));
  });

  it('keeps the original published_at when an already-published post is updated', async () => {
    const original = '2025-01-15T02:00:00.000Z';
    seed({ status: 'published', published_at: original });
    await renderEditor();

    fireEvent.click(screen.getByRole('button', { name: /Publish changes/ }));

    await waitFor(() => expect(firePublishNotify).toHaveBeenCalled());
    expect((await storedPost()).published_at).toBe(original);
    expect(firePublishNotify).toHaveBeenCalledWith(expect.objectContaining({ event: 'content.updated' }));
  });

  it('signals content.deleted when a published post is moved back to draft via the dropdown', async () => {
    seed({ status: 'published', published_at: '2025-01-15T02:00:00.000Z' });
    await renderEditor();

    pickStatus('draft');
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(firePublishNotify).toHaveBeenCalled());
    expect((await storedPost()).status).toBe('draft');
    expect(firePublishNotify).toHaveBeenCalledWith(expect.objectContaining({ event: 'content.deleted' }));
  });
});
