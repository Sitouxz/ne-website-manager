'use client';

import Topbar from '@/components/Topbar';
import { useState, useEffect } from 'react';
import { Plus, Globe, Loader2, CheckCircle, X, Users, Edit } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/lib/supabase/types';
import { isPublishingConnected } from '@/lib/publish-config';
import { DEFAULT_TEMPLATE_SLUG, SITE_TEMPLATES, getTemplate } from '@/lib/templates/catalog';
import { describeApplied } from '@/lib/templates/apply';

export default function AdminPage() {
  const [clients,   setClients]   = useState<Client[]>([]);
  // Publish config moved off `clients` onto `client_publish_config`
  // (migration 018) — `clients` has a public-read RLS policy, so the deploy
  // hook could no longer live there. Fetched separately here (this page is
  // only reachable by `ne_admin`, who can read every client's publish config
  // per `client_publish_config_manage`'s policy) and joined client-side by id,
  // purely to drive the "Configured" / "Not set" badge below.
  //
  // Counts EITHER a deploy hook or a revalidate URL, matching the dashboard's
  // "Publishing isn't connected yet" alert. Checking only `deploy_hook` (as
  // this did) reported a revalidate-only client as "Not set", so the two
  // screens disagreed about the same question.
  const [publishConfiguredByClientId, setPublishConfiguredByClientId] = useState<Record<string, boolean>>({});
  const [loading,   setLoading]   = useState(true);
  const [showNew,   setShowNew]   = useState(false);
  const [newClient, setNewClient] = useState({ name: '', slug: '', website_url: '', email: '', password: '', template: DEFAULT_TEMPLATE_SLUG });
  const [creating,  setCreating]  = useState(false);
  const [msg,       setMsg]       = useState('');
  // Tone is tracked explicitly rather than sniffed out of the message text.
  // The old `msg.includes('created')` check would paint "Client created, but
  // some starter content did not save" green.
  const [msgOk,     setMsgOk]     = useState(false);

  useEffect(() => { fetchClients(); }, []);

  async function fetchClients() {
    const supabase = createClient();
    const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
    setClients(data ?? []);

    const { data: configs } = await supabase.from('client_publish_config').select('client_id, deploy_hook, revalidate_url');
    const configured: Record<string, boolean> = {};
    for (const row of (configs ?? []) as Array<{ client_id: string; deploy_hook: string | null; revalidate_url: string | null }>) {
      configured[row.client_id] = isPublishingConnected(row);
    }
    setPublishConfiguredByClientId(configured);

    setLoading(false);
  }

  async function handleCreate() {
    if (!newClient.name || !newClient.slug || !newClient.email || !newClient.password) {
      setMsg('All fields required.'); setMsgOk(false);
      return;
    }
    setCreating(true);
    setMsg('');
    setMsgOk(false);

    const res = await fetch('/api/admin/create-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newClient),
    });
    const json = await res.json();

    if (!res.ok) {
      setMsg(json.error ?? 'Failed to create client.');
      setMsgOk(false);
    } else {
      // Template failures are reported rather than swallowed: the client is
      // usable either way, but an admin who thinks a starter collection exists
      // and finds it missing later has been misled.
      const applied = json.applied as { collections: number; globals: number; navigation: number; errors: string[] } | undefined;
      const failures = applied?.errors ?? [];
      setMsgOk(failures.length === 0);
      setMsg(
        failures.length > 0
          ? `Client created, but some starter content did not save: ${failures.join(' ')}`
          : applied && (applied.collections || applied.globals || applied.navigation)
            ? `Client created with ${describeApplied(applied)}.`
            : 'Client created! Login credentials sent.',
      );
      setShowNew(false);
      setNewClient({ name: '', slug: '', website_url: '', email: '', password: '', template: DEFAULT_TEMPLATE_SLUG });
      fetchClients();
    }
    setCreating(false);
  }

  const selectedTemplate = getTemplate(newClient.template);

  function openClientWorkspace(clientId: string, destination: '/settings' | '/team') {
    document.cookie = `ne_selected_client_id=${encodeURIComponent(clientId)}; path=/; max-age=31536000; samesite=lax`;
    window.location.assign(destination);
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
                <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: msgOk ? '#DCFCE7' : '#FEF2F2', color: msgOk ? 'var(--ne-success)' : 'var(--ne-danger)', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {msgOk ? <CheckCircle size={14} /> : null}{msg}
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

                <div>
                  <label htmlFor="new-client-template" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 5 }}>
                    Start from
                  </label>
                  <select
                    id="new-client-template"
                    value={newClient.template}
                    onChange={(e) => setNewClient({ ...newClient, template: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, color: 'var(--fg1)', background: 'var(--surface)' }}
                  >
                    {SITE_TEMPLATES.map((t) => (
                      <option key={t.slug} value={t.slug}>{t.name}</option>
                    ))}
                  </select>
                  {selectedTemplate && (
                    <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 6 }}>
                      {selectedTemplate.description}
                      {selectedTemplate.collections.length > 0 && (
                        <> Creates {selectedTemplate.collections.map((c) => c.name).join(', ')}.</>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button className="btn-ne" style={{ flex: 1, justifyContent: 'center' }} onClick={handleCreate} disabled={creating}>
                    {creating ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                    Create Client
                  </button>
                  <button className="btn-outline-ne" onClick={() => setShowNew(false)}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Clients table */}
        <div className="panel">
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
                <tr><td colSpan={6} className="table-placeholder">
                  <Loader2 size={16} className="spin" />
                </td></tr>
              ) : clients.length === 0 ? (
                <tr><td colSpan={6} className="table-placeholder">No clients yet.</td></tr>
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
                    <span style={{ fontSize: 12, color: publishConfiguredByClientId[c.id] ? 'var(--ne-success)' : 'var(--ne-danger)' }}>
                      {publishConfiguredByClientId[c.id] ? 'Configured' : 'Not set'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--fg3)' }}>
                    {new Date(c.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ display: 'flex', gap: 6, padding: '14px 12px' }}>
                    <button
                      aria-label={`Edit ${c.name}`}
                      title={`Edit ${c.name}`}
                      onClick={() => openClientWorkspace(c.id, '/settings')}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: 'var(--fg2)' }}
                    >
                      <Edit size={13} />
                    </button>
                    <button
                      aria-label={`Manage users for ${c.name}`}
                      title={`Manage users for ${c.name}`}
                      onClick={() => openClientWorkspace(c.id, '/team')}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: 'var(--fg2)' }}
                    >
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
    </>
  );
}
