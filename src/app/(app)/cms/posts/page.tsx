'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useState } from 'react';
import { Plus, Search, Filter, MoreHorizontal, Edit, Trash2, Eye, Copy } from 'lucide-react';

const POSTS = [
  { id: '1', title: 'Sifat Sombong Pemusnah Segalanya', cat: 'Character', status: 'published', author: 'Admin', date: '2 Jun 2026', views: 142 },
  { id: '2', title: 'DO NOT LOSE HOPE IN ALLAH SWT', cat: 'Worship', status: 'published', author: 'Admin', date: '28 May 2026', views: 89 },
  { id: '3', title: 'Sampaikan Dengan Hikmah', cat: 'Dakwah', status: 'draft', author: 'Admin', date: '21 May 2026', views: 0 },
  { id: '4', title: 'Ayat al-Quran Yang Buat Nabi Menangis', cat: 'Tafsir', status: 'published', author: 'Admin', date: '14 May 2026', views: 74 },
  { id: '5', title: 'Configuring my Tahajjud', cat: 'Worship', status: 'published', author: 'Admin', date: '7 May 2026', views: 204 },
  { id: '6', title: 'The Spirit of Community in Islam', cat: 'Community', status: 'archived', author: 'Admin', date: '1 May 2026', views: 51 },
  { id: '7', title: 'Upcoming Eid celebrations at Al-Islah', cat: 'Events', status: 'draft', author: 'Admin', date: '25 Apr 2026', views: 0 },
];

const CATS = ['All', 'Character', 'Worship', 'Dakwah', 'Tafsir', 'Community', 'Events'];
const STATUSES = ['All', 'published', 'draft', 'archived'];

export default function PostsPage() {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('All');
  const [status, setStatus] = useState('All');
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const filtered = POSTS.filter((p) =>
    (cat === 'All' || p.cat === cat) &&
    (status === 'All' || p.status === status) &&
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Topbar title="Blog Posts" subtitle={`${POSTS.length} posts total`} />
      <div className="page-body">
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                style={{
                  padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: status === s ? 'var(--ne-ink)' : 'var(--surface)',
                  color: status === s ? '#fff' : 'var(--fg2)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >{s === 'All' ? 'All Posts' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          <Link href="/cms/posts/new" className="btn-ne">
            <Plus size={15} /> New Post
          </Link>
        </div>

        {/* Search + filter bar */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20,
        }}>
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
              <select
                value={cat} onChange={(e) => setCat(e.target.value)}
                style={{ fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 10px', color: 'var(--fg1)', background: 'var(--surface)', cursor: 'pointer' }}
              >
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
                <th>Views</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--fg3)' }}>No posts found</td></tr>
              ) : filtered.map((p) => (
                <tr key={p.id} style={{ position: 'relative' }}>
                  <td style={{ paddingLeft: 20, maxWidth: 340 }}>
                    <Link href={`/cms/posts/${p.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600, fontSize: 13.5 }}>
                      {p.title}
                    </Link>
                    <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>by {p.author}</div>
                  </td>
                  <td><span style={{ fontSize: 12, background: 'var(--surface-3)', padding: '3px 8px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 500 }}>{p.cat}</span></td>
                  <td><span className={`status-pill ${p.status}`}>{p.status}</span></td>
                  <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{p.date}</td>
                  <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{p.views || '—'}</td>
                  <td style={{ position: 'relative' }}>
                    <button
                      onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4, borderRadius: 4 }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {openMenu === p.id && (
                      <div style={{
                        position: 'absolute', right: 12, top: 36, zIndex: 100,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)',
                        minWidth: 140, overflow: 'hidden',
                      }}>
                        {[
                          { icon: Edit, label: 'Edit', href: `/cms/posts/${p.id}` },
                          { icon: Eye, label: 'Preview', href: '#' },
                          { icon: Copy, label: 'Duplicate', href: '#' },
                          { icon: Trash2, label: 'Delete', href: '#', danger: true },
                        ].map(({ icon: Icon, label, href, danger }) => (
                          <Link key={label} href={href}
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: danger ? 'var(--ne-danger)' : 'var(--fg1)', textDecoration: 'none', transition: 'background .1s' }}
                            onClick={() => setOpenMenu(null)}
                          >
                            <Icon size={14} /> {label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination stub */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--fg3)' }}>Showing {filtered.length} of {POSTS.length} posts</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2, 3].map((n) => (
                <button key={n} style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid var(--border)', background: n === 1 ? 'var(--ne-ink)' : 'var(--surface)', color: n === 1 ? '#fff' : 'var(--fg2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{n}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
