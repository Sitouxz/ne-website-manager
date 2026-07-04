import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { MenuItem } from '@/lib/supabase/types';
import type { MenuItemNode } from '@/lib/globals/types';

/**
 * Public site globals endpoint (Task 5.1) — merges `site_globals` (footer,
 * announcement, theme, social, contact — see
 * `supabase/migrations/009_site_globals.sql` for the reserved-key value
 * contract) with the public `menu_items` nav tree into one JSON response a
 * client's website can fetch at build/runtime.
 *
 * Uses the user-scoped `createClient()` (`@/lib/supabase/server`), not the
 * admin/service-role client — matching `posts`/`pages`/`properties`'s
 * pattern (see `src/app/api/client/[slug]/posts/route.ts`) rather than
 * `collections/[collection]/route.ts`'s admin-client pattern. The
 * `collections` route needs the admin client specifically to look up
 * `api_keys` (no anon-read policy exists there at all). This route has no
 * such need: both `site_globals_public_read` (`USING (true)`) and
 * `menu_items_public_read` (`USING (location = 'public' AND is_visible =
 * true)`) already grant the `anon` role exactly the rows this route wants,
 * so relying on RLS directly is both simpler and keeps the visibility rule
 * in one place (the policy) instead of re-implementing it here.
 */

/**
 * Builds the public navigation tree from ALL `location='public'` menu items
 * for a client (visible AND hidden — see caller), then prunes.
 *
 * Why the two-phase build-then-prune approach: if we filtered to
 * `is_visible=true` at the query level (as this used to do) before building
 * the tree, a hidden parent's row would never be fetched at all — so its
 * still-visible children would find `nodes.get(item.parent_id)` undefined
 * and fall into the `else roots.push(node)` branch, *promoting* an orphaned
 * child to top-level public navigation instead of hiding it along with its
 * parent. Editors can toggle a parent's visibility independently of its
 * children (`cms/navigation/page.tsx`), so this is reachable in practice.
 *
 * Fix: fetch every `location='public'` item regardless of `is_visible`,
 * build the FULL tree (hidden nodes included, correctly parented), then
 * prune top-down: a node only survives if it is itself visible, and we only
 * recurse into a node's children once that node has survived. This means a
 * hidden node's entire subtree — regardless of depth, regardless of whether
 * a deeper descendant is itself flagged visible — is dropped in one step,
 * because pruning never visits the children of a node it just excluded.
 * (Concretely: visible grandparent -> hidden parent -> visible child: the
 * child is still excluded, because the walk stops at the hidden parent and
 * never reaches the child.)
 */
function buildNavigationTree(items: MenuItem[]): MenuItemNode[] {
  const nodes = new Map<string, MenuItemNode>();
  for (const item of items) nodes.set(item.id, { ...item, children: [] });

  const roots: MenuItemNode[] = [];
  for (const item of items) {
    const node = nodes.get(item.id)!;
    const parent = item.parent_id ? nodes.get(item.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  function pruneHidden(nodeList: MenuItemNode[]): MenuItemNode[] {
    const visible: MenuItemNode[] = [];
    for (const node of nodeList) {
      if (!node.is_visible) continue; // drops this node AND its whole subtree
      visible.push({ ...node, children: pruneHidden(node.children) });
    }
    return visible;
  }

  return pruneHidden(roots);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const [{ data: globalsRows, error: globalsError }, { data: menuRows, error: menuError }] = await Promise.all([
    supabase.from('site_globals').select('key, value').eq('client_id', client.id),
    // Deliberately NOT filtering `is_visible=true` here — see buildNavigationTree's
    // doc comment for why the full (visible + hidden) set must be fetched
    // before the tree is built and only pruned afterward.
    supabase
      .from('menu_items')
      .select('*')
      .eq('client_id', client.id)
      .eq('location', 'public')
      .order('sort_order', { ascending: true }),
  ]);

  if (globalsError) return NextResponse.json({ error: globalsError.message }, { status: 500 });
  if (menuError) return NextResponse.json({ error: menuError.message }, { status: 500 });

  const globals: Record<string, unknown> = {};
  for (const row of (globalsRows ?? []) as { key: string; value: unknown }[]) {
    globals[row.key] = row.value;
  }

  const navigation = buildNavigationTree((menuRows ?? []) as MenuItem[]);

  return NextResponse.json(
    { ...globals, navigation },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  );
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
