'use client';

import Image from 'next/image';
import { useId, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import MediaPicker from '@/components/MediaPicker';
import type { MediaItem } from '@/app/api/media/route';
import {
  SEARCH_DESCRIPTION_LIMIT,
  SEARCH_TITLE_LIMIT,
  canonicalUrlError,
  displayHost,
  displayUrl,
  resolveShareImage,
  truncateForSearch,
} from '@/lib/seo/preview';

export interface SeoSharingValue {
  ogImageUrl: string;
  canonicalUrl: string;
  noindex: boolean;
}

interface SeoSharingFieldsProps {
  /** Headline as it will actually be used (SEO title, else the item title). */
  title: string;
  /** Description as it will actually be used (SEO description, else the excerpt). */
  description: string;
  /** Absolute public URL of the item, or null when the site URL isn't configured. */
  url: string | null;
  value: SeoSharingValue;
  /** Image used when no social image is set (a post's cover). */
  fallbackImageUrl?: string | null;
  /** How the fallback is described in the helper text, e.g. "the cover image". */
  fallbackLabel?: string;
  onChange: (patch: Partial<SeoSharingValue>) => void;
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 } as const;
const helpStyle = { fontSize: 11.5, color: 'var(--fg3)', margin: '4px 0 0', lineHeight: 1.5 } as const;
const inputStyle = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 12px',
  fontSize: 13.5, color: 'var(--fg1)', background: 'var(--surface)',
} as const;

/**
 * The search-result preview, share-card preview, social image, canonical URL
 * and "hide from search engines" controls, shared by the post and page
 * editors. Sits under each editor's existing headline/description inputs, so
 * those (and the post editor's suggestion button) are left exactly as they
 * were.
 */
export function SeoSharingFields({
  title, description, url, value, fallbackImageUrl = null, fallbackLabel, onChange,
}: SeoSharingFieldsProps) {
  const id = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const shareImage = resolveShareImage(value.ogImageUrl, fallbackImageUrl);
  const canonicalError = canonicalUrlError(value.canonicalUrl);
  const headline = truncateForSearch(title || 'Untitled', SEARCH_TITLE_LIMIT);
  const snippet = truncateForSearch(description, SEARCH_DESCRIPTION_LIMIT);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
      <figure style={{ margin: 0 }}>
        <figcaption style={labelStyle}>Preview in Google</figcaption>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '12px 14px', background: 'var(--surface)' }}>
          <div style={{ fontSize: 12, color: 'var(--fg2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayUrl(url)}</div>
          <div style={{ fontSize: 17, lineHeight: 1.3, color: '#1a0dab', margin: '3px 0 4px' }}>{headline}</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--fg2)' }}>
            {snippet || <span style={{ color: 'var(--fg3)' }}>Google will pick a snippet from the page.</span>}
          </div>
          {value.noindex ? (
            <p style={{ ...helpStyle, color: 'var(--ne-warning)', fontWeight: 600, marginTop: 8 }}>
              Hidden from search engines, so this result will not appear.
            </p>
          ) : null}
        </div>
      </figure>

      <figure style={{ margin: 0 }}>
        <figcaption style={labelStyle}>Preview when shared</figcaption>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--surface)' }}>
          {shareImage ? (
            <Image unoptimized src={shareImage} alt="" width={600} height={315} style={{ width: '100%', height: 'auto', aspectRatio: '1.91 / 1', objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ aspectRatio: '1.91 / 1', display: 'grid', placeItems: 'center', background: 'var(--surface-3)', color: 'var(--fg3)', fontSize: 12 }}>
              No image. Links share as text only.
            </div>
          )}
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 11, color: 'var(--fg3)', letterSpacing: '.02em' }}>{displayHost(url)}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg1)', marginTop: 2 }}>{headline}</div>
            {snippet ? <div style={{ fontSize: 12.5, color: 'var(--fg2)', marginTop: 2 }}>{truncateForSearch(description, 110)}</div> : null}
          </div>
        </div>
      </figure>

      <div>
        <span style={labelStyle}>Image when shared</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn-outline-ne" aria-describedby={`${id}-image-help`} onClick={() => setPickerOpen(true)}>
            <ImageIcon size={14} aria-hidden="true" /> {value.ogImageUrl ? 'Change image' : 'Choose image'}
          </button>
          {value.ogImageUrl ? (
            <button type="button" className="btn-outline-ne" onClick={() => onChange({ ogImageUrl: '' })}>
              Remove
            </button>
          ) : null}
        </div>
        <p id={`${id}-image-help`} style={helpStyle}>
          Shown on WhatsApp, LinkedIn, Facebook and similar.{' '}
          {fallbackLabel ? `Leave empty to use ${fallbackLabel}.` : 'Leave empty to share without an image.'}
          {' '}Best at 1200 × 630.
        </p>
      </div>

      <details>
        <summary style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', cursor: 'pointer' }}>Advanced</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
          <div>
            <label htmlFor={`${id}-canonical`} style={labelStyle}>Original address (canonical URL)</label>
            <input
              id={`${id}-canonical`}
              type="url"
              inputMode="url"
              value={value.canonicalUrl}
              placeholder={url ?? 'https://'}
              aria-invalid={canonicalError ? true : undefined}
              aria-describedby={`${id}-canonical-help`}
              onChange={(e) => onChange({ canonicalUrl: e.target.value })}
              style={{ ...inputStyle, borderColor: canonicalError ? 'var(--ne-danger)' : 'var(--border)' }}
            />
            <p id={`${id}-canonical-help`} style={{ ...helpStyle, color: canonicalError ? 'var(--ne-danger)' : 'var(--fg3)' }}>
              {canonicalError ?? 'Only needed when this content also lives at another address. Leave empty to use this page.'}
            </p>
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--fg1)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={value.noindex}
                onChange={(e) => onChange({ noindex: e.target.checked })}
                style={{ marginTop: 3 }}
              />
              <span>
                Hide from search engines
                <span style={{ display: 'block', ...helpStyle, marginTop: 2 }}>
                  Visitors with the link can still open it. It is left out of the sitemap and Google is asked not to list it.
                </span>
              </span>
            </label>
          </div>
        </div>
      </details>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accept="image"
        onSelect={(item: MediaItem) => onChange({ ogImageUrl: item.url })}
      />
    </div>
  );
}
