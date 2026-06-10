'use client';

import Topbar from '@/components/Topbar';
import { useState, useEffect } from 'react';
import {
  Save, Globe, Webhook, Loader2, CheckCircle, Code2,
  GitBranch, ExternalLink, Copy, Check, Zap, Terminal,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/lib/supabase/types';

type Tab = 'general' | 'deploy' | 'integration' | 'api';

export default function SettingsPage() {
  const [client,   setClient]   = useState<Client | null>(null);
  const [clients,  setClients]  = useState<Client[]>([]);
  const [isAdmin,  setIsAdmin]  = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [tab,      setTab]      = useState<Tab>('general');
  const [form,     setForm]     = useState({ name: '', website_url: '', deploy_hook: '', github_repo: '' });
  const [cmsBase,  setCmsBase]  = useState('');

  // Integration state
  const [ghToken,   setGhToken]   = useState('');
  const [pushing,   setPushing]   = useState(false);
  const [prUrl,     setPrUrl]     = useState('');
  const [intErr,    setIntErr]    = useState('');
  const [copied,    setCopied]    = useState<string | null>(null);

  function applyClient(c: Client | null) {
    setClient(c);
    setForm({
      name: c?.name ?? '',
      website_url: c?.website_url ?? '',
      deploy_hook: c?.deploy_hook ?? '',
      github_repo: c?.github_repo ?? '',
    });
  }

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
      deploy_hook: form.deploy_hook || null,
      github_repo: form.github_repo || null,
    }).eq('id', client.id);
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

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  const CopyBtn = ({ text, k }: { text: string; k: string }) => (
    <button
      onClick={() => copyText(text, k)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: '4px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600 }}
    >
      {copied === k ? <><Check size={12} color="var(--ne-success)" /> Copied!</> : <><Copy size={12} /> Copy</>}
    </button>
  );

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
            ['deploy',      'Deploy Hook', Webhook],
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

        {/* ── Deploy Hook ── */}
        {tab === 'deploy' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Webhook size={16} color="var(--ne-blue)" />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Vercel Deploy Hook</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>Triggers a site rebuild when you publish content</div>
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
                          <CopyBtn text={snippet.code} k={`${framework}-${snippet.label}`} />
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
                  <CopyBtn text={url} k={`api-${label}`} />
                </div>
              ))}
            </div>
          </div>
        )}
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
