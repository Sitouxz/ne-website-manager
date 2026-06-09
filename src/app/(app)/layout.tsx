import Sidebar from '@/components/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex' }}>
      <Sidebar clientName="Al-Islah Mosque" />
      <div className="app-layout">{children}</div>
    </div>
  );
}
