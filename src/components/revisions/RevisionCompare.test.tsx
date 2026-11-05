import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RevisionCompare } from './RevisionCompare';
import { POST_DIFF_FIELDS, diffSnapshot } from '@/lib/revisions/diff';

const revision = { title: 'Open house', content: '<p>Doors open at 9.</p>', tags: ['family'], noindex: false };

describe('RevisionCompare', () => {
  it('lists changed fields with marked additions and removals', () => {
    const changes = diffSnapshot(revision, { ...revision, content: '<p>Doors open at 10.</p>', tags: ['youth'] }, POST_DIFF_FIELDS);
    render(<RevisionCompare savedAt="2026-11-01T09:00:00Z" changes={changes} restoring={false} onBack={() => {}} onRestore={() => {}} />);

    expect(screen.getByRole('heading', { name: /Changes since/ })).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByText('Tags')).toBeTruthy();
    // Additions/removals carry screen-reader text, not just colour.
    expect(screen.getAllByText('[added]').length).toBeGreaterThan(0);
    expect(screen.getAllByText('[removed]').length).toBeGreaterThan(0);
    expect(screen.getByText('Added:')).toBeTruthy();
    expect(screen.getByText('Removed:')).toBeTruthy();
  });

  it('shows the empty state and disables restore when nothing differs', () => {
    render(<RevisionCompare savedAt="2026-11-01T09:00:00Z" changes={[]} restoring={false} onBack={() => {}} onRestore={() => {}} />);

    expect(screen.getByText(/No differences/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Restore this version' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls back for restore and for returning to the list', () => {
    const onBack = vi.fn();
    const onRestore = vi.fn();
    const changes = diffSnapshot(revision, { ...revision, noindex: true }, POST_DIFF_FIELDS);
    render(<RevisionCompare savedAt="2026-11-01T09:00:00Z" changes={changes} restoring={false} onBack={onBack} onRestore={onRestore} />);

    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    fireEvent.click(screen.getByRole('button', { name: /All versions/ }));
    expect(onRestore).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
