import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; postSlug: string }> }
) {
  const { slug, postSlug } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const { data: post, error } = await supabase
    .from('posts')
    .select('id, title, slug, excerpt, content, cover_url, category, tags, published_at')
    .eq('client_id', client.id)
    .eq('slug', postSlug)
    .eq('status', 'published')
    .single();

  if (error || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  return NextResponse.json(post, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
