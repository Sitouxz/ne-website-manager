import { useState } from 'react';
import { Eye } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/lib/supabase/types';

const PREVIEW_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

interface EditorPreviewButtonProps {
  site: Pick<Client, 'capabilities' | 'website_url'> | null;
  clientId: string;
  entityType: 'page' | 'collection_entry';
  entityId: string;
  disabled?: boolean;
}

export function EditorPreviewButton({ site, clientId, entityType, entityId, disabled }: EditorPreviewButtonProps) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  if (site?.capabilities?.editor_preview !== true) return null;

  async function openPreview(websiteUrl: string | null) {
    setError('');
    let destination: URL;
    try {
      const website = new URL(websiteUrl ?? '');
      if (!['https:', 'http:'].includes(website.protocol) || website.username || website.password) {
        throw new Error('Invalid website URL');
      }
      destination = new URL('/api/preview', website);
    } catch {
      setError('Add a valid website URL in Settings to open preview.');
      return;
    }

    // Open during the click so the browser still has user activation after the token is saved.
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setError('Allow pop-ups for the CMS to open preview.');
      return;
    }
    tab.opener = null;
    setOpening(true);

    try {
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + PREVIEW_TOKEN_TTL_MS).toISOString();
      const { error: insertError } = await createClient().from('preview_tokens').insert({
        client_id: clientId,
        entity_type: entityType,
        entity_id: entityId,
        token,
        expires_at: expiresAt,
      });
      if (insertError) throw insertError;

      destination.searchParams.set('token', token);
      tab.location.replace(destination.href);
    } catch {
      tab.close();
      setError('Couldn’t open preview. Try again.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      {error && <span role="alert" style={{ color: 'var(--ne-danger)', fontSize: 12 }}>{error}</span>}
      <button
        type="button"
        className="btn-outline-ne"
        disabled={disabled || opening}
        aria-busy={disabled || opening}
        title={disabled ? 'Preview is available after your changes are saved' : 'Preview saved content in a new tab'}
        style={disabled || opening ? { cursor: 'wait', opacity: 0.65 } : undefined}
        onClick={() => openPreview(site.website_url)}
      >
        <Eye size={14} aria-hidden="true" />
        {opening ? 'Opening preview…' : 'Preview'}
      </button>
    </>
  );
}
