import Topbar from '@/components/Topbar';
import HealthReportView from '@/components/health/HealthReportView';
import { getActiveWorkspace } from '@/lib/workspace';
import { loadHealthReport } from '@/lib/health/load';

/**
 * Website check — the weekly review of content that is already live.
 *
 * Every other screen in this product asks "is this change good?" at the
 * moment someone makes it. This one asks "is the website still good?" about
 * changes nobody is making, which is the question no publish-time check can
 * ever answer: a page published correctly in March and quietly broken in
 * June by a deleted image or a retired field is invisible until a visitor
 * finds it.
 *
 * Data loading only — the rendering lives in `HealthReportView` so it can be
 * tested without a session or a database. Computed per request, with no
 * stored report (see `lib/health/sweep.ts`): a screen that nags about a
 * problem fixed yesterday is worse than no screen, and the sweep is cheap
 * enough that it never has to be.
 *
 * `manager` access in the sidebar: every fix this page links to lives behind
 * a screen an `editor` cannot open, so showing them the list would be
 * handing someone a job with no button to do it with.
 */

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const { user, activeClient, supabase } = await getActiveWorkspace();

  if (!user || !activeClient) {
    return (
      <>
        <Topbar title="Website check" />
        <main className="page-body">
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--fg3)' }}>
            Select a website to check.
          </div>
        </main>
      </>
    );
  }

  const report = await loadHealthReport(supabase, { id: activeClient.id, name: activeClient.name });

  return (
    <>
      <Topbar
        title="Website check"
        subtitle={`${activeClient.name} · what the live website looks like right now`}
      />
      <main className="page-body dashboard-workspace">
        <HealthReportView report={report} clientName={activeClient.name} />
      </main>
    </>
  );
}
