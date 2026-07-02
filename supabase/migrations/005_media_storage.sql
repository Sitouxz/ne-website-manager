-- =============================================================
-- NE Website Manager — Media Storage bucket
-- Storage bucket backing the `public.media` table (created in
-- 001_initial_schema.sql). The bucket is public-read (client sites embed
-- media URLs directly); writes are restricted per-client via
-- storage.objects RLS, keyed off the first path segment of each object
-- (`{client_id}/{yyyy}/{uuid}-{filename}`).
-- =============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
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
