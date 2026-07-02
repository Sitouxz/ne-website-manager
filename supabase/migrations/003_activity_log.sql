CREATE TABLE IF NOT EXISTS public.activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  actor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,              -- 'created' | 'updated' | 'published' | 'archived' | 'deleted' | 'invited' | ...
  entity_type TEXT NOT NULL,              -- 'post' | 'page' | 'property' | 'media' | 'collection_entry' | 'form' | 'member' | 'settings'
  entity_id   UUID,
  summary     TEXT NOT NULL DEFAULT '',   -- human line: 'Published "Ramadan Schedule 2026"'
  meta        JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_log_client_created_idx ON public.activity_log (client_id, created_at DESC);
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_select" ON public.activity_log FOR SELECT USING (client_id = my_client_id() OR is_ne_admin());
CREATE POLICY "activity_insert" ON public.activity_log FOR INSERT WITH CHECK (client_id = my_client_id() OR is_ne_admin());
