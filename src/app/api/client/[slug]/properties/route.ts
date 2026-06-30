import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase  = await createClient();
  const url = new URL(req.url);
  const listing = url.searchParams.get('listing');
  const limit   = parseInt(url.searchParams.get('limit') ?? '100', 10);

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  let query = supabase
    .from('properties')
    .select('*')
    .eq('client_id', client.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (listing) query = query.eq('listing', listing);

  const { data: properties, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(properties ?? [], {
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
