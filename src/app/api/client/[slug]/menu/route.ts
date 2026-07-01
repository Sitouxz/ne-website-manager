import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { MenuItem, MenuTree } from '@/lib/supabase/types';

function buildTree(items: MenuItem[]): MenuTree[] {
  const byId = new Map<string, MenuTree>(items.map((item) => [item.id, { ...item, children: [] }]));
  const roots: MenuTree[] = [];

  for (const item of byId.values()) {
    const parent = item.parent_id ? byId.get(item.parent_id) : undefined;
    if (parent) parent.children.push(item);
    else roots.push(item);
  }

  return roots;
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

  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('client_id', client.id)
    .eq('location', 'public')
    .eq('is_visible', true)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(buildTree((data as MenuItem[]) ?? []), {
    headers: { 'Access-Control-Allow-Origin': '*' },
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
