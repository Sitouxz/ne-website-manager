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
 *   supabase.from('posts').select('*').eq(...).order(...).range(from, to)
 *   supabase.from('posts').select('id', { count: 'exact', head: true }).eq(...)
 *   supabase.from('posts').update({...}).eq('status', 'scheduled').lte('scheduled_at', now).select()
 *   supabase.from('analytics_events').select(...).eq('event_name', 'page_view').gte('created_at', since)
 *   supabase.from('analytics_daily').upsert(rows, { onConflict: 'client_id,day,path' })
 *
 * Fixtures are copied on the way in and mutated in place by insert/update/
 * delete, so successive queries against the same mock client observe each
 * other's writes — the same way successive queries against a real database
 * would.
 */

type Row = Record<string, unknown>;
type Fixtures = Record<string, Row[]>;

interface SelectOptions {
  count?: 'exact';
  head?: boolean;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count: number | null;
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
  /** Set by `select(columns, { count: 'exact' })`. */
  private countRequested = false;
  /** Set by `select(columns, { head: true })` — Postgrest HEAD requests never return rows. */
  private headOnly = false;
  /**
   * Snapshot of how many rows matched the filters (`.eq()`/`.order()`) at the
   * moment `.range()` or `.limit()` first truncates the set — i.e. the total
   * count "ignoring any subsequent `.range()`/`.limit()`" that real
   * Supabase's `{ count: 'exact' }` reports. `null` until captured.
   */
  private matchedCount: number | null = null;

  constructor(private readonly store: Fixtures, private readonly table: string) {
    this.rows = [...(store[table] ?? (store[table] = []))];
  }

  // Column projection isn't needed for tests — fixtures already contain
  // exactly the shape a test cares about.
  select(_columns?: string, options?: SelectOptions): this {
    this.dataRequested = true;
    if (options?.count === 'exact') this.countRequested = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    const set = new Set(values);
    this.rows = this.rows.filter((row) => set.has(row[column]));
    return this;
  }

  /**
   * Postgrest-style `lte` (`<=`). `null`/`undefined` values never match —
   * mirrors real Postgres, where `null <= x` is unknown (not true), and lets
   * e.g. `.eq('status', 'scheduled').lte('scheduled_at', now)` correctly
   * exclude rows whose `scheduled_at` has already been cleared to `null`.
   */
  lte(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => {
      const v = row[column];
      if (v === null || v === undefined) return false;
      return (v as never) <= (value as never);
    });
    return this;
  }

  /** Postgrest-style `gte` (`>=`) — same null-never-matches rule as `lte`. */
  gte(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => {
      const v = row[column];
      if (v === null || v === undefined) return false;
      return (v as never) >= (value as never);
    });
    return this;
  }

  /**
   * Minimal Postgrest-style `LIKE` (case-sensitive; `%` = any run of chars,
   * `_` = any single char). Only what callers in this codebase need
   * (e.g. `mime_type LIKE 'image/%'`) — no escaping of literal `%`/`_`.
   */
  like(column: string, pattern: string): this {
    const regex = new RegExp(
      `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`
    );
    this.rows = this.rows.filter((row) => typeof row[column] === 'string' && regex.test(row[column] as string));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const ascending = options?.ascending ?? true;
    const sorted = [...this.rows].sort((a, b) => compare(a[column], b[column]));
    this.rows = ascending ? sorted : sorted.reverse();
    return this;
  }

  limit(count: number): this {
    this.captureMatchedCount();
    this.rows = this.rows.slice(0, count);
    return this;
  }

  /**
   * Postgrest-style range: both bounds inclusive, applied to whatever the
   * chain has filtered/sorted down to so far (e.g. after `.eq()`/`.order()`).
   */
  range(from: number, to: number): this {
    this.captureMatchedCount();
    this.rows = this.rows.slice(from, to + 1);
    return this;
  }

  /** Records the pre-truncation row count the first time `.range()`/`.limit()` is called. */
  private captureMatchedCount(): void {
    if (this.countRequested && this.matchedCount === null) {
      this.matchedCount = this.rows.length;
    }
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

  /**
   * Postgrest-style `upsert(rows, { onConflict })`: for each incoming row,
   * finds an existing row in the table matching every `onConflict` column
   * (comma-separated, e.g. `'client_id,day,path'`) and merges the payload
   * into it in place; otherwise inserts a new row. Defaults `onConflict` to
   * `['id']` to mirror Postgrest's own default conflict target.
   */
  upsert(payload: Row | Row[], options?: { onConflict?: string }): this {
    this.mutationKind = 'insert';
    this.dataRequested = false;

    const table = this.store[this.table] ?? (this.store[this.table] = []);
    const incoming = Array.isArray(payload) ? payload : [payload];
    const conflictColumns = options?.onConflict?.split(',').map((c) => c.trim()) ?? ['id'];

    const result: Row[] = [];
    for (const row of incoming) {
      const existing = table.find((candidate) =>
        conflictColumns.every((column) => candidate[column] === row[column])
      );
      if (existing) {
        Object.assign(existing, row);
        result.push(existing);
      } else {
        const inserted = { id: generateId(), ...row };
        table.push(inserted);
        result.push(inserted);
      }
    }
    this.rows = result;
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

    // `count` reflects rows matched by `.eq()`/`.order()` filtering, ignoring
    // any later `.range()`/`.limit()` truncation — captured by those methods,
    // or (if neither was called) simply the current, untruncated row count.
    const count = this.countRequested ? this.matchedCount ?? this.rows.length : null;

    if (!this.dataRequested) {
      return { data: null, error: null, count };
    }

    // Postgrest HEAD requests (`{ head: true }`) never return rows.
    if (this.headOnly) {
      return { data: null, error: null, count };
    }

    if (this.isSingle) {
      if (this.rows.length !== 1) {
        return { data: null, error: { message: 'No rows found', code: 'PGRST116' }, count };
      }
      return { data: this.rows[0] as Resolved<T, Single>, error: null, count };
    }

    return { data: this.rows as Resolved<T, Single>, error: null, count };
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
