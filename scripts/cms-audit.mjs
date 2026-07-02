import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const checks = [
  {
    name: 'analytics page does not ship mock datasets',
    pass: () => {
      const src = read('src/app/(app)/analytics/page.tsx');
      return !/MOCK DATA|Math\.random|TOP_PAGES|BLOG_POSTS|SEARCH_QUERIES|Currently showing representative data/.test(src);
    },
  },
  {
    name: 'pages screen reads CMS data instead of a hard-coded PAGES array',
    pass: () => {
      const src = read('src/app/(app)/cms/pages/page.tsx');
      return !/const PAGES\s*=|\bPAGES\.map\b|\/cms\/pages\/new/.test(src);
    },
  },
  {
    name: 'public SDK endpoint exists for settings copy command',
    pass: () => existsSync(join(root, 'src/app/api/client/[slug]/sdk/route.ts')),
  },
  {
    name: 'Supabase migration includes clients.github_repo',
    pass: () => /\bgithub_repo\s+TEXT\b/i.test(read('supabase/migrations/001_initial_schema.sql')),
  },
  {
    name: 'post editor lets NE admins choose a client before saving',
    pass: () => {
      const src = read('src/app/(app)/cms/posts/[id]/page.tsx');
      return /role\W+===\W+'ne_admin'/.test(src)
        && /selectedClientId/.test(src);
    },
  },
  {
    name: 'sidebar provides a persisted global client selector',
    pass: () => {
      const layout = read('src/app/(app)/layout.tsx');
      const sidebar = read('src/components/Sidebar.tsx');
      return /ne_selected_client_id/.test(layout)
        && /cookies/.test(layout)
        && /ne_selected_client_id/.test(sidebar)
        && /router\.refresh\(\)/.test(sidebar);
    },
  },
  {
    name: 'analytics has first-party event storage and public tracking route',
    pass: () => {
      const migration = read('supabase/migrations/001_initial_schema.sql');
      return /\bCREATE TABLE IF NOT EXISTS public\.analytics_events\b/i.test(migration)
        && existsSync(join(root, 'src/app/api/client/[slug]/analytics/route.ts'));
    },
  },
  {
    name: 'analytics page reads traffic events instead of promising future provider data',
    pass: () => {
      const src = read('src/app/(app)/analytics/page.tsx');
      return /analytics_events/.test(src)
        && /Top Pages/.test(src)
        && /Referrers/.test(src)
        && !/will appear here after a real analytics provider is connected/i.test(src);
    },
  },
  {
    name: 'generated SDK includes analytics tracking helpers',
    pass: () => {
      const src = read('src/app/api/client/[slug]/sdk/route.ts');
      return /trackPageView/.test(src)
        && /trackEvent/.test(src)
        && /installAnalytics/.test(src);
    },
  },
];

const failures = checks.filter((check) => !check.pass());

if (failures.length) {
  console.error('CMS audit failed:');
  for (const failure of failures) console.error(`- ${failure.name}`);
  process.exit(1);
}

console.log(`CMS audit passed (${checks.length} checks).`);
