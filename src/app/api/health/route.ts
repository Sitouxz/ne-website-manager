import { NextResponse } from 'next/server';
import { getActiveWorkspace } from '@/lib/workspace';
import { loadHealthReport } from '@/lib/health/load';

/**
 * The site-health report for the workspace the caller currently has selected.
 *
 * Computed on request rather than read from a stored report — see
 * `sweep.ts` for why there is no `site_health_reports` table. The cost is one
 * fan-out of six scoped queries; the benefit is that the number on screen is
 * never stale, which is the entire basis on which anyone would trust it.
 *
 * `getActiveWorkspace` resolves the tenant exactly the way every dashboard
 * route does — the shared resolver introduced after the audit found the
 * sidebar and the dashboard disagreeing about which client was selected — so
 * this endpoint can never report on a different website than the one whose
 * name is in the sidebar. Its Supabase client is user-scoped, so RLS is the
 * boundary: a caller who somehow named another tenant's client would get
 * empty result sets rather than another client's content.
 */
export async function GET() {
  const { user, activeClient, supabase } = await getActiveWorkspace();

  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!activeClient) return NextResponse.json({ error: 'No website selected.' }, { status: 400 });

  const report = await loadHealthReport(supabase, { id: activeClient.id, name: activeClient.name });
  return NextResponse.json(report);
}
