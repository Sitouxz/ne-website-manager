'use client';

import { Bell, HelpCircle, Search } from 'lucide-react';

export default function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="topbar">
      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg1)', margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--fg3)', margin: 0 }}>{subtitle}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)', padding: '6px 12px',
          fontSize: 13, color: 'var(--fg3)',
        }}>
          <Search size={14} />
          <span style={{ fontSize: 12 }}>Search...</span>
        </div>
        <button style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: 7, cursor: 'pointer', color: 'var(--fg3)', display: 'grid', placeItems: 'center' }}>
          <Bell size={16} />
        </button>
        <button style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: 7, cursor: 'pointer', color: 'var(--fg3)', display: 'grid', placeItems: 'center' }}>
          <HelpCircle size={16} />
        </button>
      </div>
    </div>
  );
}
