import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionBar, SelectCell } from './BulkActionBar';

describe('BulkActionBar', () => {
  it('renders nothing while nothing is selected', () => {
    // The bar is absent rather than present-and-disabled: a permanent row of
    // greyed-out destructive buttons is noise on every visit that is not a
    // bulk operation, and it makes the moment something IS selected quieter.
    const { container } = render(<BulkActionBar count={0} busy={false} onClear={vi.fn()} onDelete={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('reports the count and is labelled for assistive tech', () => {
    render(<BulkActionBar count={3} busy={false} onClear={vi.fn()} />);
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeTruthy();
  });

  it('omits Delete entirely when no handler is given', () => {
    // Lists that can only change status must not show a delete button at all.
    render(<BulkActionBar count={1} busy={false} onClear={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('calls onDelete and onClear', () => {
    const onDelete = vi.fn();
    const onClear = vi.fn();
    render(<BulkActionBar count={2} busy={false} onClear={onClear} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('accepts a caller-specific delete label', () => {
    render(<BulkActionBar count={1} busy={false} onClear={vi.fn()} onDelete={vi.fn()} deleteLabel="Remove files" />);
    expect(screen.getByRole('button', { name: /remove files/i })).toBeTruthy();
  });

  it('renders custom actions before Delete', () => {
    // Order is load-bearing: muscle memory for "publish these" must never land
    // on "delete these".
    render(
      <BulkActionBar count={2} busy={false} onClear={vi.fn()} onDelete={vi.fn()}>
        <button>Publish</button>
      </BulkActionBar>,
    );
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons.indexOf('Publish')).toBeLessThan(buttons.findIndex((t) => /Delete/.test(t ?? '')));
  });

  it('disables custom actions while busy even when the caller forgets to', () => {
    // A half-applied bulk action is confusing enough without a second one
    // starting on top of it. `Publish` here deliberately does NOT pass
    // `disabled` — the bar's fieldset has to be what stops it, otherwise this
    // guarantee lives in every call site and will eventually be missed.
    const onPublish = vi.fn();
    render(
      <BulkActionBar count={2} busy onClear={vi.fn()} onDelete={vi.fn()}>
        <button onClick={onPublish}>Publish</button>
      </BulkActionBar>,
    );

    const publish = screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement;

    // `:disabled` rather than `.disabled`: the IDL property reflects only the
    // element's own attribute, while the pseudo-class reflects the real state
    // including a disabled ancestor fieldset. A browser fires no click event
    // at all on a `:disabled` control — jsdom's `fireEvent` dispatches
    // directly and bypasses that, so asserting "the handler did not run" here
    // would be testing jsdom rather than the component.
    expect(publish.matches(':disabled')).toBe(true);
  });

  it('leaves custom actions usable when not busy', () => {
    const onPublish = vi.fn();
    render(
      <BulkActionBar count={2} busy={false} onClear={vi.fn()} onDelete={vi.fn()}>
        <button onClick={onPublish}>Publish</button>
      </BulkActionBar>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('does not fire a handler on a click while busy', () => {
    const onDelete = vi.fn();
    render(<BulkActionBar count={2} busy onClear={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('SelectCell', () => {
  it('exposes a per-row label so the checkbox is identifiable out of context', () => {
    render(<SelectCell checked={false} onToggle={vi.fn()} label="Select Alpha Court" />);
    const box = screen.getByRole('checkbox', { name: 'Select Alpha Court' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it('reflects checked state and reports toggles', () => {
    const onToggle = vi.fn();
    render(<SelectCell checked onToggle={onToggle} label="Select Beta House" />);
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(true);

    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
