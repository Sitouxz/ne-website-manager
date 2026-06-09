'use client';

import Topbar from '@/components/Topbar';
import { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, RadialBarChart, RadialBar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Users, Eye, MousePointer, Clock,
  Globe, Smartphone, Monitor, Tablet, ArrowUpRight,
  Download, RefreshCw, Search, FileText, Zap, ExternalLink,
} from 'lucide-react';

// --- MOCK DATA ---

const generateDailyData = (days: number) => {
  const now = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const label = d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
    const base = 220 + Math.sin(i / 3) * 60 + Math.random() * 80;
    const sessions = Math.round(base);
    const pageviews = Math.round(sessions * (2.4 + Math.random() * 0.8));
    const users = Math.round(sessions * (0.68 + Math.random() * 0.12));
    return { date: label, sessions, pageviews, users, newUsers: Math.round(users * 0.62) };
  });
};

const DATA_30 = generateDailyData(30);
const DATA_7  = DATA_30.slice(-7);
const DATA_90 = (() => {
  const out = [];
  for (let w = 12; w >= 0; w--) {
    const d = new Date();
    d.setDate(d.getDate() - w * 7);
    const wk = `Wk ${d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`;
    const s = Math.round(1400 + Math.sin(w / 2) * 400 + Math.random() * 500);
    out.push({ date: wk, sessions: s, pageviews: Math.round(s * 2.5), users: Math.round(s * 0.7), newUsers: Math.round(s * 0.44) });
  }
  return out;
})();

const SOURCES = [
  { name: 'Organic Search', value: 41, sessions: 3453, color: '#1D4ED8' },
  { name: 'Direct',         value: 27, sessions: 2274, color: '#3B82F6' },
  { name: 'Social Media',   value: 18, sessions: 1516, color: '#60A5FA' },
  { name: 'Referral',       value: 9,  sessions: 758,  color: '#93C5FD' },
  { name: 'Email',          value: 5,  sessions: 421,  color: '#BFDBFE' },
];

const DEVICES = [
  { name: 'Mobile',  value: 58, color: '#1D4ED8' },
  { name: 'Desktop', value: 34, color: '#60A5FA' },
  { name: 'Tablet',  value: 8,  color: '#BFDBFE' },
];

const BROWSERS = [
  { name: 'Chrome',  value: 52 },
  { name: 'Safari',  value: 29 },
  { name: 'Firefox', value: 10 },
  { name: 'Edge',    value: 6  },
  { name: 'Other',   value: 3  },
];

const TOP_PAGES = [
  { page: '/', title: 'Home', views: 6841, uniq: 4203, avgTime: '2m 14s', bounce: '38%', entries: 3420 },
  { page: '/about', title: 'About Al-Islah', views: 3214, uniq: 2187, avgTime: '3m 02s', bounce: '41%', entries: 891 },
  { page: '/services/wedding', title: 'Wedding (Nikah)', views: 2876, uniq: 2341, avgTime: '4m 18s', bounce: '29%', entries: 1240 },
  { page: '/donations', title: 'Donations & Infaq', views: 2541, uniq: 1987, avgTime: '2m 47s', bounce: '35%', entries: 722 },
  { page: '/contact', title: 'Contact Us', views: 2103, uniq: 1654, avgTime: '1m 33s', bounce: '52%', entries: 601 },
  { page: '/volunteer/be-a-volunteer', title: 'Be a Volunteer', views: 1892, uniq: 1521, avgTime: '3m 51s', bounce: '31%', entries: 487 },
  { page: '/privacy', title: 'Privacy Policy', views: 412, uniq: 378, avgTime: '1m 02s', bounce: '74%', entries: 88 },
];

const BLOG_POSTS = [
  { title: 'Sifat Sombong Pemusnah Segalanya', views: 3241, reads: 1842, avgTime: '5m 12s', engagement: 89, growth: 24 },
  { title: 'Configuring my Tahajjud', views: 2876, reads: 2104, avgTime: '7m 44s', engagement: 94, growth: 31 },
  { title: 'DO NOT LOSE HOPE IN ALLAH SWT', views: 2103, reads: 1432, avgTime: '4m 31s', engagement: 82, growth: 12 },
  { title: 'Ayat al-Quran Yang Buat Nabi Menangis', views: 1654, reads: 987, avgTime: '6m 02s', engagement: 77, growth: 8 },
  { title: 'The Spirit of Community in Islam', views: 987, reads: 612, avgTime: '3m 18s', engagement: 71, growth: -3 },
  { title: 'Sampaikan Dengan Hikmah', views: 543, reads: 221, avgTime: '2m 54s', engagement: 58, growth: 0 },
];

const GEO = [
  { country: 'Singapore',     flag: 'SG', visitors: 4842, pct: 58.3 },
  { country: 'Malaysia',      flag: 'MY', visitors: 1621, pct: 19.5 },
  { country: 'Indonesia',     flag: 'ID', visitors: 812,  pct: 9.8  },
  { country: 'Brunei',        flag: 'BN', visitors: 341,  pct: 4.1  },
  { country: 'Australia',     flag: 'AU', visitors: 198,  pct: 2.4  },
  { country: 'United Kingdom',flag: 'GB', visitors: 143,  pct: 1.7  },
  { country: 'United States', flag: 'US', visitors: 89,   pct: 1.1  },
  { country: 'Others',        flag: '..', visitors: 254,  pct: 3.1  },
];

const HOURLY = Array.from({ length: 24 }, (_, h) => {
  const peak = h >= 8 && h <= 22;
  const lunch = h >= 12 && h <= 14;
  const evening = h >= 19 && h <= 22;
  let base = peak ? 180 + Math.random() * 120 : 20 + Math.random() * 40;
  if (lunch) base += 80;
  if (evening) base += 120;
  return {
    hour: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`,
    visitors: Math.round(base),
  };
});

const SEARCH_QUERIES = [
  { query: 'al-islah mosque singapore',  clicks: 1243, impressions: 4821, ctr: '25.8%', pos: '1.2' },
  { query: 'nikah singapore mosque',     clicks: 876,  impressions: 5102, ctr: '17.2%', pos: '3.4' },
  { query: 'mosque near sengkang',       clicks: 654,  impressions: 3201, ctr: '20.4%', pos: '2.1' },
  { query: 'volunteer mosque singapore', clicks: 421,  impressions: 2876, ctr: '14.6%', pos: '4.7' },
  { query: 'donate to mosque singapore', clicks: 398,  impressions: 2143, ctr: '18.6%', pos: '3.8' },
  { query: 'al-islah prayer times',      clicks: 287,  impressions: 1654, ctr: '17.4%', pos: '2.9' },
  { query: 'islamic courses singapore',  clicks: 241,  impressions: 3421, ctr: '7.0%',  pos: '8.1' },
  { query: 'adil programme islah',       clicks: 198,  impressions: 876,  ctr: '22.6%', pos: '1.8' },
];

const EVENTS = [
  { name: 'Contact Form Submit',      count: 142,  rate: '1.7%' },
  { name: 'Donation Button Click',    count: 521,  rate: '6.2%' },
  { name: 'Volunteer Form Start',     count: 89,   rate: '1.1%' },
  { name: 'Prayer Time Widget View',  count: 3241, rate: '38.5%' },
  { name: 'Social Share',             count: 67,   rate: '0.8%' },
  { name: 'PDF Download',             count: 34,   rate: '0.4%' },
];

const RANGE_DATA: Record<string, typeof DATA_30> = { '7D': DATA_7, '30D': DATA_30, '90D': DATA_90 };

const KPI_SETS: Record<string, {
  sessions: number; users: number; pageviews: number;
  bounce: number; duration: string; pps: number;
  sDelta: number; uDelta: number; pvDelta: number; bDelta: number;
}> = {
  '7D':  { sessions: 2041,  users: 1387,  pageviews: 5621,  bounce: 39.2, duration: '3m 31s', pps: 2.76, sDelta: 8.3,  uDelta: 6.1,  pvDelta: 11.2, bDelta: -2.1 },
  '30D': { sessions: 8421,  users: 5847,  pageviews: 23156, bounce: 42.3, duration: '3m 24s', pps: 2.75, sDelta: 12.3, uDelta: 8.7,  pvDelta: 15.2, bDelta: -3.1 },
  '90D': { sessions: 24103, users: 16821, pageviews: 68412, bounce: 44.1, duration: '3m 11s', pps: 2.84, sDelta: 19.4, uDelta: 14.2, pvDelta: 22.1, bDelta: -1.8 },
};

// --- HELPERS ---

const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toString();

function Delta({ v, inverse = false }: { v: number; inverse?: boolean }) {
  const good = inverse ? v < 0 : v >= 0;
  const abs = Math.abs(v).toFixed(1);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 600, color: good ? 'var(--ne-success)' : 'var(--ne-danger)' }}>
      {good ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {abs}%
    </span>
  );
}

function KpiCard({ label, value, delta, icon: Icon, iconColor, sub, inverse = false }: {
  label: string; value: string; delta: number; icon: React.ElementType;
  iconColor: string; sub?: string; inverse?: boolean;
}) {
  return (
    <div className="stat-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: iconColor + '18', display: 'grid', placeItems: 'center', color: iconColor }}>
          <Icon size={18} />
        </div>
        <Delta v={delta} inverse={inverse} />
      </div>
      <div className="num">{value}</div>
      <div className="lbl">{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const TT_STYLE = {
  background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 12, color: 'var(--fg1)', boxShadow: '0 4px 12px rgba(0,0,0,.08)',
};

function ChartTip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TT_STYLE}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{label}</div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {payload.map((p) => (
          <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
            <span style={{ color: 'var(--fg2)' }}>{p.name}:</span>
            <span style={{ fontWeight: 700 }}>{p.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

function CardHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>{title}</div>
      {action}
    </div>
  );
}

// --- PAGE ---

export default function AnalyticsPage() {
  const [range, setRange] = useState<'7D' | '30D' | '90D'>('30D');
  const [metric, setMetric] = useState<'sessions' | 'pageviews' | 'users'>('sessions');

  const chartData = RANGE_DATA[range];
  const kpi = KPI_SETS[range];
  const engRate = (100 - kpi.bounce).toFixed(1);

  return (
    <>
      <Topbar title="Analytics" subtitle="Al-Islah Mosque · Website Performance" />
      <div className="page-body" style={{ maxWidth: 1400 }}>

        {/* -- Controls -- */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['7D', '30D', '90D'] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)} style={{
                padding: '6px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: range === r ? 'var(--ne-blue)' : 'var(--surface)',
                color: range === r ? '#fff' : 'var(--fg2)',
                boxShadow: 'var(--shadow-sm)',
              }}>
                {r === '7D' ? 'Last 7 days' : r === '30D' ? 'Last 30 days' : 'Last 90 days'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ne-success)', fontWeight: 600 }}>
              <Zap size={12} fill="var(--ne-success)" />
              <span>Live</span>
              <span style={{ fontSize: 11, color: 'var(--fg3)', fontWeight: 400 }}>· Updated 2m ago</span>
            </div>
            <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', cursor: 'pointer' }}>
              <RefreshCw size={12} /> Refresh
            </button>
            <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', cursor: 'pointer' }}>
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>

        {/* -- KPI Row -- */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 24 }}>
          <KpiCard label="Sessions"        value={fmt(kpi.sessions)}  delta={kpi.sDelta}  icon={MousePointer} iconColor="var(--ne-blue)"   sub="vs prev period" />
          <KpiCard label="Unique Visitors" value={fmt(kpi.users)}     delta={kpi.uDelta}  icon={Users}        iconColor="#6366f1"           sub="vs prev period" />
          <KpiCard label="Page Views"      value={fmt(kpi.pageviews)} delta={kpi.pvDelta} icon={Eye}          iconColor="var(--ne-success)" sub="vs prev period" />
          <KpiCard label="Bounce Rate"     value={kpi.bounce + '%'}   delta={kpi.bDelta}  icon={TrendingDown} iconColor="var(--ne-warning)" sub="vs prev period" inverse />
          <KpiCard label="Avg Session"     value={kpi.duration}       delta={5.2}         icon={Clock}        iconColor="#8B5CF6"           sub="time on site" />
          <KpiCard label="Pages / Session" value={kpi.pps.toFixed(2)} delta={3.8}         icon={FileText}     iconColor="#0EA5E9"           sub="depth" />
        </div>

        {/* -- Traffic Overview -- */}
        <Card style={{ marginBottom: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg1)' }}>Traffic Overview</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['sessions', 'pageviews', 'users'] as const).map((m) => (
                <button key={m} onClick={() => setMetric(m)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: metric === m ? 'var(--ne-blue-muted)' : 'transparent',
                  color: metric === m ? 'var(--ne-blue)' : 'var(--fg3)',
                }}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: '20px 20px 10px' }}>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="gMetric" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#1D4ED8" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1D4ED8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--fg3)' }} axisLine={false} tickLine={false}
                  interval={range === '7D' ? 0 : range === '30D' ? 4 : 1} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--fg3)' }} axisLine={false} tickLine={false} width={50}
                  tickFormatter={fmt} />
                <Tooltip content={<ChartTip />} />
                <Area type="monotone" dataKey={metric} stroke="#1D4ED8" strokeWidth={2.5}
                  fill="url(#gMetric)" dot={false} activeDot={{ r: 4, fill: '#1D4ED8' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* -- Sources + Devices -- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

          {/* Traffic Sources */}
          <Card>
            <CardHead title="Traffic Sources" />
            <div style={{ padding: 20, display: 'flex', gap: 24, alignItems: 'center' }}>
              <div style={{ flexShrink: 0 }}>
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={SOURCES} cx="50%" cy="50%" innerRadius={48} outerRadius={72}
                      paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
                      {SOURCES.map((s) => <Cell key={s.name} fill={s.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `${v}%`} contentStyle={TT_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1 }}>
                {SOURCES.map((s) => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg1)' }}>{s.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--fg3)', fontWeight: 500 }}>{s.value}%</span>
                      </div>
                      <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 99 }}>
                        <div style={{ height: '100%', width: s.value + '%', background: s.color, borderRadius: 99 }} />
                      </div>
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--fg3)', width: 52, textAlign: 'right' }}>
                      {s.sessions.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Devices + Browsers */}
          <Card>
            <CardHead title="Devices & Browsers" />
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={DEVICES} cx="50%" cy="50%" innerRadius={36} outerRadius={54}
                      paddingAngle={3} dataKey="value" startAngle={90} endAngle={-270}>
                      {DEVICES.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `${v}%`} contentStyle={TT_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  {DEVICES.map((d) => {
                    const Icon = d.name === 'Mobile' ? Smartphone : d.name === 'Desktop' ? Monitor : Tablet;
                    return (
                      <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: d.color + '18', display: 'grid', placeItems: 'center', color: d.color }}>
                          <Icon size={13} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg1)' }}>{d.name}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg2)' }}>{d.value}%</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 99 }}>
                            <div style={{ height: '100%', width: d.value + '%', background: d.color, borderRadius: 99 }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {BROWSERS.map((b, i) => (
                  <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 56, fontSize: 12, color: 'var(--fg2)', fontWeight: 500 }}>{b.name}</div>
                    <div style={{ flex: 1, height: 6, background: 'var(--surface-3)', borderRadius: 99 }}>
                      <div style={{ height: '100%', width: b.value + '%', background: `hsl(${220 - i * 15}, 80%, ${45 + i * 8}%)`, borderRadius: 99 }} />
                    </div>
                    <div style={{ width: 34, fontSize: 12, fontWeight: 700, color: 'var(--fg2)', textAlign: 'right' }}>{b.value}%</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* -- Top Pages -- */}
        <Card style={{ marginBottom: 24 }}>
          <CardHead title="Top Pages" action={
            <span style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, cursor: 'pointer' }}>View full report</span>
          } />
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Page</th>
                <th>Views</th>
                <th>Unique Views</th>
                <th>Avg Time</th>
                <th>Bounce Rate</th>
                <th>Entries</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {TOP_PAGES.map((p) => (
                <tr key={p.page}>
                  <td style={{ paddingLeft: 20 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg1)' }}>{p.title}</div>
                    <code style={{ fontSize: 11, color: 'var(--fg3)' }}>{p.page}</code>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.views.toLocaleString()}</div>
                    <div style={{ height: 3, width: Math.round((p.views / 7000) * 80) + 'px', background: 'var(--ne-blue)', borderRadius: 99, marginTop: 4 }} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{p.uniq.toLocaleString()}</td>
                  <td style={{ color: 'var(--fg2)' }}>{p.avgTime}</td>
                  <td>
                    <span style={{
                      fontSize: 12, fontWeight: 600,
                      color: parseFloat(p.bounce) > 60 ? 'var(--ne-danger)' : parseFloat(p.bounce) > 45 ? 'var(--ne-warning)' : 'var(--ne-success)',
                    }}>{p.bounce}</span>
                  </td>
                  <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{p.entries.toLocaleString()}</td>
                  <td>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4 }}>
                      <ExternalLink size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* -- Blog + Geo -- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

          {/* Blog Performance */}
          <Card>
            <CardHead title="Blog Post Performance" action={
              <a href="/cms/posts" style={{ fontSize: 12, color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>Manage posts</a>
            } />
            <div>
              {BLOG_POSTS.map((p, i) => (
                <div key={p.title} style={{
                  padding: '13px 20px',
                  borderBottom: i < BLOG_POSTS.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--fg3)', width: 18 }}>#{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                      {p.title}
                    </div>
                    <div style={{ display: 'flex', gap: 14 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>
                        <b style={{ color: 'var(--fg2)' }}>{p.views.toLocaleString()}</b> views
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>
                        <b style={{ color: 'var(--fg2)' }}>{p.reads.toLocaleString()}</b> reads
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>{p.avgTime}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: p.growth > 0 ? 'var(--ne-success)' : p.growth < 0 ? 'var(--ne-danger)' : 'var(--fg3)' }}>
                      {p.growth > 0 ? '+' : ''}{p.growth}%
                    </div>
                    <div style={{ marginTop: 4, width: 60, height: 4, background: 'var(--surface-3)', borderRadius: 99 }}>
                      <div style={{ height: '100%', width: p.engagement + '%', background: 'var(--ne-blue)', borderRadius: 99 }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Geographic */}
          <Card>
            <CardHead title="Geographic Breakdown" action={
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--fg3)' }}>
                <Globe size={12} /> {GEO.length - 1} countries
              </span>
            } />
            <div>
              {GEO.map((g, i) => (
                <div key={g.country} style={{
                  padding: '11px 20px',
                  borderBottom: i < GEO.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{
                    width: 28, height: 20, borderRadius: 3, background: 'var(--surface-3)',
                    display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700,
                    color: 'var(--fg3)', letterSpacing: '.05em', flexShrink: 0,
                  }}>{g.flag}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg1)' }}>{g.country}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg2)' }}>{g.pct}%</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 99 }}>
                      <div style={{
                        height: '100%', width: g.pct + '%',
                        background: i === 0 ? 'var(--ne-blue)' : `rgba(29,78,216,${Math.max(0.15, 1 - i * 0.13)})`,
                        borderRadius: 99, maxWidth: '100%',
                      }} />
                    </div>
                  </div>
                  <span style={{ width: 52, fontSize: 12, color: 'var(--fg3)', textAlign: 'right' }}>
                    {g.visitors.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* -- Hourly + Events -- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

          {/* Hourly bar */}
          <Card>
            <CardHead title="Traffic by Hour (SGT)" action={
              <span style={{ fontSize: 11, color: 'var(--fg3)' }}>30-day avg</span>
            } />
            <div style={{ padding: '16px 20px 10px' }}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={HOURLY} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'var(--fg3)' }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--fg3)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TT_STYLE} cursor={{ fill: 'var(--ne-blue-bg)' }} />
                  <Bar dataKey="visitors" radius={[3, 3, 0, 0]} name="Visitors">
                    {HOURLY.map((h, i) => (
                      <Cell key={i} fill={h.visitors > 250 ? '#1D4ED8' : h.visitors > 150 ? '#60A5FA' : '#BFDBFE'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                {[['#1D4ED8', 'High (250+)'], ['#60A5FA', 'Medium'], ['#BFDBFE', 'Low']].map(([c, l]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--fg3)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{l}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Events */}
          <Card>
            <CardHead title="Events & Conversions" action={
              <span style={{ fontSize: 11, color: 'var(--fg3)' }}>vs {kpi.sessions.toLocaleString()} sessions</span>
            } />
            <div>
              {EVENTS.map((e, i) => (
                <div key={e.name} style={{
                  padding: '12px 20px',
                  borderBottom: i < EVENTS.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg1)', marginBottom: 4 }}>{e.name}</div>
                    <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 99 }}>
                      <div style={{ height: '100%', width: Math.min(parseFloat(e.rate) * 3, 100) + '%', background: 'var(--ne-blue)', borderRadius: 99 }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg1)' }}>{e.count.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg3)' }}>{e.rate} conv.</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* -- Search Performance -- */}
        <Card style={{ marginBottom: 24 }}>
          <CardHead title="Search Performance (SEO)" action={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg3)' }}>
              <Search size={12} /> Google Search Console
            </div>
          } />
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Query</th>
                <th>Clicks</th>
                <th>Impressions</th>
                <th>CTR</th>
                <th>Avg Position</th>
                <th style={{ paddingRight: 20 }}>Sparkline</th>
              </tr>
            </thead>
            <tbody>
              {SEARCH_QUERIES.map((q) => (
                <tr key={q.query}>
                  <td style={{ paddingLeft: 20 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg1)', fontFamily: 'monospace' }}>
                      &ldquo;{q.query}&rdquo;
                    </div>
                  </td>
                  <td style={{ fontWeight: 700 }}>{q.clicks.toLocaleString()}</td>
                  <td style={{ color: 'var(--fg2)' }}>{q.impressions.toLocaleString()}</td>
                  <td>
                    <span style={{ fontWeight: 600, color: parseFloat(q.ctr) > 20 ? 'var(--ne-success)' : parseFloat(q.ctr) > 12 ? 'var(--ne-warning)' : 'var(--ne-danger)' }}>
                      {q.ctr}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: parseFloat(q.pos) <= 3 ? 'var(--ne-success)' : parseFloat(q.pos) <= 5 ? 'var(--ne-warning)' : 'var(--ne-danger)' }}>
                      #{q.pos}
                    </span>
                  </td>
                  <td style={{ paddingRight: 20 }}>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                      {Array.from({ length: 7 }, (_, i) => {
                        const h = 4 + Math.round(Math.abs(Math.sin((i + q.clicks) * 0.7)) * 16);
                        return <div key={i} style={{ width: 5, height: h, background: 'var(--ne-blue)', borderRadius: 1, opacity: 0.4 + i * 0.1 }} />;
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* -- Session Quality row -- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>

          {/* Engagement ring */}
          <Card>
            <CardHead title="Engagement Rate" />
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <ResponsiveContainer width={160} height={160}>
                <RadialBarChart cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                  data={[
                    { name: 'Engaged', value: parseFloat(engRate), fill: '#1D4ED8' },
                    { name: 'Bounced', value: kpi.bounce,          fill: 'var(--surface-3)' },
                  ]}
                  startAngle={90} endAngle={-270}>
                  <RadialBar dataKey="value" cornerRadius={4} background={{ fill: 'var(--surface-2)' }} />
                  <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle"
                    style={{ fontSize: 22, fontWeight: 800, fill: 'var(--ne-ink)' }}>
                    {engRate}%
                  </text>
                  <text x="50%" y="63%" textAnchor="middle" dominantBaseline="middle"
                    style={{ fontSize: 10, fill: 'var(--fg3)' }}>
                    engaged
                  </text>
                </RadialBarChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 8, display: 'flex', gap: 24 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--fg1)' }}>{engRate}%</div>
                  <div style={{ fontSize: 10, color: 'var(--fg3)' }}>Engaged</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--fg1)' }}>{kpi.bounce}%</div>
                  <div style={{ fontSize: 10, color: 'var(--fg3)' }}>Bounced</div>
                </div>
              </div>
            </div>
          </Card>

          {/* Session depth */}
          <Card>
            <CardHead title="Session Depth" />
            <div style={{ padding: '16px 20px 10px' }}>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={[
                  { pages: '1 page',  pct: 42 },
                  { pages: '2 pages', pct: 21 },
                  { pages: '3 pages', pct: 14 },
                  { pages: '4 pages', pct: 10 },
                  { pages: '5+',      pct: 13 },
                ]} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="pages" tick={{ fontSize: 10, fill: 'var(--fg3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--fg3)' }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip contentStyle={TT_STYLE} />
                  <Bar dataKey="pct" fill="#1D4ED8" radius={[4, 4, 0, 0]} name="Sessions %" />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 10, padding: '10px 0', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg1)' }}>{kpi.pps.toFixed(2)}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg3)' }}>Avg pages</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg1)' }}>13%</div>
                  <div style={{ fontSize: 10, color: 'var(--fg3)' }}>5+ pages</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg1)' }}>42%</div>
                  <div style={{ fontSize: 10, color: 'var(--fg3)' }}>1 page only</div>
                </div>
              </div>
            </div>
          </Card>

          {/* Session duration */}
          <Card>
            <CardHead title="Session Duration" />
            <div style={{ padding: '16px 20px 10px' }}>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={[
                  { dur: '<30s',  pct: 28 },
                  { dur: '30-1m', pct: 14 },
                  { dur: '1-3m',  pct: 19 },
                  { dur: '3-5m',  pct: 18 },
                  { dur: '5-10m', pct: 13 },
                  { dur: '10m+',  pct: 8  },
                ]} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="dur" tick={{ fontSize: 9.5, fill: 'var(--fg3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--fg3)' }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip contentStyle={TT_STYLE} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]} name="Sessions %">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <Cell key={i} fill={`hsl(221, 80%, ${40 + i * 9}%)`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 10, padding: '10px 0', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg1)' }}>{kpi.duration}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg3)' }}>Average</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg1)' }}>21%</div>
                  <div style={{ fontSize: 10, color: 'var(--fg3)' }}>Under 1m</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg1)' }}>8%</div>
                  <div style={{ fontSize: 10, color: 'var(--fg3)' }}>Over 10m</div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* -- New vs Returning -- */}
        <Card style={{ marginBottom: 24 }}>
          <CardHead title="New vs Returning Visitors" action={
            <span style={{ fontSize: 11, color: 'var(--fg3)' }}>session comparison over time</span>
          } />
          <div style={{ padding: '16px 20px 10px' }}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="gNew" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#1D4ED8" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#1D4ED8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gRet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--fg3)' }} axisLine={false} tickLine={false}
                  interval={range === '7D' ? 0 : range === '30D' ? 4 : 1} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--fg3)' }} axisLine={false} tickLine={false} width={50} tickFormatter={fmt} />
                <Tooltip content={<ChartTip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="newUsers" name="New Visitors"   stroke="#1D4ED8" strokeWidth={2} fill="url(#gNew)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="users"    name="Total Visitors" stroke="#6366f1" strokeWidth={2} fill="url(#gRet)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* -- Info banner -- */}
        <div style={{ background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 'var(--r-md)', padding: '14px 20px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Zap size={16} color="var(--ne-blue)" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ne-blue)', marginBottom: 2 }}>Analytics integration ready</div>
            <p style={{ fontSize: 12, color: 'var(--fg2)', margin: 0 }}>
              Currently showing representative data. Connect Google Analytics 4, Plausible, or Fathom via Site Settings to see live data from your website.
            </p>
          </div>
        </div>

      </div>
    </>
  );
}
