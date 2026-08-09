import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ConfirmProvider, useConfirm, type ConfirmOptions } from './ConfirmDialog';

/**
 * Verifies the dialog that replaced `window.confirm` across the CMS.
 *
 * The important guarantees are behavioural, not visual: the promise must
 * resolve `false` for every way of backing out (so a cancel can never be
 * mistaken for a confirm and delete a client's content), the consequence
 * lines must actually reach the screen, and the confirm button must carry the
 * caller's verb rather than a generic "OK".
 */

function Harness({ options }: { options: ConfirmOptions }) {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>('pending');

  return (
    <div>
      <button onClick={async () => setResult(String(await confirm(options)))}>open</button>
      <span data-testid="result">{result}</span>
    </div>
  );
}

function setup(options: ConfirmOptions) {
  render(
    <ConfirmProvider>
      <Harness options={options} />
    </ConfirmProvider>
  );
  fireEvent.click(screen.getByText('open'));
}

const BASIC: ConfirmOptions = { title: 'Delete "Ramadan Timings"?', confirmLabel: 'Delete post' };

describe('ConfirmDialog', () => {
  it('renders nothing until confirm() is called', () => {
    render(
      <ConfirmProvider>
        <Harness options={BASIC} />
      </ConfirmProvider>
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows the title, body and every consequence line', async () => {
    setup({
      ...BASIC,
      body: 'This cannot be undone.',
      consequences: [
        'This post is published, so it will disappear from your website.',
        'Anyone with the link will see a "page not found" error.',
      ],
    });

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Delete "Ramadan Timings"?')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    expect(screen.getByText(/disappear from your website/)).toBeTruthy();
    expect(screen.getByText(/page not found/)).toBeTruthy();
  });

  it('labels the confirm button with the caller\'s verb, never "OK"', async () => {
    setup(BASIC);
    expect(await screen.findByText('Delete post')).toBeTruthy();
    expect(screen.queryByText('OK')).toBeNull();
  });

  it('resolves true when the confirm button is clicked', async () => {
    setup(BASIC);
    fireEvent.click(await screen.findByText('Delete post'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'));
  });

  it('resolves false when cancelled', async () => {
    setup(BASIC);
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('false'));
  });

  it('resolves false when the backdrop is clicked', async () => {
    setup(BASIC);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('false'));
  });

  it('does not resolve when the dialog body itself is clicked', async () => {
    setup(BASIC);
    fireEvent.click(await screen.findByRole('alertdialog'));
    expect(screen.getByTestId('result').textContent).toBe('pending');
    expect(screen.queryByRole('alertdialog')).toBeTruthy();
  });

  it('closes the dialog once a choice is made', async () => {
    setup(BASIC);
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('focuses Cancel so the destructive action is never the default', async () => {
    setup(BASIC);
    const cancel = await screen.findByText('Cancel');
    expect(document.activeElement).toBe(cancel);
  });

  it('falls back to a generic confirm label when none is given', async () => {
    setup({ title: 'Are you sure?' });
    expect(await screen.findByText('Confirm')).toBeTruthy();
  });

  it('supports a custom cancel label', async () => {
    setup({ ...BASIC, cancelLabel: 'Keep it' });
    expect(await screen.findByText('Keep it')).toBeTruthy();
  });

  it('exposes the dialog to assistive technology', async () => {
    setup(BASIC);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('confirm-title');
    expect(document.getElementById('confirm-title')?.textContent).toBe('Delete "Ramadan Timings"?');
  });

  it('can be reopened after being dismissed, resolving independently', async () => {
    setup(BASIC);
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('false'));

    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByText('Delete post'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'));
  });
});
