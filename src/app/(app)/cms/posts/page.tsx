'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Plus, Search, Filter, MoreHorizontal, Edit, Trash2, Eye, Copy, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Post } from '@/lib/supabase/types';

const STATUSES = ['All', 'published', 'draft', 'archived'];
const CATS     = ['All', 'Character', 'Worship', 'Dakwah', 'Tafsir', 'Community', 'Events'];

export default function PostsPage() {
  const [posts,    setPosts]    = useState<Post[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [cat,      setCat]      = useState('All');
  const [status,   setStatus]   = useState('All');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchPosts();
  }, []);

  async function fetchPosts() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });
    setPosts(data ?? []);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    setDeleting(id);
    const supabase = createClient();
    await supabase.from('posts').delete().eq('id', id);
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setDeleting(null);
    setOpenMenu(null);
  }

  const filtered = posts.filter((p) =>
    (cat    === 'All' || p.category === cat) &&
    (status === 'All' || p.status   === status) &&
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Topbar title="Blog Posts" subtitle={`${posts.length} posts total`} />
      <div className="page-body">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: status === s ? 'var(--ne-blue)' : 'var(--surface)',
                color:      status === s ? '#fff'          : 'var(--fg2)',
                boxShadow: 'var(--shadow-sm)',
              }}>
                {s === 'All' ? 'All Posts' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <Link href="/cms/posts/new" className="btn-ne">
            <Plus size={15} /> New Post
          </Link>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20 }}>

          {/* Search + filter */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 12px' }}>
              <Search size={14} color="var(--fg3)" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search posts..."
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--fg1)', width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Filter size={13} color="var(--fg3)" />
              <select value={cat} onChange={(e) => setCat(e.target.value)}
                style={{ fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 10px', color: 'var(--fg1)', background: 'var(--surface)', cursor: 'pointer' }}>
                {CATS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Table */}
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Title</th>
                <th>Category</th>
                <th>Status</th>
                <th>Date</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /> Loading posts...
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                    {posts.length === 0 ? 'No posts yet. Create your first post!' : 'No posts match your filters.'}
                  </td>
                </tr>
              ) : filtered.map((p) => (
                <tr key={p.id} style={{ position: 'relative' }}>
                  <td style={{ paddingLeft: 20, maxWidth: 340 }}>
                    <Link href={`/cms/posts/${p.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600, fontSize: 13.5 }}>
                      {p.title || '(Untitled)'}
                    </Link>
                    <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>/{p.slug}</div>
                  </td>
                  <td>
                    {p.category ? (
                      <span style={{ fontSize: 12, background: 'var(--surface-3)', padding: '3px 8px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 500 }}>{p.category}</span>
                    ) : <span style={{ color: 'var(--fg3)', fontSize: 12 }}>—</span>}
                  </td>
                  <td><span className={`status-pill ${p.status}`}>{p.status}</span></td>
                  <td style={{ color: 'var(--fg3)', fontSize: 12 }}>
                    {p.published_at
                      ? new Date(p.published_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
                      : new Date(p.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ position: 'relative' }}>
                    <button
                      onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4, borderRadius: 4 }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {openMenu === p.id && (
                      <div style={{ position: 'absolute', right: 12, top: 36, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)', minWidth: 140, overflow: 'hidden' }}>
                        <Link href={`/cms/posts/${p.id}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--fg1)', textDecoration: 'none' }}
                          onClick={() => setOpenMenu(null)}>
                          <Edit size={14} /> Edit
                        </Link>
                        <button
                          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--ne-danger)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                          onClick={() => handleDelete(p.id)}
                          disabled={deleting === p.id}
                        >
                          {deleting === p.id ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={14} />}
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--fg3)' }}>Showing {filtered.length} of {posts.length} posts</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
