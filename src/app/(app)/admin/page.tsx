'use client';

import Topbar from '@/components/Topbar';
import { useState, useEffect } from 'react';
import { Plus, Globe, Loader2, CheckCircle, X, Users, Edit } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/lib/supabase/types';

export default function AdminPage() {
  const [clients,   setClients]   = useState<Client[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showNew,   setShowNew]   = useState(false);
  const [newClient, setNewClient] = useState({ name: '', slug: '', website_url: '', email: '', password: '' });
  const [creating,  setCreating]  = useState(false);
  const [msg,       setMsg]       = useState('');

  useEffect(() => { fetchClients(); }, []);

  async function fetchClients() {
    const supabase = createClient();
    const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
    setClients(data ?? []);
    setLoading(false);
  }

  async function handleCreate() {
    if (!newClient.name || !newClient.slug || !newClient.email || !newClient.password) {
      setMsg('All fields required.');
      return;
    }
    setCreating(true);
    setMsg('');

    const res = await fetch('/api/admin/create-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newClient),
    });
    const json = await res.json();

    if (!res.ok) {
      setMsg(json.error ?? 'Failed to create client.');
    } else {
      setMsg('Client created! Login credentials sent.');
      setShowNew(false);
      setNewClient({ name: '', slug: '', website_url: '', email: '', password: '' });
      fetchClients();
    }
    setCreating(false);
  }

  return (
    <>
      <Topbar title="NE Admin" subtitle="All managed clients" />
      <div className="page-body">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <p style={{ fontSize: 13.5, color: 'var(--fg3)', margin: 0 }}>
            Manage all client websites. Each client gets their own login and isolated CMS.
          </p>
          <button className="btn-ne" onClick={() => setShowNew(true)}>
            <Plus size={15} /> New Client
          </button>
        </div>

        {/* New client modal */}
        {showNew && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '28px 32px', width: 480, boxShadow: '0 16px 48px rgba(0,0,0,.15)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Add New Client</div>
                <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}><X size={18} /></button>
              </div>
              {msg && (
                <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: msg.includes('created') ? '#DCFCE7' : '#FEF2F2', color: msg.includes('created') ? 'var(--ne-success)' : 'var(--ne-danger)', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {msg.includes('created') ? <CheckCircle size={14} /> : null}{msg}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { key: 'name',        label: 'Client / Site Name',  ph: 'Al-Islah Mosque' },
                  { key: 'slug',        label: 'URL Slug (unique)',    ph: 'al-islah' },
                  { key: 'website_url', label: 'Website URL',          ph: 'https://alisla.vercel.app' },
                  { key: 'email',       label: 'Admin Email',          ph: 'admin@al-islah.sg' },
                  { key: 'password',    label: 'Temp Password',        ph: 'Set a secure password' },
                ].map(({ key, label, ph }) => (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 5 }}>{label}</label>
                    <input
                      type={key === 'password' ? 'password' : 'text'}
                      value={(newClient as Record<string,string>)[key]}
                      onChange={(e) => setNewClient({ ...newClient, [key]: e.target.value })}
                      placeholder={ph}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)' }}
                    />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button className="btn-ne" style={{ flex: 1, justifyContent: 'center' }} onClick={handleCreate} disabled={creating}>
                    {creating ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Plus size={14} />}
                    Create Client
                  </button>
                  <button className="btn-outline-ne" onClick={() => setShowNew(false)}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Clients table */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Client</th>
                <th>Website</th>
                <th>Plan</th>
                <th>Deploy Hook</th>
                <th>Created</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                  <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} />
                </td></tr>
              ) : clients.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>No clients yet.</td></tr>
              ) : clients.map((c) => (
                <tr key={c.id}>
                  <td style={{ paddingLeft: 20 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.name}</div>
                    <code style={{ fontSize: 11, color: 'var(--fg3)' }}>{c.slug}</code>
                  </td>
                  <td>
                    {c.website_url
                      ? <a href={c.website_url} target="_blank" rel="noopener" style={{ fontSize: 12.5, color: 'var(--ne-blue)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Globe size={12} />{c.website_url}
                        </a>
                      : <span style={{ color: 'var(--fg3)', fontSize: 12 }}>—</span>}
                  </td>
                  <td><span style={{ fontSize: 12, background: 'var(--ne-blue-muted)', color: 'var(--ne-blue)', padding: '3px 8px', borderRadius: 99, fontWeight: 600 }}>{c.plan}</span></td>
                  <td>
                    <span style={{ fontSize: 12, color: c.deploy_hook ? 'var(--ne-success)' : 'var(--fg3)' }}>
                      {c.deploy_hook ? 'Configured' : 'Not set'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--fg3)' }}>
                    {new Date(c.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ display: 'flex', gap: 6, padding: '14px 12px' }}>
                    <button style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: 'var(--fg2)' }}>
                      <Edit size={13} />
                    </button>
                    <button style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: 'var(--fg2)' }}>
                      <Users size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
