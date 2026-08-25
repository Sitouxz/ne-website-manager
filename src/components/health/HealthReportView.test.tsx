import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import HealthReportView, { groupFindings, headlineFor } from './HealthReportView';
import type { HealthFinding, HealthReport } from '@/lib/health/sweep';

const report = (findings: HealthFinding[]): HealthReport => ({
  clientId: 'c1',
  clientName: 'Al-Islah',
  generatedAt: '2026-08-13T00:00:00Z',
  findings,
  problemCount: findings.filter((f) => f.severity === 'problem').length,
  tidyCount: findings.filter((f) => f.severity === 'tidy').length,
});

const brokenLink: HealthFinding = {
  code: 'broken-internal-link',
  severity: 'problem',
  subject: 'Ramadan Timings',
  message: '"Ramadan Timings" links to /donate, which is not a published page — visitors clicking it get an error.',
  href: '/cms/posts/p1',
};

const orphan: HealthFinding = {
  code: 'orphan-media',
  severity: 'tidy',
  subject: 'old-poster.jpg',
  message: '"old-poster.jpg" is in the media library but is not used on any page.',
  href: '/cms/media',
};

describe('headlineFor', () => {
  it('separates "nothing to do" from "nothing broken but a backlog"', () => {
    // Collapsing these two either overstates the problem or hides the
    // backlog, so the screen distinguishes three states, not two.
    expect(headlineFor(report([]), 'Al-Islah').detail).toContain('complete, reachable and up to date');
    expect(headlineFor(report([orphan]), 'Al-Islah').title).toBe('Nothing is broken on the website');
    expect(headlineFor(report([orphan]), 'Al-Islah').detail).toContain('1 item is worth tidying up');
  });

  it('counts problems in the headline and names the client', () => {
    const headline = headlineFor(report([brokenLink]), 'Al-Islah');
    expect(headline.title).toBe('1 thing needs fixing');
    expect(headline.detail).toContain('a visitor to Al-Islah can run into today');
  });

  it('pluralises correctly', () => {
    expect(headlineFor(report([brokenLink, { ...brokenLink, subject: 'Other' }]), 'X').title)
      .toBe('2 things need fixing');
  });
});

describe('groupFindings', () => {
  it('puts visitor-facing failures before housekeeping', () => {
    // Not severity order alone: a broken link and a missing description are
    // both problems, but only one greets a visitor with an error page.
    const groups = groupFindings([
      orphan,
      { code: 'missing-seo', severity: 'problem', message: 'no description', subject: 'A page' },
      brokenLink,
    ]);
    expect(groups.map((g) => g.code)).toEqual(['broken-internal-link', 'missing-seo', 'orphan-media']);
  });

  it('drops empty groups rather than rendering empty headings', () => {
    expect(groupFindings([])).toEqual([]);
  });
});

describe('HealthReportView', () => {
  it('tells an administrator exactly what a visitor runs into, and where to fix it', () => {
    render(<HealthReportView report={report([brokenLink])} clientName="Al-Islah" />);

    expect(screen.getByText('1 thing needs fixing')).toBeTruthy();
    expect(screen.getByText('Links that go nowhere', { exact: false })).toBeTruthy();
    expect(screen.getByText(/visitors clicking it get an error/)).toBeTruthy();

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/cms/posts/p1');
  });

  it('counts each group in its heading', () => {
    render(
      <HealthReportView
        report={report([brokenLink, { ...brokenLink, subject: 'Another post', href: '/cms/posts/p2' }])}
        clientName="Al-Islah"
      />,
    );
    const heading = screen.getByRole('heading', { name: /Links that go nowhere/ });
    expect(heading.textContent).toContain('(2)');
  });

  it('shows a genuine all-clear rather than an empty page', () => {
    render(<HealthReportView report={report([])} clientName="Al-Islah" />);
    expect(screen.getByText('Everything checks out')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('separates problems from housekeeping in the markup', () => {
    const { container } = render(
      <HealthReportView report={report([brokenLink, orphan])} clientName="Al-Islah" />,
    );
    const problems = container.querySelector('[aria-labelledby="group-broken-internal-link"]');
    const tidy = container.querySelector('[aria-labelledby="group-orphan-media"]');

    expect(within(problems as HTMLElement).getByText('Ramadan Timings')).toBeTruthy();
    expect(within(tidy as HTMLElement).getByText('old-poster.jpg')).toBeTruthy();
    // Severity drives the icon class, so the two read differently at a glance
    // rather than only in their wording.
    expect((problems as HTMLElement).querySelector('.attention-icon.danger')).toBeTruthy();
    expect((tidy as HTMLElement).querySelector('.attention-icon.warning')).toBeTruthy();
  });

  it('renders a finding with nowhere to go as plain text, not a dead link', () => {
    render(
      <HealthReportView
        report={report([{ code: 'publish-failing', severity: 'problem', message: 'Updates are not arriving.' }])}
        clientName="Al-Islah"
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Updates are not arriving.')).toBeTruthy();
  });
});
