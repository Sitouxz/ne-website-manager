import { describe, expect, it } from 'vitest';
import { mockSupabase } from './supabase-mock';

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), n: i }));
}

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

  describe('.range()', () => {
    it('returns exactly 10 rows starting at offset 0 from a larger fixture set', async () => {
      const supabase = mockSupabase({ posts: makeRows(25) });

      const { data, error } = await supabase.from('posts').select('*').order('n').range(0, 9);

      expect(error).toBeNull();
      expect(data).toHaveLength(10);
      expect(data?.map((r) => r.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('applies range to the filtered set, not the whole table (composes after .eq())', async () => {
      const supabase = mockSupabase({
        posts: [
          { id: '1', client_id: 'client-1', n: 0 },
          { id: '2', client_id: 'client-2', n: 1 },
          { id: '3', client_id: 'client-1', n: 2 },
          { id: '4', client_id: 'client-1', n: 3 },
          { id: '5', client_id: 'client-2', n: 4 },
          { id: '6', client_id: 'client-1', n: 5 },
        ],
      });

      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('client_id', 'client-1')
        .order('n')
        .range(1, 2);

      // Only 4 rows match client-1 (n: 0, 2, 3, 5); range(1,2) should select
      // the 2nd and 3rd of *those*, not the 2nd/3rd of the full table.
      expect(error).toBeNull();
      expect(data).toHaveLength(2);
      expect(data?.map((r) => r.n)).toEqual([2, 3]);
    });

    it('returns a shorter page when the range extends past the end of the matched set', async () => {
      const supabase = mockSupabase({ posts: makeRows(5) });

      const { data, error } = await supabase.from('posts').select('*').order('n').range(3, 20);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
      expect(data?.map((r) => r.n)).toEqual([3, 4]);
    });
  });

  describe('{ count: "exact" }', () => {
    it('returns { data: null, count, error: null } on a filtered, head:true query', async () => {
      const supabase = mockSupabase({
        posts: [
          { id: '1', client_id: 'client-1', status: 'published' },
          { id: '2', client_id: 'client-1', status: 'published' },
          { id: '3', client_id: 'client-1', status: 'draft' },
          { id: '4', client_id: 'client-2', status: 'published' },
        ],
      });

      const { data, count, error } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', 'client-1')
        .eq('status', 'published');

      expect(data).toBeNull();
      expect(count).toBe(2);
      expect(error).toBeNull();
    });

    it('reports the full matching count, not just the size of a subsequent .range() page', async () => {
      const supabase = mockSupabase({ posts: makeRows(25) });

      const { data, count, error } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .order('n')
        .range(0, 9);

      expect(error).toBeNull();
      expect(count).toBe(25);
      expect(data).toHaveLength(10);
    });

    it('returns count: null when { count: "exact" } was not requested', async () => {
      const supabase = mockSupabase({ posts: makeRows(3) });

      const { count } = await supabase.from('posts').select('*');

      expect(count).toBeNull();
    });
  });
});
