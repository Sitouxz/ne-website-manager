'use client';

import Topbar from '@/components/Topbar';
import { useState, useEffect, useCallback } from 'react';
import {
  Save, Globe, Webhook, Loader2, CheckCircle, Code2,
  GitBranch, ExternalLink, Copy, Check, Zap, Terminal,
  KeyRound, Plus, Trash2, X, AlertTriangle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Client, ClientPublishConfig, WebhookDelivery } from '@/lib/supabase/types';

type Tab = 'general' | 'deploy' | 'integration' | 'api';

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function CopyBtn({
  text, k, copiedKey, onCopy,
}: { text: string; k: string; copiedKey: string | null; onCopy: (text: string, key: string) => void }) {
  return (
    <button
      onClick={() => onCopy(text, k)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: '4px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600 }}
    >
      {copiedKey === k ? <><Check size={12} color="var(--ne-success)" /> Copied!</> : <><Copy size={12} /> Copy</>}
    </button>
  );
}

export default function SettingsPage() {
  const [client,   setClient]   = useState<Client | null>(null);
  const [clients,  setClients]  = useState<Client[]>([]);
  const [isAdmin,  setIsAdmin]  = useState(false);
  const [role,     setRole]     = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [tab,      setTab]      = useState<Tab>('general');
  const [form,     setForm]     = useState({
    name: '', website_url: '', deploy_hook: '', github_repo: '',
    revalidate_url: '', revalidate_secret: '',
  });
  const [cmsBase,  setCmsBase]  = useState('');

  // Publishing tab — delivery log (Task 7.1). Extends the existing "Deploy
  // Hook" tab (relabeled "Publishing") rather than adding a brand-new tab:
  // revalidate URL/secret and the delivery log are both about the same
  // underlying question ("what happens when I publish?") that the deploy
  // hook fields already answer, so folding them into one tab keeps related
  // settings together instead of splitting "how content reaches the live
  // site" across two separate tabs.
  const [deliveries,        setDeliveries]        = useState<WebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading]  = useState(false);
  const [deliveriesErr,     setDeliveriesErr]      = useState('');

  // Integration state
  const [ghToken,   setGhToken]   = useState('');
  const [pushing,   setPushing]   = useState(false);
  const [prUrl,     setPrUrl]     = useState('');
  const [intErr,    setIntErr]    = useState('');
  const [copied,    setCopied]    = useState<string | null>(null);

  // API Keys state
  const canManageKeys = isAdmin || role === 'client_admin';
  const [apiKeys,       setApiKeys]       = useState<ApiKeyRow[]>([]);
  const [keysLoading,   setKeysLoading]   = useState(false);
  const [keysErr,       setKeysErr]       = useState('');
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [newKeyName,    setNewKeyName]    = useState('');
  const [generating,    setGenerating]    = useState(false);
  const [newPlaintext,  setNewPlaintext]  = useState<string | null>(null);
  const [revokingId,    setRevokingId]    = useState<string | null>(null);

  // deploy_hook/revalidate_url/revalidate_secret live on `client_publish_config`
  // (migration 018), not `clients` — `clients` has a public-read RLS policy,
  // which used to expose `revalidate_secret` in plaintext to any
  // unauthenticated caller with the anon key. `applyClient` only ever sets
  // the plain `clients` fields; `loadPublishConfig` (below) is a separate
  // fetch, run whenever the selected client changes.
  function applyClient(c: Client | null) {
    setClient(c);
    setForm((f) => ({
      ...f,
      name: c?.name ?? '',
      website_url: c?.website_url ?? '',
      github_repo: c?.github_repo ?? '',
      // Reset to blank immediately on client switch so stale values from the
      // previously-selected client never flash while the new client's
      // publish-config fetch is in flight.
      deploy_hook: '',
      revalidate_url: '',
      revalidate_secret: '',
    }));
  }

  const loadPublishConfig = useCallback(async (clientId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('client_publish_config')
      .select('deploy_hook, revalidate_url, revalidate_secret')
      .eq('client_id', clientId)
      .maybeSingle();
    const config = data as Pick<ClientPublishConfig, 'deploy_hook' | 'revalidate_url' | 'revalidate_secret'> | null;
    setForm((f) => ({
      ...f,
      deploy_hook: config?.deploy_hook ?? '',
      revalidate_url: config?.revalidate_url ?? '',
      revalidate_secret: config?.revalidate_secret ?? '',
    }));
  }, []);

  useEffect(() => {
    if (!client?.id) return;
    loadPublishConfig(client.id);
  }, [client?.id, loadPublishConfig]);

  useEffect(() => {
    const originTimer = window.setTimeout(() => {
      setCmsBase(window.location.origin.replace(/\/$/, ''));
    }, 0);

    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('client_id, role').eq('id', user.id).single();
      const admin = profile?.role === 'ne_admin';
      setIsAdmin(admin);
      setRole(profile?.role ?? null);

      if (admin) {
        const { data: allClients } = await supabase.from('clients').select('*').order('name', { ascending: true });
        const rows = (allClients ?? []) as Client[];
        setClients(rows);
        applyClient(rows[0] ?? null);
      } else if (profile?.client_id) {
        const { data: c } = await supabase.from('clients').select('*').eq('id', profile.client_id).single();
        applyClient((c as Client | null) ?? null);
      }
      setLoading(false);
    }
    load();
    return () => window.clearTimeout(originTimer);
  }, []);

  async function handleSave() {
    if (!client) return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from('clients').update({
      name:        form.name,
      website_url: form.website_url || null,
      github_repo: form.github_repo || null,
    }).eq('id', client.id);
    // Upsert (rather than update) since a client with no publish config set
    // yet has no `client_publish_config` row at all — only rows with at
    // least one value set are ever created (see migration 018).
    await supabase.from('client_publish_config').upsert({
      client_id:         client.id,
      deploy_hook:       form.deploy_hook || null,
      revalidate_url:    form.revalidate_url || null,
      revalidate_secret: form.revalidate_secret || null,
    }, { onConflict: 'client_id' });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleClientSelect(id: string) {
    applyClient(clients.find((c) => c.id === id) ?? null);
    setSaved(false);
    setPrUrl('');
    setIntErr('');
  }

  async function testDeploy() {
    if (!form.deploy_hook) return;
    await fetch(form.deploy_hook, { method: 'POST' });
    alert('Deploy hook triggered! Check Vercel dashboard.');
  }

  const loadDeliveries = useCallback(async (clientId: string) => {
    setDeliveriesLoading(true);
    setDeliveriesErr('');
    const supabase = createClient();
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) setDeliveriesErr(error.message);
    setDeliveries((data ?? []) as WebhookDelivery[]);
    setDeliveriesLoading(false);
  }, []);

  useEffect(() => {
    if (!(tab === 'deploy' && client?.id)) return;
    const clientId = client.id;
    const timer = window.setTimeout(() => loadDeliveries(clientId), 0);
    return () => window.clearTimeout(timer);
  }, [tab, client?.id, loadDeliveries]);

  // Fires a real `content.updated` test event through the actual
  // notifyPublish pipeline (not a raw unsigned POST) — so this genuinely
  // exercises the HMAC-signing + delivery-logging path, and the row shows
  // up in the delivery log below a moment later, matching the established
  // "Test Deploy Hook" button's spirit but for the signed revalidate path.
  async function testRevalidate() {
    if (!client || !form.revalidate_url) return;
    await fetch('/api/publish/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: client.id,
        event: 'content.updated',
        entityType: 'test',
        entityId: 'settings-test-ping',
        slug: null,
      }),
    });
    alert('Revalidate webhook queued! Check the delivery log below in a few seconds.');
    window.setTimeout(() => loadDeliveries(client.id), 1500);
  }

  async function handlePushToGitHub() {
    if (!client || !ghToken || !form.github_repo) return;
    setPushing(true);
    setPrUrl('');
    setIntErr('');
    const res = await fetch('/api/admin/push-integration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        github_token: ghToken,
        repo: form.github_repo,
        slug: client.slug,
        client_name: client.name,
      }),
    });
    const json = await res.json();
    setPushing(false);
    if (!res.ok) { setIntErr(json.error ?? 'Failed'); }
    else { setPrUrl(json.pr_url); }
  }

  const loadKeys = useCallback(async (clientId: string) => {
    setKeysLoading(true);
    setKeysErr('');
    try {
      const res = await fetch(`/api/keys?client_id=${clientId}`);
      const json = await res.json();
      if (!res.ok) {
        setKeysErr(json.error ?? 'Failed to load API keys');
        setApiKeys([]);
      } else {
        setApiKeys(json as ApiKeyRow[]);
      }
    } catch {
      setKeysErr('Failed to load API keys');
    }
    setKeysLoading(false);
  }, []);

  useEffect(() => {
    if (!(tab === 'api' && canManageKeys && client?.id)) return;
    const clientId = client.id;
    const timer = window.setTimeout(() => loadKeys(clientId), 0);
    return () => window.clearTimeout(timer);
  }, [tab, canManageKeys, client?.id, loadKeys]);

  async function handleGenerateKey() {
    if (!client) return;
    setGenerating(true);
    setKeysErr('');
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, name: newKeyName.trim() || 'Untitled key' }),
      });
      const json = await res.json();
      if (!res.ok) {
        setKeysErr(json.error ?? 'Failed to generate key');
      } else {
        setNewPlaintext(json.plaintext);
        setNewKeyName('');
        loadKeys(client.id);
      }
    } catch {
      setKeysErr('Failed to generate key');
    }
    setGenerating(false);
  }

  async function handleRevokeKey(id: string) {
    if (!client) return;
    if (!window.confirm('Revoke this API key? Any site using it will immediately lose keyed access.')) return;
    setRevokingId(id);
    try {
      const res = await fetch(`/api/keys?id=${id}`, { method: 'DELETE' });
      if (res.ok) loadKeys(client.id);
    } finally {
      setRevokingId(null);
    }
  }

  function closeKeyDialog() {
    setShowKeyDialog(false);
    setNewPlaintext(null);
    setNewKeyName('');
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) return (
    <>
      <Topbar title="Site Settings" />
      <div className="page-body" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );

  const slug = client?.slug ?? '';
  const apiBase = cmsBase || '';
  const postsUrl = `${apiBase}/api/client/${slug}/posts`;
  const pagesUrl = `${apiBase}/api/client/${slug}/pages`;
  const sdkUrl = `${apiBase}/api/client/${slug}/sdk`;

  const snippets: Record<string, { label: string; lang: string; code: string }[]> = {
    nextjs: [
      {
        label: 'Install CMS lib (copy file)',
        lang: 'bash',
        code: `# Download lib/cms.ts into your Next.js project\ncurl -o lib/cms.ts ${sdkUrl}`,
      },
      {
        label: 'Fetch posts (SSG)',
        lang: 'tsx',
        code: `import { getPosts } from '@/lib/cms';

export default async function BlogPage() {
  const posts = await getPosts();
  return (
    <ul>
      {posts.map((p) => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  );
}`,
      },
      {
        label: 'Dynamic post page',
        lang: 'tsx',
        code: `import { getPosts, getPostBySlug } from '@/lib/cms';

export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map((p) => ({ slug: p.slug }));
}

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await getPostBySlug(params.slug);
  if (!post) return <div>Not found</div>;
  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.content }} />
    </article>
  );
}`,
      },
    ],
    react: [
      {
        label: 'usePosts hook',
        lang: 'tsx',
        code: `import { useEffect, useState } from 'react';

const CMS_POSTS = '${postsUrl}';

export function usePosts() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(CMS_POSTS)
      .then((r) => r.json())
      .then((data) => { setPosts(data); setLoading(false); });
  }, []);
  return { posts, loading };
}`,
      },
    ],
    fetch: [
      {
        label: 'Plain fetch (any framework)',
        lang: 'js',
        code: `// Posts
const posts = await fetch('${postsUrl}').then(r => r.json());

// Pages
const pages = await fetch('${pagesUrl}').then(r => r.json());`,
      },
    ],
  };

  const TAB_STYLES = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 13, fontWeight: active ? 700 : 500,
    color: active ? 'var(--ne-blue)' : 'var(--fg2)',
    background: 'none', border: 'none', borderBottom: active ? '2px solid var(--ne-blue)' : '2px solid transparent',
    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  });

  return (
    <>
      <Topbar title="Site Settings" subtitle={client?.name} />
      <div className="page-body" style={{ maxWidth: 760 }}>

        {/* Save bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {isAdmin ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg2)' }}>Client</label>
              <select
                value={client?.id ?? ''}
                onChange={(e) => handleClientSelect(e.target.value)}
                style={{ fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 10px', color: 'var(--fg1)', background: 'var(--surface)', minWidth: 220 }}
              >
                {clients.length === 0 ? <option value="">No clients</option> : clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          ) : <div />}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {saved && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ne-success)', padding: '8px 14px', background: '#DCFCE7', borderRadius: 'var(--r-sm)' }}>
              <CheckCircle size={13} /> Saved
            </div>
          )}
          <button className="btn-ne" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
            Save Settings
          </button>
          </div>
        </div>

        {!client ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '32px', color: 'var(--fg3)', fontSize: 13.5 }}>
            No client is available for site settings yet. Create a client from NE Admin first.
          </div>
        ) : (
          <>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 0, overflowX: 'auto' }}>
          {([
            ['general',     'General',     Globe],
            ['deploy',      'Publishing',  Webhook],
            ['integration', 'Integration', GitBranch],
            ['api',         'API Access',  Terminal],
          ] as [Tab, string, React.ElementType][]).map(([key, label, Icon]) => (
            <button key={key} style={TAB_STYLES(tab === key)} onClick={() => setTab(key)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon size={13} />{label}
              </span>
            </button>
          ))}
        </div>

        {/* ── General ── */}
        {tab === 'general' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Globe size={16} color="var(--ne-blue)" />
              <div style={{ fontWeight: 700, fontSize: 14 }}>General</div>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Site Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Website URL</label>
                <input value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                  placeholder="https://your-site.com"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace' }} />
              </div>
            </div>
          </div>
        )}

        {/* ── Publishing (Deploy Hook + Revalidate + delivery log) ── */}
        {tab === 'deploy' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Vercel Deploy Hook */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Webhook size={16} color="var(--ne-blue)" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Vercel Deploy Hook</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>Triggers a full site rebuild when you publish content</div>
                </div>
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Deploy Hook URL</label>
                  <input value={form.deploy_hook} onChange={(e) => setForm({ ...form, deploy_hook: e.target.value })}
                    placeholder="https://api.vercel.com/v1/integrations/deploy/..."
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 12.5, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace' }} />
                </div>
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '14px 16px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg2)', marginBottom: 8 }}>How to get your deploy hook:</div>
                  <ol style={{ fontSize: 12, color: 'var(--fg3)', margin: 0, paddingLeft: 16, lineHeight: 2 }}>
                    <li>Go to <b style={{ color: 'var(--fg2)' }}>vercel.com</b> and open your website project</li>
                    <li>Settings &rarr; Git &rarr; Deploy Hooks</li>
                    <li>Create hook — name: &ldquo;NE Website Manager&rdquo;, branch: main</li>
                    <li>Copy the URL and paste above</li>
                  </ol>
                </div>
                {form.deploy_hook && (
                  <button onClick={testDeploy} className="btn-outline-ne" style={{ alignSelf: 'flex-start' }}>
                    <Zap size={13} /> Test Deploy Hook
                  </button>
                )}
              </div>
            </div>

            {/* Revalidate URL (Task 7.1) */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Webhook size={16} color="var(--ne-blue)" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Revalidate Webhook</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>Signed POST sent to your site on every publish/update — lets it revalidate just the affected page instead of a full rebuild</div>
                </div>
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Revalidate URL</label>
                  <input value={form.revalidate_url} onChange={(e) => setForm({ ...form, revalidate_url: e.target.value })}
                    placeholder="https://your-site.com/api/revalidate"
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 12.5, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Signing Secret</label>
                  <input
                    type="password"
                    value={form.revalidate_secret}
                    onChange={(e) => setForm({ ...form, revalidate_secret: e.target.value })}
                    placeholder="a long random string, shared with your site's revalidate handler"
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace' }}
                  />
                  <p style={{ fontSize: 11.5, color: 'var(--fg3)', margin: '5px 0 0' }}>
                    Every request to the Revalidate URL is signed with this secret via an <code>x-ne-signature</code> header
                    (hex HMAC-SHA256 of the request body). Set the same value as your site&apos;s <code>createRevalidateHandler</code> secret.
                  </p>
                </div>
                {form.revalidate_url && (
                  <button onClick={testRevalidate} className="btn-outline-ne" style={{ alignSelf: 'flex-start' }}>
                    <Zap size={13} /> Test Revalidate Webhook
                  </button>
                )}
              </div>
            </div>

            {/* Delivery log (Task 7.1) */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                Recent Deliveries
                <span style={{ fontWeight: 500, fontSize: 11.5, color: 'var(--fg3)', marginLeft: 8 }}>Last 20 webhook attempts for this client</span>
              </div>
              <div style={{ padding: deliveries.length === 0 && !deliveriesLoading ? 20 : 0 }}>
                {deliveriesErr && (
                  <div style={{ margin: 20, padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
                    {deliveriesErr}
                  </div>
                )}
                {deliveriesLoading ? (
                  <div style={{ padding: 20, fontSize: 12.5, color: 'var(--fg3)' }}>Loading deliveries...</div>
                ) : deliveries.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>No webhook deliveries yet — they&apos;ll show up here after your next publish/update.</div>
                ) : (
                  deliveries.map((d) => (
                    <div
                      key={d.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
                        borderTop: '1px solid var(--border)', flexWrap: 'wrap',
                      }}
                    >
                      <span
                        title={d.ok ? 'Delivered' : 'Failed'}
                        style={{
                          width: 8, height: 8, borderRadius: 99, flexShrink: 0,
                          background: d.ok ? 'var(--ne-success)' : 'var(--ne-danger)',
                        }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg1)', minWidth: 130 }}>{d.event}</span>
                      <code style={{ flex: 1, minWidth: 160, fontSize: 11, color: 'var(--fg3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.url}
                      </code>
                      <span style={{ fontSize: 11, fontWeight: 600, color: d.ok ? 'var(--ne-success)' : 'var(--ne-danger)', flexShrink: 0 }}>
                        {d.status_code ?? 'no response'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--fg3)', flexShrink: 0 }}>
                        {new Date(d.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Integration ── */}
        {tab === 'integration' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* GitHub Auto-PR */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <GitBranch size={16} color="var(--ne-blue)" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>GitHub Auto-Integration</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>Push <code>lib/cms.ts</code> to your repo and open a PR automatically</div>
                </div>
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>GitHub Repository</label>
                  <input
                    value={form.github_repo}
                    onChange={(e) => setForm({ ...form, github_repo: e.target.value })}
                    placeholder="username/repo-name (e.g. Sitouxz/alisla)"
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>
                    GitHub Personal Access Token
                    <a href="https://github.com/settings/tokens/new?scopes=repo&description=NE+Website+Manager" target="_blank" rel="noopener" style={{ marginLeft: 8, fontSize: 11, color: 'var(--ne-blue)', fontWeight: 500 }}>
                      Generate token <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                    </a>
                  </label>
                  <input
                    type="password"
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace' }}
                  />
                  <p style={{ fontSize: 11.5, color: 'var(--fg3)', margin: '5px 0 0' }}>Needs <code>repo</code> scope. Token is used once and never stored.</p>
                </div>

                {intErr && (
                  <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
                    {intErr}
                  </div>
                )}
                {prUrl && (
                  <div style={{ padding: '12px 16px', background: '#DCFCE7', color: 'var(--ne-success)', borderRadius: 'var(--r-sm)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CheckCircle size={16} />
                    <div>
                      PR created! &nbsp;
                      <a href={prUrl} target="_blank" rel="noopener" style={{ color: 'var(--ne-success)', fontWeight: 700 }}>
                        View on GitHub <ExternalLink size={11} style={{ verticalAlign: 'middle' }} />
                      </a>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-ne"
                    onClick={handlePushToGitHub}
                    disabled={pushing || !ghToken || !form.github_repo}
                  >
                    {pushing
                      ? <><Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> Pushing...</>
                      : <><GitBranch size={14} /> Push lib/cms.ts &amp; Open PR</>}
                  </button>
                  <button className="btn-outline-ne" onClick={handleSave} disabled={saving}>
                    <Save size={13} /> Save Repo
                  </button>
                </div>

                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '12px 16px', fontSize: 12, color: 'var(--fg3)', lineHeight: 1.7 }}>
                  <b style={{ color: 'var(--fg2)' }}>What this does:</b>
                  <ol style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                    <li>Creates a new branch <code>cms/ne-integration-*</code></li>
                    <li>Adds <code>lib/cms.ts</code> — typed API client with <code>getPosts()</code>, <code>getPostBySlug()</code>, <code>getPages()</code></li>
                    <li>Opens a pull request on your default branch for review</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Code Snippets */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Code2 size={16} color="var(--ne-blue)" />
                <div style={{ fontWeight: 700, fontSize: 14 }}>Code Snippets</div>
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
                {Object.entries(snippets).map(([framework, items]) => (
                  <div key={framework}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg3)', marginBottom: 10 }}>
                      {framework === 'nextjs' ? 'Next.js (App Router)' : framework === 'react' ? 'React (CRA / Vite)' : 'Plain Fetch'}
                    </div>
                    {items.map((snippet) => (
                      <div key={snippet.label} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--ne-ink-2)', borderRadius: '6px 6px 0 0', padding: '8px 14px' }}>
                          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{snippet.label}</span>
                          <CopyBtn text={snippet.code} k={`${framework}-${snippet.label}`} copiedKey={copied} onCopy={copyText} />
                        </div>
                        <pre style={{
                          margin: 0, padding: '14px 16px', background: 'var(--ne-ink)', borderRadius: '0 0 6px 6px',
                          fontSize: 12, lineHeight: 1.7, color: '#e2e8f0', overflowX: 'auto',
                          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        }}>
                          {snippet.code}
                        </pre>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── API Access ── */}
        {tab === 'api' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>API Endpoints (public read-only)</div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12.5, color: 'var(--fg3)', margin: '0 0 8px' }}>
                Use these endpoints in your website to fetch published content at runtime or build time.
              </p>
              {client && [
                { label: 'Blog Posts', url: postsUrl },
                { label: 'Pages',      url: pagesUrl },
                { label: 'SDK',        url: sdkUrl },
              ].map(({ label, url }) => (
                <div key={url} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ width: 80, fontSize: 12, fontWeight: 600, color: 'var(--fg2)', flexShrink: 0 }}>{label}</div>
                  <code style={{ flex: 1, minWidth: 0, fontSize: 11.5, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px', color: 'var(--ne-blue)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {url}
                  </code>
                  <CopyBtn text={url} k={`api-${label}`} copiedKey={copied} onCopy={copyText} />
                </div>
              ))}
            </div>
          </div>

          {/* API Keys — ne_admin + client_admin only */}
          {canManageKeys && client && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <KeyRound size={16} color="var(--ne-blue)" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>API Keys</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>Optional Bearer-token auth for the endpoints above</div>
                  </div>
                </div>
                <button className="btn-ne" onClick={() => setShowKeyDialog(true)}>
                  <Plus size={13} /> Generate Key
                </button>
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {keysErr && (
                  <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
                    {keysErr}
                  </div>
                )}
                {keysLoading ? (
                  <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>Loading keys...</div>
                ) : apiKeys.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>No API keys yet. Generate one to enable keyed access.</div>
                ) : (
                  apiKeys.map((k) => (
                    <div
                      key={k.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                        border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', flexWrap: 'wrap',
                        opacity: k.revoked_at ? 0.55 : 1,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg1)' }}>{k.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg3)', fontFamily: 'monospace' }}>ne_{k.prefix}_••••••••</div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg3)', flexShrink: 0 }}>
                        Created {new Date(k.created_at).toLocaleDateString()}
                        {' · '}
                        {k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'Never used'}
                      </div>
                      {k.revoked_at ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ne-danger)', flexShrink: 0 }}>Revoked</span>
                      ) : (
                        <button
                          onClick={() => handleRevokeKey(k.id)}
                          disabled={revokingId === k.id}
                          style={{
                            background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px',
                            fontSize: 11.5, fontWeight: 600, color: 'var(--ne-danger)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                          }}
                        >
                          {revokingId === k.id
                            ? <Loader2 size={12} style={{ animation: 'spin .6s linear infinite' }} />
                            : <Trash2 size={12} />}
                          Revoke
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          </div>
        )}
          </>
        )}
      </div>

      {/* Generate Key dialog */}
      {showKeyDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '28px 32px', width: 460, boxShadow: '0 16px 48px rgba(0,0,0,.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{newPlaintext ? 'API Key Generated' : 'Generate API Key'}</div>
              <button onClick={closeKeyDialog} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}><X size={18} /></button>
            </div>

            {newPlaintext ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: '#FEF9E7', color: '#92600C', borderRadius: 'var(--r-sm)', fontSize: 12.5, alignItems: 'flex-start' }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>Copy this key now — for security, you won&apos;t be able to see it again.</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, minWidth: 0, fontSize: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', color: 'var(--ne-blue)', overflowWrap: 'anywhere' }}>
                    {newPlaintext}
                  </code>
                  <CopyBtn text={newPlaintext} k="new-api-key" copiedKey={copied} onCopy={copyText} />
                </div>
                <button className="btn-ne" style={{ justifyContent: 'center' }} onClick={closeKeyDialog}>Done</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {keysErr && (
                  <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
                    {keysErr}
                  </div>
                )}
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Key Name</label>
                  <input
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. Production website"
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ne" style={{ flex: 1, justifyContent: 'center' }} onClick={handleGenerateKey} disabled={generating}>
                    {generating ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Plus size={14} />}
                    Generate
                  </button>
                  <button className="btn-outline-ne" onClick={closeKeyDialog}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
