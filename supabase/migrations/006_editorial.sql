-- 006_editorial.sql
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS content_json JSONB;          -- Tiptap doc; `content` keeps rendered HTML
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;    -- publish at
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS content_json JSONB;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS seo_title TEXT;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check CHECK (status IN ('draft','in_review','scheduled','published','archived'));

CREATE TABLE IF NOT EXISTS public.revisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  entity_type TEXT NOT NULL,               -- 'post' | 'page' | 'property' | 'collection_entry'
  entity_id   UUID NOT NULL,
  snapshot    JSONB NOT NULL,              -- full row at save time
  author_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revisions_entity_idx ON public.revisions (entity_type, entity_id, created_at DESC);
ALTER TABLE public.revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revisions_all" ON public.revisions FOR ALL USING (client_id = my_client_id() OR is_ne_admin());

CREATE TABLE IF NOT EXISTS public.preview_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.preview_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preview_tokens_all" ON public.preview_tokens FOR ALL USING (client_id = my_client_id() OR is_ne_admin());
