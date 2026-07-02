'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Topbar from '@/components/Topbar';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';

/**
 * Thin "create then redirect" page. Task 3.3 gave the full post editor
 * (`../[id]/page.tsx`) autosave/revisions/scheduling/preview — all of which
 * need a real `posts.id` to write against. Rather than duplicate that
 * editor's logic here for the "not saved yet" case, this page creates a
 * minimal draft row immediately and hands off to `/cms/posts/{id}`, so those
 * features are live from the first keystroke instead of only after a first
 * manual save.
 */
export default function NewPostPage() {
  const router = useRouter();
  const { selectedClientId } = useSelectedClient();
  const [error, setError] = useState('');
  const hasCreatedRef = useRef(false);

  useEffect(() => {
    if (hasCreatedRef.current) return;
    hasCreatedRef.current = true;

    async function create() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Not authenticated'); return; }

      const { data: profile } = await supabase
        .from('profiles')
        .select('client_id, role')
        .eq('id', user.id)
        .single();

      const clientId = profile?.role === 'ne_admin' ? selectedClientId : profile?.client_id;
      if (!clientId) {
        setError('No client linked to your account. Select a client in the sidebar first.');
        return;
      }

      const { data: newPost, error: err } = await supabase
        .from('posts')
        .insert({
          client_id: clientId,
          author_id: user.id,
          title: '',
          slug: `untitled-${Date.now()}`,
          excerpt: '',
          content: '',
          content_json: null,
          category: 'Worship',
          tags: [],
          status: 'draft',
        })
        .select()
        .single();

      if (err) { setError(err.message); return; }

      router.replace(`/cms/posts/${newPost.id}`);
    }

    create();
  }, [router, selectedClientId]);

  return (
    <>
      <Topbar title="New Post" subtitle="Creating draft..." />
      <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        {error ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ne-danger)', padding: '10px 16px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>
            {error}
          </div>
        ) : (
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
