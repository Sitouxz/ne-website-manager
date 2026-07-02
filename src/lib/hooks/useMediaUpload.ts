'use client';

import { useCallback, useState } from 'react';
import type { MediaItem } from '@/app/api/media/route';

/**
 * Shared upload logic for the two places that let a user push a new file into
 * the media library: the Media Library page (`cms/media/page.tsx`) and the
 * `MediaPicker` dialog. Both submit `multipart/form-data` to `POST /api/media`
 * (see that route for validation rules: allowed mime types, 25 MB cap).
 *
 * `clientId` is forwarded as the `client_id` form field — required for an
 * ne_admin caller (who has no client of their own), ignored by the API for
 * everyone else. Pass `useSelectedClient().selectedClientId` from the
 * surrounding page/dialog.
 */
export function useMediaUpload(clientId: string | null) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const uploadFiles = useCallback(async (files: FileList | File[]): Promise<MediaItem[]> => {
    const list = Array.from(files);
    if (list.length === 0) return [];

    setError('');
    setUploading(true);
    const uploaded: MediaItem[] = [];

    for (const file of list) {
      const form = new FormData();
      form.append('file', file);
      if (clientId) form.append('client_id', clientId);

      try {
        const res = await fetch('/api/media', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? `Failed to upload "${file.name}"`);
          continue;
        }
        uploaded.push(json as MediaItem);
      } catch {
        setError(`Failed to upload "${file.name}"`);
      }
    }

    setUploading(false);
    return uploaded;
  }, [clientId]);

  return { uploading, error, uploadFiles, setError };
}
