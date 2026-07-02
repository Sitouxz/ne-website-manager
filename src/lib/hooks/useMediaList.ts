'use client';

import { useCallback, useState } from 'react';
import type { MediaItem } from '@/app/api/media/route';

/**
 * Shared offset-paginated `GET /api/media` fetching, used by both the Media
 * Library page (`cms/media/page.tsx`) and the `MediaPicker` dialog. Both need
 * the identical pattern: fetch a page, read the total from the
 * `X-Total-Count` response header (the API caps `limit` at 100/request — see
 * `route.ts`'s `PAGINATION` — so this is the only way to know whether more
 * exist), and either replace the loaded list (`append: false`, e.g. initial
 * load or a client switch) or append to it (`append: true`, "Load more").
 *
 * Callers still own `items`/`totalCount` state directly (via the exposed
 * setters) for optimistic updates that don't go through the API — e.g.
 * prepending a freshly-uploaded item, removing a deleted one, or patching
 * `alt` text in place — mirroring what both call sites already did before
 * this hook existed.
 */
export function useMediaList({
  clientId,
  type,
  limit = 50,
  initialLoading = false,
}: {
  clientId: string | null;
  type?: 'image';
  limit?: number;
  /** Pass `true` for pages that fetch immediately on mount, so the loading
   * spinner shows from the very first render instead of flashing an empty
   * grid until the deferred initial-fetch effect fires (see `MediaPicker`,
   * which only fetches once `open` flips true and so wants `false`, vs. the
   * library page, which fetches on mount and wants `true`). */
  initialLoading?: boolean;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState('');

  const fetchPage = useCallback(async (offset: number, append: boolean) => {
    if (!append) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (clientId) params.set('client_id', clientId);
      if (type) params.set('type', type);
      const res = await fetch(`/api/media?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to load media');
        if (!append) setItems([]);
      } else {
        const data = json as MediaItem[];
        setItems((prev) => (append ? [...prev, ...data] : data));
        setTotalCount(Number(res.headers.get('X-Total-Count') ?? data.length));
      }
    } catch {
      setError('Failed to load media');
    }
    setLoading(false);
  }, [clientId, type, limit]);

  const canLoadMore = items.length < totalCount;
  const loadMore = useCallback(() => fetchPage(items.length, true), [fetchPage, items.length]);

  return {
    items, setItems,
    totalCount, setTotalCount,
    loading, error,
    fetchPage, loadMore, canLoadMore,
  };
}
