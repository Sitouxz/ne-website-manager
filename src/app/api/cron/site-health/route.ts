import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity';
import { loadHealthReport } from '@/lib/health/load';
import { summarizeReport } from '@/lib/health/sweep';

/**
 * The weekly sweep across every client website.
 *
 * This is the process half of the feature rather than the feature itself.
 * Everything it reports was already computable on any given day — what was
 * missing is anything that *looks* without being asked. A page published
 * correctly in March and quietly broken in June is invisible to a CMS whose
 * checks all fire at publish time, and the person who eventually finds it is
 * the client. Running the same checks on a schedule is what moves that
 * discovery to NE's side.
 *
 * Writes one `activity_log` row per client that has something wrong, which
 * is deliberately the only output: the log is already the dashboard's
 * "what happened recently" feed, so a finding surfaces where an operator is
 * already looking rather than in a channel someone has to remember to check.
 * A clean client writes nothing at all — a weekly "all good" entry is how a
 * useful signal becomes wallpaper.
 *
 * Uses the service-role admin client for the same reason `publish-scheduled`
 * does: the pass is intentionally cross-tenant and has no user session to
 * scope RLS against.
 *
 * Intended cadence is weekly. Daily would report the same findings six more
 * times before anyone had a chance to act on them, and a report that repeats
 * itself is one people stop reading.
 *
 * NOT currently in `vercel.json`: the project is on a Hobby plan, which
 * already carries the two crons it allows (publish-scheduled and
 * rollup-analytics), and a third entry risks the deployment rejection that
 * previously stranded production on a stale build. Nothing is lost in the
 * meantime — `/health` computes the same report on demand, so this route is
 * only the unattended half. Add the schedule when the plan allows a third
 * cron; until then it can be triggered manually with `CRON_SECRET`.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  // An unset/empty CRON_SECRET must never act as a wildcard match — the same
  // rule the other two cron routes apply.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();

  const { data: clients, error } = await supabase.from('clients').select('id, name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const swept: { client: string; problems: number; tidy: number }[] = [];

  for (const client of clients ?? []) {
    const report = await loadHealthReport(supabase, client, now);
    const summary = summarizeReport(report);

    swept.push({ client: client.name, problems: report.problemCount, tidy: report.tidyCount });
    if (!summary) continue;

    await logActivity(supabase, {
      clientId: client.id,
      actorId: null,
      action: 'checked',
      entityType: 'settings',
      summary: `Weekly website check: ${summary}`,
      meta: {
        problem_count: report.problemCount,
        tidy_count: report.tidyCount,
        // The findings themselves, so the dashboard can show what was found
        // without re-running the sweep, and so a fixed problem is visibly
        // absent from next week's entry rather than silently gone.
        findings: report.findings.map((f) => ({ code: f.code, subject: f.subject, message: f.message })),
      },
    });
  }

  return NextResponse.json({ ok: true, swept });
}
