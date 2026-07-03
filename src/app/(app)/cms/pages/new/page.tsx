'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Topbar from '@/components/Topbar';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';

/**
 * "New Page" form, mirroring `src/app/(app)/cms/posts/new/page.tsx`'s
 * create-then-redirect shape, but — unlike that page, which silently seeds
 * an `untitled-<timestamp>` slug and hands off immediately — this one
 * collects title + path *up front* before creating the row.
 *
 * Why the divergence: a post's `slug` is a single URL-safe segment
 * mechanically derived from the title (`slugify()`), cheap to fix later in
 * the editor. A page's `path` is a full route address (e.g. `/about`,
 * `/services/pricing`) that can be nested arbitrarily deep — a page
 * created with a throwaway `/untitled-1720000000` path is a worse default
 * than just asking for both up front, which is also what the task brief
 * calls for ("New Page (title + path)"). Editing the path later in the
 * full editor is still possible; this form only supplies the initial value.
 */
export default function NewPagePage() {
  const router = useRouter();
  const { selectedClientId } = useSelectedClient();
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [pathTouched, setPathTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!pathTouched) setPath(value ? `/${slugify(value)}` : '');
  }

  async function handleCreate() {
    setError('');

    const trimmedPath = path.trim();
    if (!trimmedPath.startsWith('/')) {
      setError('Path must start with "/" (e.g. /about).');
      return;
    }

    setCreating(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not authenticated'); setCreating(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('client_id, role')
      .eq('id', user.id)
      .single();

    const clientId = profile?.role === 'ne_admin' ? selectedClientId : profile?.client_id;
    if (!clientId) {
      setError('No client linked to your account. Select a client in the sidebar first.');
      setCreating(false);
      return;
    }

    const { data: newPage, error: err } = await supabase
      .from('pages')
      .insert({
        client_id: clientId,
        title: title.trim(),
        path: trimmedPath,
        content: '',
        content_json: null,
        status: 'draft',
        visibility: 'public',
      })
      .select()
      .single();

    if (err) { setError(err.message); setCreating(false); return; }

    router.replace(`/cms/pages/${newPage.id}`);
  }

  return (
    <>
      <Topbar title="New Page" subtitle="Create a new page" />
      <div className="page-body">
        <Link href="/cms/pages" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500, marginBottom: 20, width: 'fit-content' }}>
          <ArrowLeft size={14} /> Back to Pages
        </Link>

        <div style={{ maxWidth: 480, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '20px 22px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 6 }}>Title</label>
              <input
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="About Us"
                autoFocus
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 12px', fontSize: 14, color: 'var(--fg1)', outline: 'none' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 6 }}>Path</label>
              <input
                value={path}
                onChange={(e) => { setPath(e.target.value); setPathTouched(true); }}
                placeholder="/about"
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 12px', fontSize: 13.5, color: 'var(--ne-blue)', fontFamily: 'monospace', outline: 'none' }}
              />
              <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 5 }}>
                Full route address on the live site — supports nesting, e.g. /services/pricing.
              </div>
            </div>
            {error && (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>
                {error}
              </div>
            )}
            <button className="btn-ne" style={{ justifyContent: 'center' }} onClick={handleCreate} disabled={creating || !path.trim()}>
              {creating ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : null}
              Create Page
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
