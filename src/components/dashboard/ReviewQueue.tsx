import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

interface ReviewQueueProps {
  /**
   * Same scoping convention already used throughout
   * `src/app/(app)/dashboard/page.tsx`: a specific client (either the
   * caller's own `client_id`, or an `ne_admin`'s selected-client cookie),
   * or `null` for an `ne_admin` who hasn't picked one — in which case the
   * queue spans every client, matching how "Recent Posts" on the same
   * page behaves.
   */
  clientId: string | null;
}

interface QueueItem {
  id: string;
  title: string;
  updated_at: string;
}

/**
 * Editorial review queue — Task 6.2. Lists posts an editor has submitted
 * for review (`status = 'in_review'`) so a `client_admin`/`ne_admin` can
 * act on them. The caller (`src/app/(app)/dashboard/page.tsx`) is
 * responsible for only rendering this for those two roles — a plain
 * `editor` has no use for a queue of things awaiting someone else's
 * review, so this component doesn't re-check role itself.
 *
 * Posts-only, deliberately: of the three content tables, only `posts`
 * (`draft|in_review|scheduled|published|archived`, migrations
 * 001/006_editorial.sql) has an `in_review` status at all. `pages`
 * (`draft|published`) and `collection_items`
 * (`draft|published|archived`) have no such state in their CHECK
 * constraints — a row in either table structurally cannot be
 * `in_review`, so there is no dead "also check pages/entries" query
 * branch to write here. If a future phase adds a review state to either
 * table, extending this component is the natural place to do it — not
 * something to build speculatively now (YAGNI).
 */
export default async function ReviewQueue({ clientId }: ReviewQueueProps) {
  const supabase = await createClient();

  let query = supabase
    .from('posts')
    .select('id, title, updated_at')
    .eq('status', 'in_review')
    .order('updated_at', { ascending: false })
    .limit(10);
  if (clientId) query = query.eq('client_id', clientId);

  const { data } = await query;
  const items = (data ?? []) as QueueItem[];

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>
          <ClipboardList size={16} color="var(--ne-warning)" /> Awaiting Review
        </div>
        {items.length > 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ne-warning)', background: '#FFFBEB', padding: '2px 8px', borderRadius: 99 }}>
            {items.length}
          </span>
        )}
      </div>
      <div style={{ padding: items.length === 0 ? '28px 16px' : 8 }}>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>Nothing awaiting review.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/cms/posts/${item.id}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '10px 12px', borderRadius: 'var(--r-sm)', textDecoration: 'none', color: 'var(--fg1)',
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title || '(Untitled)'}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--fg3)', whiteSpace: 'nowrap' }}>
                  {new Date(item.updated_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
