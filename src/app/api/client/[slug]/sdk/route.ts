import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { generateV1Sdk, generateV2Sdk, type SdkCollectionInput } from '@/lib/sdk/generate';

/**
 * `GET /api/client/[slug]/sdk` — serves the generated `lib/cms.ts` source a
 * client site pastes into its own repo. Task 7.2 moved the actual
 * generation into `src/lib/sdk/generate.ts` (this route previously carried
 * its own inline `cmsLib` function, near-duplicated with
 * `push-integration/route.ts`'s `generateCmsLib` — see `generate.ts`'s file
 * header for why `generateV1Sdk` uses THIS route's prior output as ground
 * truth, not that one's).
 *
 * Defaults to v1 (`generateV1Sdk`) — byte-identical to this route's own
 * pre-Task-7.2 output — for backward compatibility with already-integrated
 * sites (e.g. al-islah) that fetch this URL with no query string. Passing
 * `?v=2` opts into `generateV2Sdk`, which additionally includes every v2
 * addition (collections, globals, forms, redirects, preview + revalidate
 * handlers) typed from this client's own `storage = 'generic'` collections.
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

  let body: string;
  if (version === '2') {
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
