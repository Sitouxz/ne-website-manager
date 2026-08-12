import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PublishWarnings } from './PublishWarnings';
import type { PublishWarning } from '@/lib/publish-checks';

const warning = (message: string): PublishWarning => ({ code: 'image-missing-alt', message });

describe('PublishWarnings', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<PublishWarnings warnings={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists every warning message', () => {
    render(<PublishWarnings warnings={[warning('First problem.'), warning('Second problem.')]} />);
    expect(screen.getByText('First problem.')).toBeTruthy();
    expect(screen.getByText('Second problem.')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('headlines with a count that agrees with the list', () => {
    render(<PublishWarnings warnings={[warning('Only one.')]} />);
    expect(screen.getByText(/1 thing worth checking/)).toBeTruthy();
  });

  it('always says these do not block publishing', () => {
    // The load-bearing sentence: a warning with no stated way past it is
    // indistinguishable from a block to someone seeing it for the first time.
    render(<PublishWarnings warnings={[warning('Something.')]} />);
    expect(screen.getByText(/None of these stop you publishing/)).toBeTruthy();
  });

  it('announces politely rather than interrupting', () => {
    // `status`, not `alert` — this appears in response to the user's own
    // click, so it should not cut a screen reader off mid-sentence.
    render(<PublishWarnings warnings={[warning('Something.')]} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
