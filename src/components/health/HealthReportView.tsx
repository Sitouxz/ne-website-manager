import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import type { FindingCode, HealthFinding, HealthReport } from '@/lib/health/sweep';

/**
 * The rendered form of a site-health report.
 *
 * Split out of `app/(app)/health/page.tsx` so the page keeps only the data
 * loading and this keeps only the presentation — which is what makes the
 * screen testable at all. The page is an async server component that resolves
 * a workspace and queries six tables; this takes a plain object and returns
 * markup, so `HealthReportView.test.tsx` can assert what an administrator
 * actually reads without a database or a session.
 */

const GROUP_TITLES: Record<FindingCode, string> = {
  'publish-failing': 'Updates are not reaching the website',
  'missing-seo': 'Live pages Google has to describe on its own',
  'image-missing-alt': 'Pictures nobody can describe',
  'broken-internal-link': 'Links that go nowhere',
  'orphan-media': 'Uploads nothing uses',
  'stale-content': 'Live for a long time without a change',
};

/**
 * Report order: visitor-facing failures first, in the order they hurt.
 * Deliberately not severity order alone — a broken link and a missing search
 * description are both `problem`, but only one of them greets a visitor with
 * an error page.
 */
const GROUP_ORDER: FindingCode[] = [
  'publish-failing',
  'broken-internal-link',
  'image-missing-alt',
  'missing-seo',
  'stale-content',
  'orphan-media',
];

export function groupFindings(findings: HealthFinding[]): { code: FindingCode; findings: HealthFinding[] }[] {
  return GROUP_ORDER
    .map((code) => ({ code, findings: findings.filter((f) => f.code === code) }))
    .filter((group) => group.findings.length > 0);
}

function FindingGroup({ code, findings }: { code: FindingCode; findings: HealthFinding[] }) {
  const isProblem = findings[0]?.severity === 'problem';

  return (
    <section className="dashboard-section" aria-labelledby={`group-${code}`}>
      <div className="dashboard-section-heading">
        <h3 id={`group-${code}`}>
          {GROUP_TITLES[code]} <span style={{ color: 'var(--fg3)', fontWeight: 500 }}>({findings.length})</span>
        </h3>
      </div>
      <div className="attention-list">
        {findings.map((finding, index) => {
          const body = (
            <>
              <span className={`attention-icon ${isProblem ? 'danger' : 'warning'}`}>
                {isProblem ? <AlertTriangle size={19} /> : <Sparkles size={19} />}
              </span>
              <span>
                <strong>{finding.subject ?? GROUP_TITLES[code]}</strong>
                <small>{finding.message}</small>
              </span>
              {finding.href ? (
                <span className="attention-action">
                  Open <ArrowRight size={16} />
                </span>
              ) : null}
            </>
          );

          return finding.href ? (
            <Link key={`${code}-${index}`} href={finding.href} className="attention-row">
              {body}
            </Link>
          ) : (
            <div key={`${code}-${index}`} className="attention-row">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The headline. Distinguishes three states rather than two, because "nothing
 * is broken but six things could be tidier" is a genuinely different message
 * from "there is nothing to do" — collapsing them either overstates the
 * problem or hides the backlog.
 */
export function headlineFor(report: HealthReport, clientName: string): { title: string; detail: string } {
  if (report.problemCount === 0 && report.tidyCount === 0) {
    return {
      title: 'Nothing is broken on the website',
      detail: `Everything published on ${clientName} is complete, reachable and up to date.`,
    };
  }
  if (report.problemCount === 0) {
    return {
      title: 'Nothing is broken on the website',
      detail: `${report.tidyCount} ${report.tidyCount === 1 ? 'item is' : 'items are'} worth tidying up when there is time.`,
    };
  }
  return {
    title: `${report.problemCount} ${report.problemCount === 1 ? 'thing needs' : 'things need'} fixing`,
    detail: `These are problems a visitor to ${clientName} can run into today. This check runs again every Monday.`,
  };
}

export default function HealthReportView({
  report,
  clientName,
}: {
  report: HealthReport;
  clientName: string;
}) {
  const grouped = groupFindings(report.findings);
  const headline = headlineFor(report, clientName);

  return (
    <div className="dashboard-main">
      <header className="dashboard-intro">
        <h2>{headline.title}</h2>
        <p>{headline.detail}</p>
      </header>

      {grouped.length === 0 ? (
        <section className="dashboard-section">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              padding: '56px 24px',
              color: 'var(--fg3)',
              textAlign: 'center',
            }}
          >
            <CheckCircle2 size={30} color="var(--ne-blue)" />
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg1)' }}>Everything checks out</div>
            <div style={{ fontSize: 13, maxWidth: 420 }}>
              Published pages have their descriptions, every picture has words, every internal link
              goes somewhere, and updates are reaching the website.
            </div>
          </div>
        </section>
      ) : (
        grouped.map((group) => <FindingGroup key={group.code} code={group.code} findings={group.findings} />)
      )}
    </div>
  );
}
