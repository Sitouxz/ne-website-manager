-- Where a client's blog lives on their own website.
--
-- The CMS has always assumed `/blog/{slug}`, which is baked into the publish
-- webhook, the preview resolver, the SEO feed and the post editor's own
-- "Web address" hint. Zhenghe publishes the same posts under /insights, so
-- the editor was telling their team a URL that 404s.
--
-- Defaults to the previous hardcoded value, so every existing client keeps
-- behaving exactly as before.
alter table public.clients
  add column if not exists blog_path text not null default '/blog';

-- Normalise: leading slash, no trailing slash.
alter table public.clients
  add constraint clients_blog_path_shape
  check (blog_path ~ '^/[a-z0-9-]+(/[a-z0-9-]+)*$');
