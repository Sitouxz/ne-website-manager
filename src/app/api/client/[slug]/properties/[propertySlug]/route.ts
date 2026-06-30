import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; propertySlug: string }> }
) {
  const { slug, propertySlug } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const { data: property, error } = await supabase
    .from('properties')
    .select('*')
    .eq('client_id', client.id)
    .eq('slug', propertySlug)
    .eq('status', 'active')
    .single();

  if (error || !property) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }

  return NextResponse.json(property, {
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
