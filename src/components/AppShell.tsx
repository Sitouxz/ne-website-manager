'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import type { Role } from '@/lib/supabase/types';

export default function AppShell({
  children,
  clientName,
  role,
}: {
  children: React.ReactNode;
  clientName: string;
  role: Role;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div style={{ display: 'flex' }}>
      {/* Mobile backdrop */}
      <div
        className={`sidebar-backdrop${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <Sidebar
        clientName={clientName}
        role={role}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="app-layout">
        {/* Pass toggle to children via a context-like wrapper */}
        {/* We clone children and inject onMenuClick via a wrapping div with data attr */}
        <div data-sidebar-toggle="true" style={{ display: 'contents' }}>
          {/* Use a global custom event to communicate hamburger click */}
          <MobileMenuProvider onToggle={() => setSidebarOpen((o) => !o)}>
            {children}
          </MobileMenuProvider>
        </div>
      </div>
    </div>
  );
}

// Context so Topbar can call the toggle
import { createContext, useContext } from 'react';

const MobileMenuContext = createContext<{ onToggle: () => void }>({ onToggle: () => {} });
export function useMobileMenu() { return useContext(MobileMenuContext); }

function MobileMenuProvider({ children, onToggle }: { children: React.ReactNode; onToggle: () => void }) {
  return (
    <MobileMenuContext.Provider value={{ onToggle }}>
      {children}
    </MobileMenuContext.Provider>
  );
}
