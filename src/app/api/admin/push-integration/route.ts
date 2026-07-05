import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateV2Sdk, type SdkCollectionInput } from '@/lib/sdk/generate';

/**
 * Task 7.2: this route's own inline `generateCmsLib` (near-duplicated with
 * `sdk/route.ts`'s pre-Task-7.2 `cmsLib`) has been replaced with the shared
 * `generateV2Sdk` from `src/lib/sdk/generate.ts`.
 *
 * Deliberately **v2**, not v1, unlike `sdk/route.ts`'s default: this route
 * only ever runs when someone is pushing a *brand-new* integration PR to a
 * client repo that has no existing `lib/cms.ts` at all (see the PUT below —
 * it upserts `lib/cms.ts` fresh into a new branch). There is no
 * already-integrated site depending on this route's exact byte output the
 * way al-islah depends on `sdk/route.ts`'s default GET — so there's no
 * backward-compatibility reason to hand a brand-new integration the
 * v1-only feature set when v2 (collections, globals, forms, redirects,
 * preview + revalidate handlers) is a strict superset that a new client
 * benefits from immediately.
 */
async function githubRequest(
  token: string,
  method: string,
  path: string,
  body?: object
) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? `GitHub ${res.status}`);
  return json;
}

export async function POST(req: Request) {
  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, client_id')
    .eq('id', user.id)
    .single();

  const { github_token, repo, slug, client_name } = await req.json();
  const cmsBase = new URL(req.url).origin;

  if (!github_token || !repo || !slug) {
    return NextResponse.json({ error: 'github_token, repo, slug required' }, { status: 400 });
  }

  // Resolved unconditionally (not just inside the non-ne_admin branch below)
  // because it's also needed to fetch this client's `storage='generic'`
  // collections for `generateV2Sdk`, regardless of caller role.
  const { data: clientRow } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  // Validate caller owns this client OR is ne_admin
  if (profile?.role !== 'ne_admin') {
    if (!clientRow || clientRow.id !== profile?.client_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    // 1. Get default branch
    const repoInfo = await githubRequest(github_token, 'GET', `/repos/${repo}`);
    const defaultBranch = repoInfo.default_branch ?? 'main';

    // 2. Get latest commit SHA on default branch
    const refData = await githubRequest(github_token, 'GET', `/repos/${repo}/git/ref/heads/${defaultBranch}`);
    const baseSha = refData.object.sha;

    // 3. Create new branch
    const branchName = `cms/ne-integration-${Date.now()}`;
    await githubRequest(github_token, 'POST', `/repos/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    // 4. Upsert lib/cms.ts
    // `clientRow` can be null if this client doesn't have a `clients` row
    // yet (e.g. an ne_admin pushing the integration ahead of onboarding) —
    // generate with an empty collections list rather than failing; the core
    // v2 SDK (collections/globals/forms/redirects/preview/revalidate helper
    // factories) is still fully generated, just with no per-collection
    // helpers until this client's own collections exist.
    let collectionRows: SdkCollectionInput[] = [];
    if (clientRow) {
      const { data } = await supabase
        .from('collections')
        .select('slug, name, name_singular, fields')
        .eq('client_id', clientRow.id)
        .eq('storage', 'generic');
      collectionRows = (data ?? []) as SdkCollectionInput[];
    }

    const fileContent = generateV2Sdk(slug, cmsBase, collectionRows);
    const encoded = Buffer.from(fileContent).toString('base64');

    // Check if file exists (to get SHA for update)
    let existingSha: string | undefined;
    try {
      const existing = await githubRequest(github_token, 'GET', `/repos/${repo}/contents/lib/cms.ts?ref=${branchName}`);
      existingSha = existing.sha;
    } catch {
      // File doesn't exist — create fresh
    }

    await githubRequest(github_token, 'PUT', `/repos/${repo}/contents/lib/cms.ts`, {
      message: `feat: add NE Website Manager CMS integration for ${client_name ?? slug}`,
      content: encoded,
      branch: branchName,
      ...(existingSha ? { sha: existingSha } : {}),
    });

    // 5. Create PR
    const pr = await githubRequest(github_token, 'POST', `/repos/${repo}/pulls`, {
      title: `Add NE Website Manager CMS integration`,
      body: `## NE Website Manager Integration\n\nThis PR adds \`lib/cms.ts\` (SDK v2) — a typed API client that connects this website to the NE Website Manager CMS: posts/pages, collections, site globals/navigation, form submissions, redirects, and preview/revalidation route handlers.\n\n### Usage\n\n\`\`\`ts\nimport { getPosts, getPostBySlug, getPages, getCollection, getGlobals, submitForm } from '@/lib/cms';\n\n// Fetch all published posts\nconst posts = await getPosts();\n\n// Fetch single post\nconst post = await getPostBySlug('my-post-slug');\n\n// Fetch a collection typed by its own generated interface (e.g. getSermons())\nconst items = await getCollection('sermons');\n\n// Site globals (footer, announcement, navigation, theme, contact, social)\nconst globals = await getGlobals();\n\`\`\`\n\n### Preview & revalidation\n\nAdd these two route handlers to enable draft previews and on-publish revalidation from the CMS:\n\n\`\`\`ts\n// app/api/preview/route.ts\nimport { createPreviewHandler } from '@/lib/cms';\nexport const GET = createPreviewHandler(process.env.CMS_PREVIEW_SECRET!);\n\n// app/api/revalidate/route.ts\nimport { createRevalidateHandler } from '@/lib/cms';\nexport const POST = createRevalidateHandler(process.env.CMS_REVALIDATE_SECRET!);\n\`\`\`\n\nBoth secrets should be set to this client's \`revalidate_secret\`, configured in the CMS's Settings -> Publishing tab.\n\n\`lib/cms.ts\` also exports \`PROXY_MIDDLEWARE_SNIPPET\` — a documented starting point for applying CMS-managed redirects (\`getRedirects()\`) in this site's own \`middleware.ts\`.\n\n### API Endpoints\n- Posts: \`${cmsBase}/api/client/${slug}/posts\`\n- Pages: \`${cmsBase}/api/client/${slug}/pages\`\n- Collections: \`${cmsBase}/api/client/${slug}/collections/:collection\`\n- Globals: \`${cmsBase}/api/client/${slug}/globals\`\n- Forms: \`${cmsBase}/api/client/${slug}/forms/:formSlug\`\n- SEO/redirects: \`${cmsBase}/api/client/${slug}/seo\`\n\n---\n*Generated by [NE Website Manager](${cmsBase})*`,
      head: branchName,
      base: defaultBranch,
    });

    // 6. Save github_repo to client record (for display)
    await supabase.from('clients').update({ github_repo: repo }).eq('slug', slug);

    return NextResponse.json({ success: true, pr_url: pr.html_url, pr_number: pr.number });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
