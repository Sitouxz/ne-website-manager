-- Capability-driven CMS navigation. Each website exposes only the modules its
-- implementation supports; the UI merges this object with safe application
-- defaults so adding a future key remains backwards compatible.
alter table public.clients
  add column if not exists capabilities jsonb not null default '{
    "posts": true,
    "pages": true,
    "properties": false,
    "media": true,
    "collections": true,
    "navigation": true,
    "forms": true,
    "announcements": true,
    "analytics": true,
    "social": true,
    "seo": true,
    "team": true
  }'::jsonb;

update public.clients
set capabilities = capabilities || '{
  "posts": false,
  "pages": false,
  "properties": true,
  "media": true,
  "collections": false,
  "navigation": false
}'::jsonb
where slug = 'kamal-karim';
