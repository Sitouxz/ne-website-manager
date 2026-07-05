import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { generateV1Sdk, generateV2Sdk, generateV2ServerSdk, type SdkCollectionInput } from '@/lib/sdk/generate';

/**
 * `GET /api/client/[slug]/sdk` — serves the generated `lib/cms.ts` (and, for
 * v2, `lib/cms-server.ts`) source a client site pastes into its own repo.
 * Task 7.2 moved the actual generation into `src/lib/sdk/generate.ts` (this
 * route previously carried its own inline `cmsLib` function, near-duplicated
 * with `push-integration/route.ts`'s `generateCmsLib` — see `generate.ts`'s
 * file header for why `generateV1Sdk` uses THIS route's prior output as
 * ground truth, not that one's).
 *
 * Defaults to v1 (`generateV1Sdk`) — byte-identical to this route's own
 * pre-Task-7.2 output — for backward compatibility with already-integrated
 * sites (e.g. al-islah) that fetch this URL with no query string. Passing
 * `?v=2` opts into v2, which additionally includes every v2 addition
 * (collections, globals, forms, redirects) typed from this client's own
 * `storage = 'generic'` collections.
 *
 * ## Two files, one endpoint (`?file=`)
 *
 * v2 is generated as TWO separate source files (see `generate.ts`'s "Two
 * files for v2" section) so that Node.js/App-Router-only imports
 * (`createPreviewHandler`/`createRevalidateHandler`'s `crypto`/`next/cache`/
 * `next/headers`/`next/navigation`) never end up in the file a client is
 * told to `import` from their own `middleware.ts`. This route serves them as
 * two separate fetches rather than concatenating both into one response
 * body:
 *   - `GET .../sdk?v=2` (no `?file=`, or `?file=cms`) -> `lib/cms.ts`
 *     (middleware-safe).
 *   - `GET .../sdk?v=2&file=cms-server` -> `lib/cms-server.ts`
 *     (server/Node-only; preview + revalidate handlers).
 * Two fetches over one delimited blob: this SDK is distributed by a human
 * copy-pasting generated text into their own repo (not an automated package
 * install), and the two outputs are two DIFFERENT files at two DIFFERENT
 * paths in that repo — asking the integrator to fetch each file's content
 * separately (mirroring "one URL per file you're about to create") is more
 * usable than making them manually split one combined response body via a
 * delimiter comment, especially since a copy-paste error while splitting
 * could silently reintroduce Finding 1's Edge Runtime bug (a stray Node-only
 * import ending up back in `lib/cms.ts`).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClient();
  const url = new URL(req.url);

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const origin = url.origin;
  const version = url.searchParams.get('v');
  const file = url.searchParams.get('file');

  let body: string;
  if (version === '2') {
    if (file === 'cms-server') {
      body = generateV2ServerSdk(slug, origin);
    } else {
      // Native/global collections excluded: `storage = 'generic'` only —
      // native collections (posts/pages/properties) are already covered by
      // v1's own `getPosts`/`getPages`, and global (`client_id IS NULL`)
      // collections aren't this client's own schema to generate helpers for.
      const { data: collectionRows } = await supabase
        .from('collections')
        .select('slug, name, name_singular, fields')
        .eq('client_id', client.id)
        .eq('storage', 'generic');

      body = generateV2Sdk(slug, origin, (collectionRows ?? []) as SdkCollectionInput[]);
    }
  } else {
    body = generateV1Sdk(slug, origin);
  }

  return new Response(body, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
