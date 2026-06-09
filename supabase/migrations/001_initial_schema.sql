-- =============================================================
-- NE Website Manager — Initial Schema
-- Run this in Supabase Dashboard -> SQL Editor
-- =============================================================

-- Clients: one row per managed website
CREATE TABLE IF NOT EXISTS public.clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  website_url TEXT,
  deploy_hook TEXT,
  plan        TEXT DEFAULT 'starter',
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Profiles: extends auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  role        TEXT DEFAULT 'editor' CHECK (role IN ('ne_admin','client_admin','editor')),
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Posts
CREATE TABLE IF NOT EXISTS public.posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  slug            TEXT NOT NULL DEFAULT '',
  content         TEXT DEFAULT '',
  excerpt         TEXT DEFAULT '',
  cover_url       TEXT,
  category        TEXT DEFAULT '',
  tags            TEXT[] DEFAULT '{}',
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  seo_title       TEXT,
  seo_description TEXT,
  author_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, slug)
);

-- Pages
CREATE TABLE IF NOT EXISTS public.pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  path        TEXT NOT NULL DEFAULT '/',
  content     TEXT DEFAULT '',
  status      TEXT DEFAULT 'draft' CHECK (status IN ('draft','published')),
  visibility  TEXT DEFAULT 'public' CHECK (visibility IN ('public','private')),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, path)
);

-- Media
CREATE TABLE IF NOT EXISTS public.media (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  url         TEXT NOT NULL,
  filename    TEXT,
  mime_type   TEXT,
  size_bytes  BIGINT,
  alt         TEXT DEFAULT '',
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE TRIGGER posts_updated_at   BEFORE UPDATE ON public.posts   FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE OR REPLACE TRIGGER pages_updated_at   BEFORE UPDATE ON public.pages   FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE OR REPLACE TRIGGER clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================
-- RLS
-- =============================================================
ALTER TABLE public.clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media    ENABLE ROW LEVEL SECURITY;

-- Helper functions
CREATE OR REPLACE FUNCTION public.my_client_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT client_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_ne_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ne_admin');
$$;

-- Profiles
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (id = auth.uid() OR is_ne_admin());
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());

-- Clients
CREATE POLICY "clients_ne_admin"  ON public.clients FOR ALL    USING (is_ne_admin());
CREATE POLICY "clients_read_own"  ON public.clients FOR SELECT USING (id = my_client_id());

-- Posts (authenticated users see own client; public anon read for published)
CREATE POLICY "posts_authenticated" ON public.posts FOR ALL    USING (client_id = my_client_id() OR is_ne_admin());
CREATE POLICY "posts_public_read"   ON public.posts FOR SELECT USING (status = 'published');

-- Pages
CREATE POLICY "pages_authenticated" ON public.pages FOR ALL    USING (client_id = my_client_id() OR is_ne_admin());
CREATE POLICY "pages_public_read"   ON public.pages FOR SELECT USING (status = 'published' AND visibility = 'public');

-- Media
CREATE POLICY "media_authenticated" ON public.media FOR ALL USING (client_id = my_client_id() OR is_ne_admin());

-- =============================================================
-- Seed: Al-Islah as first client
-- =============================================================
INSERT INTO public.clients (name, slug, website_url, plan)
VALUES ('Al-Islah Mosque', 'al-islah', 'https://alisla.vercel.app', 'starter')
ON CONFLICT (slug) DO NOTHING;
