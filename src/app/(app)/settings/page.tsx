'use client';

import Topbar from '@/components/Topbar';
import { useState, useEffect } from 'react';
import { Save, Globe, Webhook, Loader2, CheckCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/lib/supabase/types';

export default function SettingsPage() {
  const [client,   setClient]   = useState<Client | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [form,     setForm]     = useState({ name: '', website_url: '', deploy_hook: '' });

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('client_id')
        .eq('id', user.id)
        .single();

      if (!profile?.client_id) { setLoading(false); return; }

      const { data: c } = await supabase
        .from('clients')
        .select('*')
        .eq('id', profile.client_id)
        .single();

      if (c) {
        setClient(c);
        setForm({ name: c.name, website_url: c.website_url ?? '', deploy_hook: c.deploy_hook ?? '' });
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    if (!client) return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from('clients').update({
      name:        form.name,
      website_url: form.website_url || null,
      deploy_hook: form.deploy_hook || null,
    }).eq('id', client.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function testDeploy() {
    if (!form.deploy_hook) return;
    await fetch(form.deploy_hook, { method: 'POST' });
    alert('Deploy hook triggered! Check Vercel dashboard.');
  }

  if (loading) {
    return (
      <>
        <Topbar title="Site Settings" />
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  return (
    <>
      <Topbar title="Site Settings" subtitle={client?.name} />
      <div className="page-body" style={{ maxWidth: 720 }}>

        {/* Save bar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24, gap: 8 }}>
          {saved && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ne-success)', padding: '8px 14px', background: '#DCFCE7', borderRadius: 'var(--r-sm)' }}>
              <CheckCircle size={13} /> Settings saved
            </div>
          )}
          <button className="btn-ne" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
            Save Settings
          </button>
        </div>

        {/* General */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Globe size={16} color="var(--ne-blue)" />
            <div style={{ fontWeight: 700, fontSize: 14 }}>General</div>
          </div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Site Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Website URL</label>
              <input
                value={form.website_url}
                onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                placeholder="https://your-site.com"
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace' }}
              />
              <p style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 5 }}>The live URL of the client website.</p>
            </div>
          </div>
        </div>

        {/* Deploy Hook */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Webhook size={16} color="var(--ne-blue)" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Vercel Deploy Hook</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>Triggers a site rebuild when you publish content</div>
            </div>
          </div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Deploy Hook URL</label>
              <input
                value={form.deploy_hook}
                onChange={(e) => setForm({ ...form, deploy_hook: e.target.value })}
                placeholder="https://api.vercel.com/v1/integrations/deploy/..."
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 12.5, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace' }}
              />
            </div>
            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '14px 16px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg2)', marginBottom: 8 }}>How to get your deploy hook:</div>
              <ol style={{ fontSize: 12, color: 'var(--fg3)', margin: 0, paddingLeft: 16, lineHeight: 2 }}>
                <li>Go to <b style={{ color: 'var(--fg2)' }}>vercel.com</b> and open your website project</li>
                <li>Settings &rarr; Git &rarr; Deploy Hooks</li>
                <li>Create a new hook (name: &ldquo;NE Website Manager&rdquo;, branch: main)</li>
                <li>Copy the URL and paste it above</li>
              </ol>
            </div>
            {form.deploy_hook && (
              <button onClick={testDeploy} className="btn-outline-ne" style={{ alignSelf: 'flex-start' }}>
                Test Deploy Hook
              </button>
            )}
          </div>
        </div>

        {/* API Access */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>API Endpoints (read-only)</div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12.5, color: 'var(--fg3)', margin: '0 0 8px' }}>
              Use these public endpoints in your website to fetch published content:
            </p>
            {client && [
              { label: 'Blog Posts', url: `/api/client/${client.slug}/posts` },
              { label: 'Pages',      url: `/api/client/${client.slug}/pages` },
            ].map(({ label, url }) => (
              <div key={url} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 80, fontSize: 12, fontWeight: 600, color: 'var(--fg2)' }}>{label}</div>
                <code style={{ flex: 1, fontSize: 11.5, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px', color: 'var(--ne-blue)', display: 'block' }}>
                  {typeof window !== 'undefined' ? window.location.origin : 'https://ne-website-manager.vercel.app'}{url}
                </code>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
