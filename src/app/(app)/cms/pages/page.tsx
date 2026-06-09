'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useState } from 'react';
import { Plus, Edit, Eye, Globe, Lock, MoreHorizontal, Trash2 } from 'lucide-react';

const PAGES = [
  { id: 'home', title: 'Home', path: '/', status: 'published', lastUpdated: '5 Jun 2026', visibility: 'public' },
  { id: 'about', title: 'About Al-Islah', path: '/about', status: 'published', lastUpdated: '3 Jun 2026', visibility: 'public' },
  { id: 'contact', title: 'Contact Us', path: '/contact', status: 'published', lastUpdated: '1 Jun 2026', visibility: 'public' },
  { id: 'donations', title: 'Donations & Infaq', path: '/donations', status: 'published', lastUpdated: '28 May 2026', visibility: 'public' },
  { id: 'wedding', title: 'Wedding (Nikah)', path: '/services/wedding', status: 'published', lastUpdated: '20 May 2026', visibility: 'public' },
  { id: 'volunteer', title: 'Be a Volunteer', path: '/volunteer/be-a-volunteer', status: 'published', lastUpdated: '15 May 2026', visibility: 'public' },
  { id: 'privacy', title: 'Privacy Policy', path: '/privacy', status: 'draft', lastUpdated: '10 May 2026', visibility: 'private' },
];

export default function PagesPage() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <>
      <Topbar title="Pages" subtitle={`${PAGES.length} pages managed`} />
      <div className="page-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <p style={{ fontSize: 13.5, color: 'var(--fg3)', margin: 0 }}>
            Manage the static pages of your website. Each page maps to a URL on your live site.
          </p>
          <Link href="/cms/pages/new" className="btn-ne">
            <Plus size={15} /> New Page
          </Link>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Page Title</th>
                <th>URL Path</th>
                <th>Status</th>
                <th>Visibility</th>
                <th>Last Updated</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {PAGES.map((p) => (
                <tr key={p.id}>
                  <td style={{ paddingLeft: 20 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg1)' }}>{p.title}</div>
                  </td>
                  <td>
                    <code style={{ fontSize: 12, background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4, color: 'var(--fg2)' }}>{p.path}</code>
                  </td>
                  <td><span className={`status-pill ${p.status}`}>{p.status}</span></td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--fg3)' }}>
                      {p.visibility === 'public' ? <Globe size={13} /> : <Lock size={13} />}
                      {p.visibility}
                    </span>
                  </td>
                  <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{p.lastUpdated}</td>
                  <td style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Link href={`/cms/pages/${p.id}`}
                        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: 'var(--fg2)', display: 'grid', placeItems: 'center', textDecoration: 'none' }}>
                        <Edit size={13} />
                      </Link>
                      <button style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: 'var(--fg2)' }}>
                        <Eye size={13} />
                      </button>
                      <button
                        onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: 'var(--fg2)' }}>
                        <MoreHorizontal size={13} />
                      </button>
                    </div>
                    {openMenu === p.id && (
                      <div style={{ position: 'absolute', right: 0, top: 36, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)', minWidth: 130, overflow: 'hidden' }}>
                        <button style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--ne-danger)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}>
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Info card */}
        <div style={{ marginTop: 20, background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 'var(--r-md)', padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Globe size={18} color="var(--ne-blue)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ne-blue)', marginBottom: 4 }}>Page editing is coming soon</div>
            <p style={{ fontSize: 12.5, color: 'var(--fg2)', margin: 0 }}>
              Full visual page editing with drag-and-drop blocks is in development. For now, contact your Neu Entity team to update page content.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
