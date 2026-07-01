-- =============================================================
-- NE Website Manager — Collections engine
-- Flexible, no-code content types + dynamic CMS/public menus.
-- Run this in Supabase Dashboard -> SQL Editor
-- =============================================================

-- Collections: content-type definitions. Client-created (generic) types
-- live here. System types (posts/pages/properties) are code-defined in
-- src/lib/collections/registry.ts and do not need rows here.
CREATE TABLE IF NOT EXISTS public.collections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID REFERENCES public.clients(id) ON DELETE CASCADE, -- NULL = global template
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  name_singular TEXT NOT NULL DEFAULT '',
  icon          TEXT DEFAULT 'Boxes',
  description   TEXT DEFAULT '',
  storage       TEXT NOT NULL DEFAULT 'generic' CHECK (storage IN ('generic', 'native')),
  native_table  TEXT CHECK (native_table IN ('posts', 'pages', 'properties')),
  fields        JSONB NOT NULL DEFAULT '[]'::jsonb,
  options       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system     BOOLEAN NOT NULL DEFAULT false,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS collections_client_slug_idx
  ON public.collections (client_id, slug) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS collections_global_slug_idx
  ON public.collections (slug) WHERE client_id IS NULL;

-- Collection items: the generic JSONB record store backing client-created
-- collections. Native (system) collections keep using their own tables.
CREATE TABLE IF NOT EXISTS public.collection_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID REFERENCES public.collections(id) ON DELETE CASCADE NOT NULL,
  client_id     UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  slug          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (collection_id, slug)
);

CREATE INDEX IF NOT EXISTS collection_items_client_coll_idx
  ON public.collection_items (client_id, collection_id, status);
CREATE INDEX IF NOT EXISTS collection_items_data_gin_idx
  ON public.collection_items USING gin (data);

-- Menu items: a single table drives BOTH the CMS admin sidebar and the
-- client's public website nav. `location` distinguishes which menu a row
-- belongs to; `link_type` = 'collection' resolves to that collection's
-- list route in the sidebar, or a site-defined href on the public side.
CREATE TABLE IF NOT EXISTS public.menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  location        TEXT NOT NULL DEFAULT 'cms_sidebar' CHECK (location IN ('cms_sidebar', 'public')),
  label           TEXT NOT NULL DEFAULT '',
  icon            TEXT DEFAULT 'Link',
  link_type       TEXT NOT NULL DEFAULT 'collection' CHECK (link_type IN ('collection', 'url', 'custom')),
  collection_slug TEXT,
  url             TEXT,
  parent_id       UUID REFERENCES public.menu_items(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_visible      BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menu_items_client_loc_idx
  ON public.menu_items (client_id, location, sort_order);

-- =============================================================
-- Triggers
-- =============================================================
CREATE OR REPLACE TRIGGER collections_updated_at
  BEFORE UPDATE ON public.collections FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE OR REPLACE TRIGGER collection_items_updated_at
  BEFORE UPDATE ON public.collection_items FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE OR REPLACE TRIGGER menu_items_updated_at
  BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================
-- RLS
-- =============================================================
ALTER TABLE public.collections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items       ENABLE ROW LEVEL SECURITY;

-- Collections: own client (or admin) can manage; global templates readable by all authenticated users
DROP POLICY IF EXISTS "collections_authenticated" ON public.collections;
CREATE POLICY "collections_authenticated" ON public.collections
  FOR ALL USING (client_id = my_client_id() OR is_ne_admin())
  WITH CHECK (client_id = my_client_id() OR is_ne_admin());

DROP POLICY IF EXISTS "collections_global_read" ON public.collections;
CREATE POLICY "collections_global_read" ON public.collections
  FOR SELECT USING (client_id IS NULL);

-- Collection items: own client (or admin) can manage; public read of published items
DROP POLICY IF EXISTS "collection_items_authenticated" ON public.collection_items;
CREATE POLICY "collection_items_authenticated" ON public.collection_items
  FOR ALL USING (client_id = my_client_id() OR is_ne_admin())
  WITH CHECK (client_id = my_client_id() OR is_ne_admin());

DROP POLICY IF EXISTS "collection_items_public_read" ON public.collection_items;
CREATE POLICY "collection_items_public_read" ON public.collection_items
  FOR SELECT USING (status = 'published');

-- Menu items: own client (or admin) can manage; public read of visible public-location items
DROP POLICY IF EXISTS "menu_items_authenticated" ON public.menu_items;
CREATE POLICY "menu_items_authenticated" ON public.menu_items
  FOR ALL USING (client_id = my_client_id() OR is_ne_admin())
  WITH CHECK (client_id = my_client_id() OR is_ne_admin());

DROP POLICY IF EXISTS "menu_items_public_read" ON public.menu_items;
CREATE POLICY "menu_items_public_read" ON public.menu_items
  FOR SELECT USING (location = 'public' AND is_visible = true);
