'use client';

import Topbar from '@/components/Topbar';
import { useSelectedClient } from '@/components/AppShell';
import type { SocialSummary, MetricoolBrand } from '@/lib/metricool/types';
import { Loader2, Share2, Heart, MessageCircle, TrendingUp, ExternalLink, AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];

function fmtNum(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

function Sparkline({ points }: { points: { date: string; value: number }[] }) {
  if (points.length === 0) return <div style={{ height: 40 }} />;
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40, marginTop: 12 }}>
      {points.map((p) => (
        <div
          key={p.date}
          title={`${fmtDate(p.date)}: ${p.value}`}
          style={{ flex: 1, height: `${Math.max(4, Math.round((p.value / max) * 100))}%`, background: 'var(--ne-blue)', borderRadius: '3px 3px 0 0', minWidth: 2 }}
        />
      ))}
    </div>
  );
}

/** Shown when the client has no Metricool brand mapped yet. */
function ConnectPanel({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const [brands, setBrands] = useState<MetricoolBrand[] | null>(null);
  const [accountConfigured, setAccountConfigured] = useState(true);
  const [blogId, setBlogId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/social?brands=1')
      .then((r) => r.json())
      .then((d) => {
        setAccountConfigured(Boolean(d.configured));
        setBrands(Array.isArray(d.brands) ? d.brands : []);
      })
      .catch(() => setBrands([]));
  }, []);

  const chosen = brands?.find((b) => String(b.id) === blogId);

  async function save() {
    if (!blogId) return;
    setSaving(true);
    setError(null);
    const res = await fetch('/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, blogId, label: chosen?.label ?? null }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setError((await res.json().catch(() => ({}))).error ?? 'Could not save. You may not have permission.');
  }

  return (
    <Card style={{ maxWidth: 560 }}>
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--ne-blue-bg)', display: 'grid', placeItems: 'center', color: 'var(--ne-blue)' }}>
            <Share2 size={19} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--fg1)' }}>Connect social analytics</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--fg3)', margin: '0 0 18px', lineHeight: 1.6 }}>
          Social metrics come from this client’s Metricool brand. Map it once and follower, engagement, and post
          performance data appears here — no per-platform Meta verification needed on your side.
        </p>

        {!accountConfigured ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg2)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', lineHeight: 1.6 }}>
            The Metricool account isn’t connected yet. Set <code>METRICOOL_USER_TOKEN</code> and{' '}
            <code>METRICOOL_USER_ID</code> in the server environment, then reload. You can still paste a brand id
            below to map this client ahead of time.
          </div>
        ) : null}

        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--fg2)', margin: '16px 0 6px' }}>Metricool brand</label>
        {brands === null ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg3)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Loader2 size={13} style={{ animation: 'spin .6s linear infinite' }} /> Loading brands…
          </div>
        ) : brands.length > 0 ? (
          <select
            value={blogId}
            onChange={(e) => setBlogId(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg1)', fontSize: 13 }}
          >
            <option value="">Select a brand…</option>
            {brands.map((b) => (
              <option key={b.id} value={String(b.id)}>{b.label} · {b.id}</option>
            ))}
          </select>
        ) : (
          <input
            value={blogId}
            onChange={(e) => setBlogId(e.target.value)}
            placeholder="Metricool blogId (brand id)"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg1)', fontSize: 13 }}
          />
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--ne-danger, #dc2626)', marginTop: 10 }}>{error}</div>}

        <button
          onClick={save}
          disabled={!blogId || saving}
          style={{ marginTop: 18, padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--ne-blue)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: blogId && !saving ? 'pointer' : 'not-allowed', opacity: blogId && !saving ? 1 : 0.6, display: 'inline-flex', gap: 8, alignItems: 'center' }}
        >
          {saving && <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} />}
          Save brand mapping
        </button>
      </div>
    </Card>
  );
}

function StatCard({ label, value, sub, points }: { label: string; value: string; sub: string; points: { date: string; value: number }[] }) {
  return (
    <Card>
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg2)' }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--fg1)', marginTop: 6, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 5 }}>{sub}</div>
        <Sparkline points={points} />
      </div>
    </Card>
  );
}

export default function SocialPage() {
  const { selectedClientId, clientName } = useSelectedClient();
  const [range, setRange] = useState<RangeDays>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SocialSummary | null>(null);

  const fetchData = useCallback(async () => {
    if (!selectedClientId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/social?clientId=${encodeURIComponent(selectedClientId)}&days=${range}`);
      setData((await res.json()) as SocialSummary);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [selectedClientId, range]);

  useEffect(() => {
    const timer = window.setTimeout(fetchData, 0);
    return () => window.clearTimeout(timer);
  }, [fetchData]);

  return (
    <>
      <Topbar title="Social" subtitle={`${clientName} · Social performance via Metricool`} />
      <div className="page-body" style={{ maxWidth: 1180 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} style={{
                padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: range === r ? 'var(--ne-blue)' : 'var(--surface)', color: range === r ? '#fff' : 'var(--fg2)', boxShadow: 'var(--shadow-sm)',
              }}>
                {r} days
              </button>
            ))}
          </div>
          {loading && (
            <span style={{ fontSize: 12, color: 'var(--fg3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> Loading…
            </span>
          )}
        </div>

        {loading && !data ? (
          <div style={{ color: 'var(--fg3)', fontSize: 13, padding: '60px 0', textAlign: 'center' }}>
            <Loader2 size={18} style={{ animation: 'spin .6s linear infinite' }} />
          </div>
        ) : !data || !data.configured ? (
          selectedClientId ? (
            <ConnectPanel clientId={selectedClientId} onSaved={fetchData} />
          ) : (
            <div style={{ color: 'var(--fg3)', fontSize: 13 }}>Select a client to view social analytics.</div>
          )
        ) : (
          <>
            {data.warning && (
              <div style={{ marginBottom: 18, background: 'var(--ne-warning-bg, #fef3c7)', border: '1px solid var(--ne-warning-muted, #fde68a)', borderRadius: 'var(--r-md)', padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <AlertTriangle size={16} color="var(--ne-warning, #d97706)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--fg2)' }}>{data.warning}</span>
              </div>
            )}

            <div style={{ marginBottom: 20, fontSize: 12.5, color: 'var(--fg3)' }}>
              Metricool brand <strong style={{ color: 'var(--fg1)' }}>{data.brand?.label ?? data.brand?.blogId}</strong> · last {range} days
            </div>

            <div className="grid-stats" style={{ marginBottom: 24 }}>
              {data.timelines.map((t) => (
                <StatCard key={`${t.network}-${t.metric}`} label={t.label} value={fmtNum(t.total)} sub={`${t.network} · ${range}d total`} points={t.points} />
              ))}
              {data.timelines.length === 0 && (
                <Card><div style={{ padding: 20, fontSize: 13, color: 'var(--fg3)' }}>No timeline metrics returned for this brand.</div></Card>
              )}
            </div>

            <Card>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={15} color="var(--ne-blue)" />
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>Recent Instagram posts</span>
              </div>
              {data.instagramPosts.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>No Instagram posts in this period.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, padding: 20 }}>
                  {data.instagramPosts.map((post) => (
                    <div key={post.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--surface-2)' }}>
                      {post.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={post.imageUrl} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', aspectRatio: '1', background: 'var(--surface-3)' }} />
                      )}
                      <div style={{ padding: 12 }}>
                        <div style={{ fontSize: 11.5, color: 'var(--fg2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 30 }}>
                          {post.text ?? '—'}
                        </div>
                        <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 12, color: 'var(--fg3)', alignItems: 'center' }}>
                          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><Heart size={13} />{post.likes}</span>
                          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><MessageCircle size={13} />{post.comments}</span>
                          {post.permalink && (
                            <a href={post.permalink} target="_blank" rel="noopener" style={{ marginLeft: 'auto', color: 'var(--ne-blue)' }}>
                              <ExternalLink size={13} />
                            </a>
                          )}
                        </div>
                        {post.publishedAt && <div style={{ fontSize: 10.5, color: 'var(--fg3)', marginTop: 6 }}>{fmtDate(post.publishedAt)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
