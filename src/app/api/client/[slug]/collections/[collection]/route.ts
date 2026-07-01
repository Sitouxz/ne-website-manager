import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getCollectionDef } from '@/lib/collections/registry';
import { fromGenericRow } from '@/lib/collections/adapter';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; collection: string }> }
) {
  const { slug, collection } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const def = await getCollectionDef(supabase, client.id, collection);
  if (!def) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);

  let query;
  if (def.storage === 'native') {
    query = supabase.from(def.native_table!).select('*').eq('client_id', client.id);
    for (const [key, value] of Object.entries(def.options.publishedFilter ?? {})) {
      query = query.eq(key, value);
    }
  } else {
    query = supabase
      .from('collection_items')
      .select('*')
      .eq('collection_id', def.id)
      .eq('client_id', client.id)
      .eq('status', 'published');
  }
  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data as Record<string, unknown>[]) ?? [];
  const items = def.storage === 'generic' ? rows.map(fromGenericRow) : rows;

  return NextResponse.json(items, {
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
