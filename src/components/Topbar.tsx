'use client';

import { Bell, HelpCircle, Search, Menu } from 'lucide-react';
import { useMobileMenu } from './AppShell';

export default function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { onToggle } = useMobileMenu();

  return (
    <div className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Hamburger — visible on mobile via CSS */}
        <button className="mobile-menu-btn" onClick={onToggle} aria-label="Open menu">
          <Menu size={20} />
        </button>

        <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg1)', margin: 0 }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 12, color: 'var(--fg3)', margin: 0 }}>{subtitle}</p>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Search */}
        <div
          className="topbar-search"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)', padding: '6px 12px',
            fontSize: 13, color: 'var(--fg3)',
          }}
        >
          <Search size={14} />
          <span className="topbar-search-label" style={{ fontSize: 12 }}>Search...</span>
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
