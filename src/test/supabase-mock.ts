/**
 * A chainable, in-memory stand-in for a Supabase `SupabaseClient`, built for
 * unit-testing route handlers without hitting a real database.
 *
 * Supports the call shapes actually used in this codebase:
 *   supabase.from('posts').select('*').eq('client_id', id).single()
 *   supabase.from('posts').select('*').eq(...).order(...).limit(...)
 *   supabase.from('clients').insert({...}).select().single()
 *   supabase.from('analytics_events').insert({...})
 *   supabase.from('clients').update({...}).eq('id', id)
 *   supabase.from('clients').delete().eq('id', id)
 *
 * Fixtures are copied on the way in and mutated in place by insert/update/
 * delete, so successive queries against the same mock client observe each
 * other's writes — the same way successive queries against a real database
 * would.
 */

type Row = Record<string, unknown>;
type Fixtures = Record<string, Row[]>;

interface QueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

type MutationKind = 'insert' | 'update' | 'delete' | null;

let mockIdCounter = 0;
function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  mockIdCounter += 1;
  return `mock-id-${mockIdCounter}`;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as never) > (b as never) ? 1 : -1;
}

/** Resolves to `T` once `.single()` has been chained, otherwise `T[]`. */
type Resolved<T, Single extends boolean> = Single extends true ? T : T[];

class QueryBuilder<T = Row, Single extends boolean = false>
  implements PromiseLike<QueryResult<Resolved<T, Single>>>
{
  private rows: Row[];
  private isSingle = false;
  private mutationKind: MutationKind = null;
  private mutationPayload: Row | null = null;
  /** Whether the caller wants rows back (true for reads; false for a bare insert/update/delete). */
  private dataRequested = true;

  constructor(private readonly store: Fixtures, private readonly table: string) {
    this.rows = [...(store[table] ?? (store[table] = []))];
  }

  // Column projection isn't needed for tests — fixtures already contain
  // exactly the shape a test cares about.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  select(_columns?: string): this {
    this.dataRequested = true;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const ascending = options?.ascending ?? true;
    const sorted = [...this.rows].sort((a, b) => compare(a[column], b[column]));
    this.rows = ascending ? sorted : sorted.reverse();
    return this;
  }

  limit(count: number): this {
    this.rows = this.rows.slice(0, count);
    return this;
  }

  single(): QueryBuilder<T, true> {
    this.isSingle = true;
    return this as unknown as QueryBuilder<T, true>;
  }

  insert(payload: Row | Row[]): this {
    this.mutationKind = 'insert';
    this.dataRequested = false;

    const table = this.store[this.table] ?? (this.store[this.table] = []);
    const incoming = Array.isArray(payload) ? payload : [payload];
    const inserted = incoming.map((row) => ({ id: generateId(), ...row }));
    table.push(...inserted);
    this.rows = inserted;
    return this;
  }

  update(payload: Row): this {
    this.mutationKind = 'update';
    this.mutationPayload = payload;
    this.dataRequested = false;
    return this;
  }

  delete(): this {
    this.mutationKind = 'delete';
    this.dataRequested = false;
    return this;
  }

  then<TResult1 = QueryResult<Resolved<T, Single>>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<Resolved<T, Single>>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }

  private resolve(): QueryResult<Resolved<T, Single>> {
    if (this.mutationKind === 'update' && this.mutationPayload) {
      for (const row of this.rows) Object.assign(row, this.mutationPayload);
    }

    if (this.mutationKind === 'delete') {
      const table = this.store[this.table] ?? [];
      const toDelete = new Set(this.rows);
      this.store[this.table] = table.filter((row) => !toDelete.has(row));
    }

    if (!this.dataRequested) {
      return { data: null, error: null };
    }

    if (this.isSingle) {
      if (this.rows.length !== 1) {
        return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
      }
      return { data: this.rows[0] as Resolved<T, Single>, error: null };
    }

    return { data: this.rows as Resolved<T, Single>, error: null };
  }
}

/**
 * Builds a minimal, chainable mock of a Supabase client seeded with the
 * given `fixtures` (keyed by table name). The returned object supports
 * `.from(table)` and the query-builder chains listed above.
 */
export function mockSupabase(fixtures: Record<string, unknown[]> = {}) {
  const store: Fixtures = {};
  for (const [table, rows] of Object.entries(fixtures)) {
    store[table] = rows.map((row) => ({ ...(row as Row) }));
  }

  return {
    from(table: string) {
      return new QueryBuilder(store, table);
    },
  };
}
