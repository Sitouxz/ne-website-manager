-- =============================================================
-- NE Website Manager — Media Storage bucket
-- Storage bucket backing the `public.media` table (created in
-- 001_initial_schema.sql). The bucket is public-read (client sites embed
-- media URLs directly); writes are restricted per-client via
-- storage.objects RLS, keyed off the first path segment of each object
-- (`{client_id}/{yyyy}/{uuid}-{filename}`).
-- =============================================================

-- `file_size_limit` / `allowed_mime_types` are defense-in-depth, mirrored
-- from the app-level checks in `src/app/api/media/route.ts`
-- (`MAX_SIZE_BYTES` / `isAllowedMime`) — so that any future write path to
-- this bucket that bypasses the route's own validation (a Storage RLS
-- policy insert, a script using the service-role key directly, etc.) is
-- still bounded at the Storage layer, not just in application code.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,
  26214400, -- 25 MB, matching MAX_SIZE_BYTES in src/app/api/media/route.ts
  ARRAY['image/*', 'video/mp4', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Public (including anon) read access — bucket is public-read.
CREATE POLICY "media_storage_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'media');

-- Authenticated insert: only into a path whose first segment (the
-- client_id folder) matches the caller's own client_id, or ne_admin
-- (who has no client_id of their own and may upload for any client).
CREATE POLICY "media_storage_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] = my_client_id()::text
      OR is_ne_admin()
    )
  );

-- Authenticated delete: same client-scoping rule as insert.
CREATE POLICY "media_storage_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] = my_client_id()::text
      OR is_ne_admin()
    )
  );
