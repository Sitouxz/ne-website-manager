import { describe, expect, it } from 'vitest';
import { mockSupabase } from './supabase-mock';

describe('mockSupabase', () => {
  it('resolves a fixture row through .from().select().eq().single()', async () => {
    const supabase = mockSupabase({
      clients: [{ id: 'client-1', slug: 'acme' }],
    });

    const { data, error } = await supabase
      .from('clients')
      .select('id')
      .eq('slug', 'acme')
      .single();

    expect(error).toBeNull();
    expect(data).toEqual({ id: 'client-1', slug: 'acme' });
  });

  it('resolves null data + an error from .single() when no row matches', async () => {
    const supabase = mockSupabase({ clients: [] });

    const { data, error } = await supabase
      .from('clients')
      .select('id')
      .eq('slug', 'missing')
      .single();

    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('resolves an array through .eq().eq().order().limit() without .single()', async () => {
    const supabase = mockSupabase({
      posts: [
        { id: '1', client_id: 'client-1', status: 'published', published_at: '2024-01-01' },
        { id: '2', client_id: 'client-1', status: 'published', published_at: '2024-02-01' },
        { id: '3', client_id: 'client-1', status: 'draft', published_at: '2024-03-01' },
        { id: '4', client_id: 'client-2', status: 'published', published_at: '2024-04-01' },
      ],
    });

    const query = supabase
      .from('posts')
      .select('*')
      .eq('client_id', 'client-1')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(10);

    const { data, error } = await query;

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.[0]).toMatchObject({ id: '2' });
    expect(data?.[1]).toMatchObject({ id: '1' });
  });

  it('supports .insert(...).select().single() and persists the row for later reads', async () => {
    const supabase = mockSupabase({ clients: [] });

    const { data: created, error: insertError } = await supabase
      .from('clients')
      .insert({ name: 'Acme', slug: 'acme' })
      .select()
      .single();

    expect(insertError).toBeNull();
    expect(created).toMatchObject({ name: 'Acme', slug: 'acme' });
    expect(created?.id).toBeTruthy();

    const { data: found } = await supabase
      .from('clients')
      .select('*')
      .eq('slug', 'acme')
      .single();

    expect(found).toMatchObject({ name: 'Acme', slug: 'acme' });
  });

  it('supports .insert(...) awaited directly without .select()', async () => {
    const supabase = mockSupabase({ analytics_events: [] });

    const { error } = await supabase.from('analytics_events').insert({ event_name: 'page_view' });

    expect(error).toBeNull();

    const { data } = await supabase.from('analytics_events').select('*');
    expect(data).toHaveLength(1);
  });

  it('supports .update(...).eq(...) mutating matching fixture rows', async () => {
    const supabase = mockSupabase({
      clients: [{ id: '1', github_repo: null }, { id: '2', github_repo: null }],
    });

    const { error } = await supabase
      .from('clients')
      .update({ github_repo: 'org/repo' })
      .eq('id', '1');

    expect(error).toBeNull();

    const { data: updated } = await supabase.from('clients').select('*').eq('id', '1').single();
    const { data: untouched } = await supabase.from('clients').select('*').eq('id', '2').single();

    expect(updated).toMatchObject({ github_repo: 'org/repo' });
    expect(untouched).toMatchObject({ github_repo: null });
  });

  it('supports .delete().eq(...) removing matching fixture rows', async () => {
    const supabase = mockSupabase({ clients: [{ id: '1' }, { id: '2' }] });

    const { error } = await supabase.from('clients').delete().eq('id', '1');

    expect(error).toBeNull();

    const { data } = await supabase.from('clients').select('*');
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ id: '2' });
  });
});
