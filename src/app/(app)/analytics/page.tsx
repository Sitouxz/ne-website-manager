'use client';

import Topbar from '@/components/Topbar';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { computeLivePath } from '@/lib/publish-client';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart2, Clock, Download, Eye, Layers,
  MousePointerClick, MonitorSmartphone, ShieldCheck, Sparkles, UserPlus, Users, Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { daysSince } from '@/lib/dates';
import {
  COMPARE_MODES, RANGE_PRESETS, comparisonRange, isDayKey, resolveRange,
  type CompareMode, type RangePreset,
} from '@/lib/analytics/range';
import { DEFAULT_TIMEZONE, safeTimezone, tzShortLabel } from '@/lib/analytics/tz';
import {
  CURRENT_TRACKER_VERSION, EMPTY_COUNTS, ENGAGED_MIN_MS, ENGAGED_MIN_PAGE_VIEWS, avgEngagedMs, bounceRate,
  engagementRate, fmtDuration, fmtNumber, fmtPct, newVisitorShare, pagesPerSession, pctChange,
  returningVisitors, type OverviewCounts,
} from '@/lib/analytics/metrics';
import {
  GRANULARITY_LABELS, allowedGranularities, defaultGranularity, fetchBreakdown, fetchHourly, fetchOverview,
  fetchSeries, pointDays, type BreakdownRow, type Granularity, type HourlyCell, type Scope, type SeriesPoint,
} from '@/lib/analytics/queries';
import TrendChart, { TREND_METRICS, type TrendMetric } from './TrendChart';
import HourlyHeatmap from './HourlyHeatmap';

type CmsPost = {
  client_id: string;
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  category: string | null;
  published_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type CmsPage = {
  id: string;
  title: string;
  path: string;
  status: 'draft' | 'published';
  visibility: 'public' | 'private';
  updated_at: string | null;
};

type RecentEvent = {
  id: string;
  event_name: string;
  path: string;
  referrer: string | null;
  device: string | null;
  created_at: string;
};

type ClientMeta = { id: string; blog_path: string | null; timezone: string | null };

type Breakdowns = Record<'pages' | 'referrers' | 'entries' | 'exits' | 'devices' | 'browsers' | 'countries' | 'events', BreakdownRow[]>;

const EMPTY_BREAKDOWNS: Breakdowns = { pages: [], referrers: [], entries: [], exits: [], devices: [], browsers: [], countries: [], events: [] };

function fmtDate(iso: string | null | undefined) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined, tz: string) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz });
}

/**
 * Like `daysSince` from `lib/dates`, but distinguishes "no data" from "today":
 * the Last CMS Update tile renders `null` as "-" and 0 as "0d", so collapsing
 * the two would claim an update happened today when none ever has.
 */
function daysSinceOrNull(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  return daysSince(iso, nowMs);
}

function host(referrer: string | null) {
  if (!referrer) return 'Direct';
  try {
    return new URL(referrer).hostname.replace(/^www\./, '');
  } catch {
    return 'Other';
  }
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', minWidth: 0, ...style }}>
      {children}
    </div>
  );
}

function CardHead({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>{title}</div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>{hint}</div>}
      </div>
      {action}
    </div>
  );
}

function Delta({ current, previous }: { current: number | null; previous: number | null | undefined }) {
  if (previous === undefined) return null;
  const change = pctChange(current, previous);
  if (change === null) return <span style={{ fontSize: 11, color: 'var(--fg3)' }}>no baseline</span>;
  const up = change >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span title={`Previous: ${fmtNumber(previous, Number.isInteger(previous) ? 0 : 1)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11.5, fontWeight: 700, color: up ? 'var(--ne-success)' : 'var(--ne-danger)' }}>
      <Icon size={13} />{up ? '+' : ''}{fmtPct(change, 0)}
    </span>
  );
}

function StatCard({ label, value, sub, icon: Icon, color, current, previous, help }: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  color: string;
  /** Raw numbers for the comparison chip; `previous` undefined hides it. */
  current?: number | null;
  previous?: number | null;
  help?: string;
}) {
  return (
    <div className="stat-card" title={help}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: color + '18', display: 'grid', placeItems: 'center', color }}>
          <Icon size={18} />
        </div>
        {current !== undefined && <Delta current={current} previous={previous} />}
      </div>
      <div className="num">{value}</div>
      <div className="lbl">{label}</div>
      <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function BarList({ rows, total, unit, limit = 6 }: { rows: BreakdownRow[]; total: number; unit?: string; limit?: number }) {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--fg3)', fontSize: 13, padding: '28px 0', textAlign: 'center' }}>No data yet.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {rows.slice(0, limit).map((row) => (
        <div key={row.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
            <span title={row.name} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 600, color: 'var(--fg1)' }}>{row.name}</span>
            <span style={{ fontSize: 12, color: 'var(--fg3)', whiteSpace: 'nowrap' }} title={`${row.visitors.toLocaleString('en-US')} visitors`}>
              {row.count.toLocaleString('en-US')}{unit ? ` ${unit}` : ''} · {fmtPct(row.count / Math.max(1, total), 0)}
            </span>
          </div>
          <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 99 }}>
            <div style={{ height: '100%', width: `${Math.max(4, Math.round((row.count / Math.max(1, total)) * 100))}%`, background: 'var(--ne-blue)', borderRadius: 99 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '12px 14px', background: 'var(--surface-2)' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg1)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--fg2)', marginTop: 6 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '4px 10px', fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: value === o.id ? 'var(--ne-blue)' : 'var(--surface)', color: value === o.id ? '#fff' : 'var(--fg2)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--fg1)', fontSize: 12.5,
};

export default function AnalyticsPage() {
  const { selectedClientId, clientName } = useSelectedClient();
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [compare, setCompare] = useState<CompareMode>('previous');
  const [granularityChoice, setGranularityChoice] = useState<Granularity | null>(null);
  const [metric, setMetric] = useState<TrendMetric>('views');
  const [includeBots, setIncludeBots] = useState(false);
  // "Now" for range resolution. Read from the clock only in the initializer
  // and in event handlers (never during render), so render stays pure.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [clients, setClients] = useState<ClientMeta[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewCounts>(EMPTY_COUNTS);
  const [prevOverview, setPrevOverview] = useState<OverviewCounts | null>(null);
  const [breakdowns, setBreakdowns] = useState<Breakdowns>(EMPTY_BREAKDOWNS);
  const [pageViewsByPath, setPageViewsByPath] = useState<Map<string, number>>(new Map());
  const [hourly, setHourly] = useState<HourlyCell[]>([]);
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [prevSeries, setPrevSeries] = useState<SeriesPoint[] | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [posts, setPosts] = useState<CmsPost[]>([]);
  const [pages, setPages] = useState<CmsPage[]>([]);

  const selectedClient = clients?.find((c) => c.id === selectedClientId) ?? null;
  const tz = selectedClientId ? safeTimezone(selectedClient?.timezone) : DEFAULT_TIMEZONE;
  const tzLabel = `${tz.replace(/_/g, ' ')} (${tzShortLabel(tz, nowMs)})`;
  const blogPathByClient = useMemo(
    () => Object.fromEntries((clients ?? []).map((c) => [c.id, c.blog_path || '/blog'])),
    [clients],
  );

  // A custom range only fetches once both dates are valid, so half-typed
  // input never triggers a request.
  const customReady = preset !== 'custom' || (isDayKey(customFrom) && isDayKey(customTo));
  const range = useMemo(() => resolveRange(preset, nowMs, customFrom, customTo, tz), [preset, nowMs, customFrom, customTo, tz]);
  const prevRange = useMemo(() => comparisonRange(range, compare), [range, compare]);
  const granularities = allowedGranularities(range.days);
  const granularity = granularityChoice && granularities.includes(granularityChoice) ? granularityChoice : defaultGranularity(range.days);

  // Client metadata (timezone, blog path) first: the timezone decides the
  // day boundaries of every query below.
  useEffect(() => {
    let cancelled = false;
    createClient().from('clients').select('id, blog_path, timezone').then(({ data }) => {
      if (!cancelled) setClients((data ?? []) as ClientMeta[]);
    });
    return () => { cancelled = true; };
  }, []);

  // Overview, comparison overview, breakdowns, heatmap, recent events, CMS.
  useEffect(() => {
    if (!clients || !customReady) return;
    let cancelled = false;
    const supabase = createClient();
    const scope: Scope = { clientId: selectedClientId, range, includeBots };

    async function load() {
      setLoading(true);
      let recentQuery = supabase
        .from('analytics_events')
        .select('id, event_name, path, referrer, device, created_at')
        .neq('event_name', 'page_leave')
        .gte('created_at', range.start.toISOString())
        .lt('created_at', range.endExclusive.toISOString())
        .order('created_at', { ascending: false })
        .limit(8);
      if (selectedClientId) recentQuery = recentQuery.eq('client_id', selectedClientId);
      if (!includeBots) recentQuery = recentQuery.eq('is_bot', false);

      let postsQuery = supabase
        .from('posts')
        .select('id, client_id, title, slug, status, category, published_at, updated_at, created_at')
        .order('updated_at', { ascending: false });
      if (selectedClientId) postsQuery = postsQuery.eq('client_id', selectedClientId);
      let pagesQuery = supabase
        .from('pages')
        .select('id, title, path, status, visibility, updated_at')
        .order('updated_at', { ascending: false });
      if (selectedClientId) pagesQuery = pagesQuery.eq('client_id', selectedClientId);

      const [ov, prev, pagesBd, referrers, entries, exits, devices, browsers, countries, events, hours, recentRes, postsRes, pagesRes] = await Promise.all([
        fetchOverview(supabase, scope),
        prevRange ? fetchOverview(supabase, { ...scope, range: prevRange }) : Promise.resolve(null),
        // Wide enough to look up every post's path for the Top Posts table.
        fetchBreakdown(supabase, scope, 'page', 2000),
        fetchBreakdown(supabase, scope, 'referrer', 10),
        fetchBreakdown(supabase, scope, 'entry_page', 10),
        fetchBreakdown(supabase, scope, 'exit_page', 10),
        fetchBreakdown(supabase, scope, 'device', 10),
        fetchBreakdown(supabase, scope, 'browser', 10),
        fetchBreakdown(supabase, scope, 'country', 10),
        fetchBreakdown(supabase, scope, 'event', 10),
        fetchHourly(supabase, scope),
        recentQuery,
        postsQuery,
        pagesQuery,
      ]);
      if (cancelled) return;

      const errors = [
        ov.error, prev?.error, pagesBd.error, referrers.error, entries.error, exits.error, devices.error,
        browsers.error, countries.error, events.error, hours.error,
        recentRes.error?.message, postsRes.error?.message, pagesRes.error?.message,
      ].filter(Boolean);
      setLoadError(errors.length ? [...new Set(errors)].join(' · ') : null);
      setOverview(ov.data);
      setPrevOverview(prev ? prev.data : null);
      setBreakdowns({
        pages: pagesBd.data, referrers: referrers.data, entries: entries.data, exits: exits.data,
        devices: devices.data, browsers: browsers.data, countries: countries.data, events: events.data,
      });
      setPageViewsByPath(new Map(pagesBd.data.map((r) => [r.name, r.count])));
      setHourly(hours.data);
      setRecent((recentRes.data ?? []) as RecentEvent[]);
      setPosts((postsRes.data ?? []) as CmsPost[]);
      setPages((pagesRes.data ?? []) as CmsPage[]);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [clients, customReady, selectedClientId, range, prevRange, includeBots]);

  // Trend series: refetched on granularity changes without reloading the rest.
  useEffect(() => {
    if (!clients || !customReady) return;
    let cancelled = false;
    const supabase = createClient();
    const scope: Scope = { clientId: selectedClientId, range, includeBots };

    async function load() {
      setSeriesLoading(true);
      const [cur, prev] = await Promise.all([
        fetchSeries(supabase, scope, granularity),
        prevRange ? fetchSeries(supabase, { ...scope, range: prevRange }, granularity) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setSeries(cur.data);
      setPrevSeries(prev ? prev.data : null);
      if (cur.error || prev?.error) setLoadError((e) => e ?? cur.error ?? prev?.error ?? null);
      setSeriesLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [clients, customReady, selectedClientId, range, prevRange, includeBots, granularity]);

  const choosePreset = (id: RangePreset) => {
    if (id === 'custom' && !customFrom) {
      setCustomFrom(range.startKey);
      setCustomTo(range.endKey);
    }
    setNowMs(() => Date.now());
    setGranularityChoice(null);
    setPreset(id);
  };

  const drillInto = (point: SeriesPoint) => {
    setCustomFrom(point.startKey);
    setCustomTo(point.endKey);
    setGranularityChoice(null);
    setPreset('custom');
  };

  const canDrill = (point: SeriesPoint) => pointDays(point) < range.days;

  // ── Derived numbers (definitions in lib/analytics/metrics.ts) ───────────
  const o = overview;
  const p = prevOverview;
  const cmp = (fn: (c: OverviewCounts) => number | null) => (p ? fn(p) : undefined);
  const avgPerDay = o.page_views / Math.max(1, range.days);
  const engRate = engagementRate(o);
  const avgEngaged = avgEngagedMs(o);
  const pps = pagesPerSession(o);
  const newShare = newVisitorShare(o);
  const legacyOnly = o.page_views > 0 && (o.tracker_version ?? 0) < CURRENT_TRACKER_VERSION;
  const partlyMeasured = o.measured_sessions > 0 && o.measured_sessions < o.sessions;
  const measuredNote = partlyMeasured ? ` · based on ${fmtNumber(o.measured_sessions)} of ${fmtNumber(o.sessions)} sessions (tracker v3)` : '';
  const needsV3 = 'Needs tracker v3';
  const totalEvents = breakdowns.events.reduce((s, r) => s + r.count, 0);

  const publishedPosts = posts.filter((post) => post.status === 'published');
  const publicPages = pages.filter((page) => page.status === 'published' && page.visibility === 'public');
  const lastUpdated = [...posts.map((x) => x.updated_at), ...pages.map((x) => x.updated_at)]
    .filter(Boolean)
    .sort()
    .at(-1);
  const freshness = daysSinceOrNull(lastUpdated, nowMs);

  // Per-post performance: match each post's canonical live path (via
  // `computeLivePath`, the same helper the publish pipeline uses — never
  // re-derive the blog-path convention here) against page views per path.
  const postPerformance = posts
    .map((post) => {
      const path = computeLivePath('post', { slug: post.slug, blogPath: blogPathByClient[post.client_id] });
      return { post, path, views: path ? pageViewsByPath.get(path) ?? 0 : 0 };
    })
    .filter((row): row is { post: CmsPost; path: string; views: number } => row.path !== null)
    .sort((a, b) => b.views - a.views || a.post.title.localeCompare(b.post.title))
    .slice(0, 8);

  const exportPdf = async () => {
    setExporting(true);
    try {
      const { buildAnalyticsPdf } = await import('@/lib/analytics/pdf');
      const kpi = (label: string, value: string, sub: string, cur: number | null, prev: number | null | undefined) => ({
        label, value, sub, delta: prev === undefined ? null : pctChange(cur, prev),
      });
      const daySeries = granularity === 'day' ? series : (await fetchSeries(createClient(), { clientId: selectedClientId, range, includeBots }, 'day')).data;
      const doc = await buildAnalyticsPdf({
        clientName,
        rangeLabel: range.label,
        rangeDays: range.days,
        timezoneLabel: tzLabel,
        comparisonLabel: prevRange ? `${COMPARE_MODES.find((m) => m.id === compare)?.label} (${prevRange.label})` : null,
        generatedAt: new Date(),
        includesBots: includeBots,
        kpis: [
          kpi('Page views', fmtNumber(o.page_views), `${fmtNumber(avgPerDay, 1)} per day on average`, o.page_views, cmp((c) => c.page_views)),
          kpi('Visitors', fmtNumber(o.visitors), 'Unique visitors', o.visitors, cmp((c) => c.visitors)),
          kpi('Sessions', fmtNumber(o.sessions), `${pps === null ? '–' : fmtNumber(pps, 2)} pages per session`, o.sessions, cmp((c) => c.sessions)),
          kpi('Engagement', engRate === null ? '–' : fmtPct(engRate), engRate === null ? needsV3 : `Bounce rate ${fmtPct(bounceRate(o))}`, engRate, cmp(engagementRate)),
        ],
        trend: daySeries.map((b) => ({ label: b.label, count: b.views })),
        pages: breakdowns.pages,
        entries: breakdowns.entries,
        exits: breakdowns.exits,
        referrers: breakdowns.referrers,
        countries: breakdowns.countries,
        devices: breakdowns.devices,
        browsers: breakdowns.browsers,
        eventTypes: breakdowns.events,
        posts: postPerformance.map((row) => ({ title: row.post.title, path: row.path, views: row.views })),
      });
      const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
      doc.save(`analytics-${slug}-${range.startKey}_to_${range.endKey}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Topbar title="Analytics" subtitle={`${clientName} · Traffic and CMS performance`} />
      <div className="page-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {RANGE_PRESETS.map((r) => (
              <button key={r.id} onClick={() => choosePreset(r.id)} style={{
                padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: preset === r.id ? 'var(--ne-blue)' : 'var(--surface)',
                color: preset === r.id ? '#fff' : 'var(--fg2)',
                boxShadow: 'var(--shadow-sm)',
              }}>
                {r.label}
              </button>
            ))}
            {preset === 'custom' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--fg2)' }}>
                <input type="date" aria-label="From date" value={customFrom} max={customTo || undefined} onChange={(e) => { setGranularityChoice(null); setCustomFrom(e.target.value); }} style={selectStyle} />
                to
                <input type="date" aria-label="To date" value={customTo} min={customFrom || undefined} onChange={(e) => { setGranularityChoice(null); setCustomTo(e.target.value); }} style={selectStyle} />
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {loading && (
              <span style={{ fontSize: 12, color: 'var(--fg3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> Loading…
              </span>
            )}
            <select aria-label="Compare with" value={compare} onChange={(e) => setCompare(e.target.value as CompareMode)} style={selectStyle}>
              {COMPARE_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <label style={{ fontSize: 12.5, color: 'var(--fg2)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeBots} onChange={(e) => setIncludeBots(e.target.checked)} />
              Include bot traffic
            </label>
            <button
              onClick={exportPdf}
              disabled={loading || exporting}
              style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: loading || exporting ? 'default' : 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg1)', display: 'flex', alignItems: 'center', gap: 6, opacity: loading || exporting ? 0.6 : 1 }}
            >
              {exporting ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Download size={14} />}
              Export PDF
            </button>
          </div>
        </div>

        {loadError && (
          <div role="alert" style={{ marginBottom: 20, background: 'var(--ne-danger-bg, #fef2f2)', border: '1px solid var(--ne-danger, #dc2626)', borderRadius: 'var(--r-md)', padding: '12px 18px', fontSize: 12.5, color: 'var(--fg1)' }}>
            Some analytics data failed to load, so the numbers below may be incomplete: {loadError}
          </div>
        )}

        <div style={{ marginBottom: 16, background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 'var(--r-md)', padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <BarChart2 size={17} color="var(--ne-blue)" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: 12.5, color: 'var(--fg2)', margin: 0 }}>
            Showing {range.label} ({range.days} {range.days === 1 ? 'day' : 'days'}, {tzLabel})
            {prevRange && <> compared with {prevRange.label}</>} — first-party data collected through the NE Website Manager analytics endpoint.
            {includeBots ? ' Bot traffic is included.' : ' Bot and crawler traffic is excluded.'}
          </p>
        </div>

        {selectedClientId && legacyOnly && (
          <div role="status" style={{ marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--ne-warning, #d97706)', borderRadius: 'var(--r-md)', padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <AlertTriangle size={17} color="var(--ne-warning, #d97706)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: 'var(--fg2)' }}>
              <b style={{ color: 'var(--fg1)' }}>This site runs an older tracker{o.tracker_version ? ` (v${o.tracker_version})` : ' (v1/v2)'}; the current one is v{CURRENT_TRACKER_VERSION}.</b>{' '}
              Page views, visitors and referrers below are accurate, but engaged time, engagement and bounce rate, and new vs returning visitors are not collected yet.{' '}
              <Link href="/settings" style={{ color: 'var(--ne-blue)', fontWeight: 600 }}>Re-push the integration with SDK v3</Link> and merge the PR to unlock them.
            </div>
          </div>
        )}
        {selectedClientId && !legacyOnly && o.tracker_version !== null && (
          <div style={{ marginBottom: 20, fontSize: 12, color: 'var(--fg3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={14} color="var(--ne-success)" /> Tracker v{o.tracker_version} — up to date.
          </div>
        )}

        <div className="grid-stats">
          <StatCard label="Page Views" value={fmtNumber(o.page_views)} sub={`${fmtNumber(avgPerDay, 1)} per day on average`} icon={Eye} color="var(--ne-blue)" current={o.page_views} previous={cmp((c) => c.page_views)} />
          <StatCard label="Visitors" value={fmtNumber(o.visitors)} sub={o.visitors === 0 ? 'Install tracker to begin' : 'Unique visitors'} icon={Users} color="var(--ne-success)" current={o.visitors} previous={cmp((c) => c.visitors)} />
          <StatCard label="Sessions" value={fmtNumber(o.sessions)} sub="Browser sessions in this period" icon={Activity} color="#6366f1" current={o.sessions} previous={cmp((c) => c.sessions)} />
          <StatCard label="Custom Events" value={fmtNumber(o.custom_events)} sub={`${o.event_types} event types in this period`} icon={MousePointerClick} color="var(--ne-warning)" current={o.custom_events} previous={cmp((c) => c.custom_events)} />
        </div>

        <div className="grid-stats">
          <StatCard
            label="Engagement Rate" value={engRate === null ? '–' : fmtPct(engRate)}
            sub={engRate === null ? needsV3 : `Bounce rate ${fmtPct(bounceRate(o))}${measuredNote}`}
            icon={Sparkles} color="#0ea5e9" current={engRate} previous={engRate === null ? undefined : cmp(engagementRate)}
            help={`Engaged session: ≥${ENGAGED_MIN_MS / 1000}s engaged time, ≥${ENGAGED_MIN_PAGE_VIEWS} page views, or a conversion. Bounce rate = 1 − engagement rate (GA4 definition).`}
          />
          <StatCard
            label="Avg. Engaged Time" value={fmtDuration(avgEngaged)}
            sub={avgEngaged === null ? needsV3 : 'Per session, visible and active'}
            icon={Clock} color="#14b8a6" current={avgEngaged} previous={avgEngaged === null ? undefined : cmp(avgEngagedMs)}
            help="Time the page was visible with scroll, pointer, key or touch activity in the last 10 seconds."
          />
          <StatCard
            label="Pages / Session" value={pps === null ? '–' : fmtNumber(pps, 2)} sub="Page views per session"
            icon={Layers} color="#8b5cf6" current={pps} previous={cmp(pagesPerSession)}
          />
          <StatCard
            label="New Visitors" value={newShare === null ? '–' : fmtPct(newShare, 0)}
            sub={newShare === null ? needsV3 : `${fmtNumber(o.new_visitors)} new · ${fmtNumber(returningVisitors(o))} returning`}
            icon={UserPlus} color="#f43f5e" current={newShare} previous={newShare === null ? undefined : cmp(newVisitorShare)}
            help="A new visitor's browser ID was created during a session in this period."
          />
        </div>

        <Card style={{ marginBottom: 24 }}>
          <CardHead
            title="Trend"
            hint={range.days > 1 ? 'Hover for exact values · click a bar to drill into it' : 'Hover for exact values'}
            action={(
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {seriesLoading && <Loader2 size={14} style={{ animation: 'spin .6s linear infinite', color: 'var(--fg3)' }} />}
                <Segmented label="Metric" value={metric} options={TREND_METRICS} onChange={setMetric} />
                <select aria-label="Granularity" value={granularity} onChange={(e) => setGranularityChoice(e.target.value as Granularity)} style={selectStyle}>
                  {granularities.map((g) => <option key={g} value={g}>{GRANULARITY_LABELS[g]}</option>)}
                </select>
              </div>
            )}
          />
          <div style={{ padding: '16px 20px 12px' }}>
            {o.page_views === 0 && !loading ? (
              <div style={{ color: 'var(--fg3)', fontSize: 13, padding: '48px 0', textAlign: 'center' }}>No page views recorded in this period. Add the generated analytics helper to the client website.</div>
            ) : (
              <>
                <TrendChart points={series} previous={prevSeries} metric={metric} onSelect={drillInto} canDrill={canDrill} />
                {prevSeries && (
                  <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--fg2)', marginTop: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--ne-blue)' }} />{range.label}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, borderTop: '2px dashed var(--fg3)' }} />{prevRange?.label}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Top Pages" hint="Page views" />
            <div style={{ padding: 20 }}><BarList rows={breakdowns.pages} total={o.page_views} /></div>
          </Card>
          <Card>
            <CardHead title="Referrers" hint="Sessions by where they came from · your own site counts as Direct" />
            <div style={{ padding: 20 }}><BarList rows={breakdowns.referrers} total={o.sessions} /></div>
          </Card>
          <Card>
            <CardHead title="Entry Pages" hint="First page of each session" />
            <div style={{ padding: 20 }}><BarList rows={breakdowns.entries} total={o.sessions} /></div>
          </Card>
          <Card>
            <CardHead title="Exit Pages" hint="Last page of each session" />
            <div style={{ padding: 20 }}><BarList rows={breakdowns.exits} total={o.sessions} /></div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Devices" hint="Page views" />
            <div style={{ padding: 20 }}><BarList rows={breakdowns.devices} total={o.page_views} /></div>
          </Card>
          <Card>
            <CardHead title="Browsers" hint="Page views" />
            <div style={{ padding: 20 }}><BarList rows={breakdowns.browsers} total={o.page_views} /></div>
          </Card>
          <Card>
            <CardHead title="Countries" hint="Page views" />
            <div style={{ padding: 20 }}><BarList rows={breakdowns.countries} total={o.page_views} /></div>
          </Card>
          <Card>
            <CardHead title="Event Types" hint="Engagement pings excluded" />
            <div style={{ padding: 20 }}><BarList rows={breakdowns.events} total={totalEvents} /></div>
          </Card>
        </div>

        <Card style={{ marginBottom: 24 }}>
          <CardHead title="When Visitors Come" hint="Page views by weekday and hour" />
          <div style={{ padding: 20, overflowX: 'auto' }}><div style={{ minWidth: 520 }}><HourlyHeatmap cells={hourly} tzLabel={tzLabel} /></div></div>
        </Card>

        <Card style={{ marginBottom: 24 }}>
          <CardHead title="Top Posts" action={<span style={{ fontSize: 12, color: 'var(--fg3)' }}>By views · {range.label}</span>} />
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Post</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th>Views</th>
                </tr>
              </thead>
              <tbody>
                {postPerformance.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 34, color: 'var(--fg3)' }}>No posts with a computable path yet.</td></tr>
                ) : postPerformance.map((row) => (
                  <tr key={row.post.id}>
                    <td style={{ paddingLeft: 20, fontWeight: 600, color: 'var(--fg1)' }}>{row.post.title}</td>
                    <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{row.path}</td>
                    <td><span className={`status-pill ${row.post.status}`}>{row.post.status}</span></td>
                    <td style={{ fontWeight: 700, color: 'var(--fg1)' }}>{row.views.toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 20, marginBottom: 24 }}>
          <Card>
            <CardHead title="Recent Events" />
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20 }}>Event</th>
                    <th>Path</th>
                    <th>Device</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: 34, color: 'var(--fg3)' }}><Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /></td></tr>
                  ) : recent.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: 34, color: 'var(--fg3)' }}>No analytics events in this period.</td></tr>
                  ) : recent.map((event) => (
                    <tr key={event.id}>
                      <td style={{ paddingLeft: 20, fontWeight: 600 }}>{event.event_name}</td>
                      <td style={{ maxWidth: 260 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg1)' }}>{event.path}</div>
                        <div style={{ color: 'var(--fg3)', fontSize: 11.5 }}>{host(event.referrer)}</div>
                      </td>
                      <td style={{ color: 'var(--fg3)', fontSize: 12 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MonitorSmartphone size={13} />{event.device ?? 'unknown'}</span>
                      </td>
                      <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{fmtDateTime(event.created_at, tz)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHead title="CMS Health" action={<Link href="/cms/posts" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>Manage posts</Link>} />
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <MiniMetric label="Published Posts" value={String(publishedPosts.length)} sub={`${posts.length} total posts`} />
              <MiniMetric label="Public Pages" value={String(publicPages.length)} sub={`${pages.length} managed pages`} />
              <MiniMetric label="Last CMS Update" value={freshness === null ? '-' : `${freshness}d`} sub={fmtDate(lastUpdated)} />
              <MiniMetric label="Managed Pages" value={String(pages.length)} sub="Published and draft" />
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 20 }}>
          <Card>
            <CardHead title="Integration Snippet" action={<Link href="/settings" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>Open integration settings</Link>} />
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 12.5, color: 'var(--fg3)', margin: '0 0 12px' }}>
                Push the SDK v3 integration (Settings → Integration), then call <code>installAnalytics()</code> once from a client component in the root layout.
              </p>
              <pre style={{ margin: 0, padding: '14px 16px', background: 'var(--ne-ink)', borderRadius: 6, fontSize: 12, lineHeight: 1.7, color: '#e2e8f0', overflowX: 'auto' }}>{`'use client';
import { useEffect } from 'react';
import { installAnalytics, trackEvent } from '@/lib/cms';

export function Analytics() {
  useEffect(() => { installAnalytics(); }, []);
  return null;
}

// anywhere else:
trackEvent('contact_click', { location: 'footer' });`}</pre>
            </div>
          </Card>

          <Card>
            <CardHead title="Privacy & Data Collected" />
            <div style={{ padding: 20, fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.65 }}>
              <p style={{ margin: '0 0 10px' }}>
                The tracker is first-party and cookieless. It stores a random visitor ID in the browser&apos;s local storage and a session ID in session storage — no fingerprinting, and IP addresses are never stored (only the country the edge network reports).
              </p>
              <p style={{ margin: '0 0 10px' }}>
                Collected per event: page path and title, referring site (no query string), device type, browser, country, screen width, browser language, engaged time and scroll depth. Bot traffic is flagged and excluded by default.
              </p>
              <p style={{ margin: 0 }}>
                Visitors can opt out with <code>disableAnalytics()</code> (or <code>localStorage.ne_optout = &apos;1&apos;</code>); sites can honour Do Not Track with <code>installAnalytics({'{'} respectDNT: true {'}'})</code> or gate tracking on consent with <code>{'{'} consent: () =&gt; boolean {'}'}</code>.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
