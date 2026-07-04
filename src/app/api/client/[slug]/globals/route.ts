import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { MenuItem } from '@/lib/supabase/types';
import type { MenuItemNode } from '@/lib/globals/types';

/**
 * Public site globals endpoint (Task 5.1) — merges `site_globals` (footer,
 * announcement, theme, social, contact — see
 * `supabase/migrations/009_site_globals.sql` for the reserved-key value
 * contract) with the public `menu_items` nav tree into one JSON response a
 * client's website can fetch at build/runtime.
 *
 * Uses the service-role `createAdminClient()` (`@/lib/supabase/admin`), NOT
 * the user-scoped `createClient()` this route originally used — see Finding
 * (final whole-branch review) for the bug that switch fixes:
 *
 * This route's real caller is an anonymous external client website with no
 * Supabase auth cookies, so a user-scoped client always executes as the
 * `anon` Postgres role. Under `anon`, the only applicable policy on
 * `menu_items` is `menu_items_public_read` = `USING (location = 'public' AND
 * is_visible = true)` — RLS itself strips every hidden row out of the query
 * result, before this file's code ever runs. That defeats
 * `buildNavigationTree`'s two-phase build-then-prune design below: the whole
 * point of fetching hidden rows and pruning them here (instead of filtering
 * `is_visible` in the query) is so a hidden parent's still-visible child gets
 * excluded together with its parent, rather than promoted to top-level
 * public nav because the tree-builder can't find its (never-fetched) parent.
 * If RLS silently removes the hidden parent row first, the exact same
 * orphan-promotion bug reappears — just one layer earlier (the query itself,
 * not the tree-builder). The admin client bypasses RLS entirely so this
 * route's own `location = 'public'` filter (deliberately NOT also filtering
 * `is_visible`, see the query below) is the only filter applied, and
 * `buildNavigationTree` performs 100% of the visibility pruning as designed.
 *
 * `site_globals_public_read` (`USING (true)`) grants `anon` unconditional
 * SELECT already, so the anon client was never actually wrong for that half
 * of this route — but this route uses ONE client (the admin client) for
 * both queries anyway, for the same reason `seo/route.ts` (Task 5.3) settled
 * on a single client once it needed one at all: simpler to reason about than
 * two different clients with two different trust models in one file.
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
  const admin = createAdminClient();

  const { data: client } = await admin
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const [{ data: globalsRows, error: globalsError }, { data: menuRows, error: menuError }] = await Promise.all([
    admin.from('site_globals').select('key, value').eq('client_id', client.id),
    // Deliberately NOT filtering `is_visible=true` here — see buildNavigationTree's
    // doc comment for why the full (visible + hidden) set must be fetched
    // before the tree is built and only pruned afterward. Using the admin
    // client (bypasses RLS) is what makes fetching hidden rows possible at
    // all for this route's real (anonymous) caller — see the file-level
    // comment above.
    admin
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
