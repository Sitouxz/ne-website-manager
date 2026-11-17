import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPreviewButton } from './EditorPreviewButton';

const { from, insert } = vi.hoisted(() => {
  const insert = vi.fn();
  return { insert, from: vi.fn(() => ({ insert })) };
});

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from }) }));

const site = {
  capabilities: { editor_preview: true },
  website_url: 'https://www.aboutredz.sg/',
};
const clientId = 'aboutredz-client';
const entityId = 'saved-content';
const token = '00000000-0000-4000-8000-000000000000';

function mockPreviewTab() {
  const tab = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  return { tab, open };
}

describe('EditorPreviewButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(token);
    insert.mockResolvedValue({ error: null });
  });

  afterEach(() => vi.restoreAllMocks());

  it('only appears for opted-in sites', () => {
    render(<EditorPreviewButton site={{ ...site, capabilities: null }} clientId={clientId} entityType="page" entityId={entityId} />);
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
  });

  it('waits for the current save before creating a token', () => {
    const { open } = mockPreviewTab();
    render(<EditorPreviewButton site={site} clientId={clientId} entityType="page" entityId={entityId} disabled />);
    const preview = screen.getByRole<HTMLButtonElement>('button', { name: 'Preview' });
    expect(preview.disabled).toBe(true);
    expect(preview.title).toMatch(/after your changes are saved/);
    fireEvent.click(preview);
    expect(open).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each(['page', 'collection_entry'] as const)('opens a token-backed preview for a saved %s', async (entityType) => {
    const { open, tab } = mockPreviewTab();
    render(<EditorPreviewButton site={site} clientId={clientId} entityType={entityType} entityId={entityId} />);

    const before = Date.now();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    await waitFor(() => {
      expect(tab.location.replace).toHaveBeenCalledWith(`https://www.aboutredz.sg/api/preview?token=${token}`);
    });

    expect(from).toHaveBeenCalledExactlyOnceWith('preview_tokens');
    expect(insert).toHaveBeenCalledExactlyOnceWith({
      client_id: clientId,
      entity_type: entityType,
      entity_id: entityId,
      token,
      expires_at: expect.any(String),
    });
    const expiry = Date.parse(insert.mock.calls[0][0].expires_at);
    expect(expiry).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 86_400_000);
  });

  it('gives actionable feedback with a missing or invalid site URL', () => {
    const { open } = mockPreviewTab();
    render(<EditorPreviewButton site={{ ...site, website_url: null }} clientId={clientId} entityType="page" entityId={entityId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('alert').textContent).toMatch(/website URL in Settings/);
    expect(open).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('reports a blocked tab without creating a token', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<EditorPreviewButton site={site} clientId={clientId} entityType="page" entityId={entityId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Allow pop-ups/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('closes the tab and re-enables preview when creating a token fails', async () => {
    const { tab } = mockPreviewTab();
    insert.mockResolvedValueOnce({ error: { code: '42501' } });
    render(<EditorPreviewButton site={site} clientId={clientId} entityType="collection_entry" entityId={entityId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect((screen.getByRole('button', { name: 'Opening preview…' }) as HTMLButtonElement).disabled).toBe(true);
    await screen.findByRole('alert');
    expect(tab.close).toHaveBeenCalledOnce();
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
