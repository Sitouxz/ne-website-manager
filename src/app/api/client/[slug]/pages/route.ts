import { createClient } from '@/lib/supabase/server';
import { parsePagination } from '@/lib/api/pagination';
import { NextResponse } from 'next/server';

// Historically this route applied no limit/offset at all — every published,
// public page was returned. To keep a no-params request byte-for-byte
// identical to that, pagination is only applied when the caller explicitly
// sends `limit` and/or `offset`; otherwise the query stays unbounded.
const PAGINATION = { defaultLimit: 100, maxLimit: 100 };

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase  = await createClient();
  const url = new URL(req.url);
  const hasExplicitPaging = url.searchParams.has('limit') || url.searchParams.has('offset');
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
    .from('pages')
    .select('id, title, path, content, status, visibility, updated_at')
    .eq('client_id', client.id)
    .eq('status', 'published')
    .eq('visibility', 'public')
    .order('path');

  if (hasExplicitPaging) {
    query = query.range(offset, offset + limit - 1);
  }

  const countQuery = supabase
    .from('pages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .eq('status', 'published')
    .eq('visibility', 'public');

  const [{ data: pages, error }, { count }] = await Promise.all([query, countQuery]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(pages ?? [], {
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
