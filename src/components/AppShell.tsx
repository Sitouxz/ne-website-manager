'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import type { Client, Collection, Role } from '@/lib/supabase/types';

export default function AppShell({
  children,
  clientName,
  clients,
  selectedClientId,
  role,
  genericCollections = [],
}: {
  children: React.ReactNode;
  clientName: string;
  clients: Client[];
  selectedClientId: string | null;
  role: Role;
  genericCollections?: Pick<Collection, 'id' | 'name'>[];
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
        clients={clients}
        selectedClientId={selectedClientId}
        role={role}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        genericCollections={genericCollections}
      />

      <div className="app-layout">
        {/* Pass toggle to children via a context-like wrapper */}
        {/* We clone children and inject onMenuClick via a wrapping div with data attr */}
        <div data-sidebar-toggle="true" style={{ display: 'contents' }}>
          {/* Use a global custom event to communicate hamburger click */}
          <MobileMenuProvider onToggle={() => setSidebarOpen((o) => !o)}>
            <ClientSelectionProvider selectedClientId={selectedClientId} clientName={clientName}>
              {children}
            </ClientSelectionProvider>
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

const ClientSelectionContext = createContext<{ selectedClientId: string | null; clientName: string }>({
  selectedClientId: null,
  clientName: 'Website Manager',
});
export function useSelectedClient() { return useContext(ClientSelectionContext); }

function MobileMenuProvider({ children, onToggle }: { children: React.ReactNode; onToggle: () => void }) {
  return (
    <MobileMenuContext.Provider value={{ onToggle }}>
      {children}
    </MobileMenuContext.Provider>
  );
}

function ClientSelectionProvider({
  children,
  selectedClientId,
  clientName,
}: {
  children: React.ReactNode;
  selectedClientId: string | null;
  clientName: string;
}) {
  return (
    <ClientSelectionContext.Provider value={{ selectedClientId, clientName }}>
      {children}
    </ClientSelectionContext.Provider>
  );
}
