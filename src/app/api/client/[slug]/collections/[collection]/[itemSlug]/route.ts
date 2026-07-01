import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getCollectionDef } from '@/lib/collections/registry';
import { fromGenericRow } from '@/lib/collections/adapter';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; collection: string; itemSlug: string }> }
) {
  const { slug, collection, itemSlug } = await params;
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

  let query;
  if (def.storage === 'native') {
    query = supabase
      .from(def.native_table!)
      .select('*')
      .eq('client_id', client.id)
      .eq(def.options.slugField, itemSlug);
    for (const [key, value] of Object.entries(def.options.publishedFilter ?? {})) {
      query = query.eq(key, value);
    }
  } else {
    query = supabase
      .from('collection_items')
      .select('*')
      .eq('collection_id', def.id)
      .eq('client_id', client.id)
      .eq('slug', itemSlug)
      .eq('status', 'published');
  }

  const { data: item, error } = await query.single();

  if (error || !item) {
    return NextResponse.json({ error: `${def.name_singular} not found` }, { status: 404 });
  }

  const result = def.storage === 'generic' ? fromGenericRow(item as Record<string, unknown>) : item;

  return NextResponse.json(result, {
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
