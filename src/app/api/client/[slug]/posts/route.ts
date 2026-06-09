import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase  = await createClient();

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, title, slug, excerpt, cover_url, category, tags, published_at')
    .eq('client_id', client.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(posts ?? [], {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
