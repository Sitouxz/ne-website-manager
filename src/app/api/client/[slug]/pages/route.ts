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

  const { data: pages, error } = await supabase
    .from('pages')
    .select('id, title, path, content, updated_at')
    .eq('client_id', client.id)
    .eq('status', 'published')
    .eq('visibility', 'public')
    .order('path');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(pages ?? [], {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
