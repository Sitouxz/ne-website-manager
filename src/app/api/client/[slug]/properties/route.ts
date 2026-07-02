import { createClient } from '@/lib/supabase/server';
import { parsePagination } from '@/lib/api/pagination';
import { NextResponse } from 'next/server';

// Matches the pre-pagination hardcoded default (`parseInt(... ?? '100')`)
// so a request with no `limit`/`offset` params returns exactly what it did
// before this endpoint accepted pagination params.
const PAGINATION = { defaultLimit: 100, maxLimit: 100 };

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase  = await createClient();
  const url = new URL(req.url);
  const listing = url.searchParams.get('listing');
  const { limit, offset } = parsePagination(url, PAGINATION);

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
    .range(offset, offset + limit - 1);

  let countQuery = supabase
    .from('properties')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .eq('status', 'active');

  if (listing) {
    query = query.eq('listing', listing);
    countQuery = countQuery.eq('listing', listing);
  }

  const [{ data: properties, error }, { count }] = await Promise.all([query, countQuery]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(properties ?? [], {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'X-Total-Count': String(count ?? 0),
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
