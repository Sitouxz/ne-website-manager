-- =============================================================
-- NE Website Manager — Properties table
-- Supports real-estate client sites (e.g. Kamal Karim)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.properties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  slug            TEXT NOT NULL DEFAULT '',
  name            TEXT NOT NULL DEFAULT '',
  address         TEXT DEFAULT '',
  area            TEXT DEFAULT '',
  district        TEXT DEFAULT '',
  listing         TEXT DEFAULT 'sale' CHECK (listing IN ('sale', 'rent')),
  segment         TEXT DEFAULT 'Prime' CHECK (segment IN ('Prime', 'City fringe', 'Suburban')),
  property_type   TEXT DEFAULT '',
  tenure          TEXT DEFAULT '',
  bedrooms        INTEGER DEFAULT 0,
  bathrooms       INTEGER DEFAULT 0,
  price           BIGINT,
  psf             NUMERIC(10,2),
  size_sqft       NUMERIC(10,2),
  completion_year INTEGER,
  furnishing      TEXT,
  tagline         TEXT DEFAULT '',
  story           TEXT DEFAULT '',
  location_note   TEXT DEFAULT '',
  highlights      JSONB DEFAULT '[]'::jsonb,
  connectivity    TEXT[] DEFAULT '{}',
  amenities       TEXT[] DEFAULT '{}',
  hero_url        TEXT DEFAULT '',
  hero_alt        TEXT DEFAULT '',
  gallery         JSONB DEFAULT '[]'::jsonb,
  available       TEXT,
  tour            JSONB,
  source_url      TEXT,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  seo_title       TEXT,
  seo_description TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, slug)
);

CREATE INDEX IF NOT EXISTS properties_client_status_idx ON public.properties (client_id, status);

CREATE OR REPLACE TRIGGER properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "properties_authenticated" ON public.properties
  FOR ALL USING (client_id = my_client_id() OR is_ne_admin());

CREATE POLICY "properties_public_read" ON public.properties
  FOR SELECT USING (status = 'active');
