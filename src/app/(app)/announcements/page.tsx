'use client';

import Topbar from '@/components/Topbar';
import { useCallback, useEffect, useState } from 'react';
import { Save, Loader2, CheckCircle, Megaphone, Info, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useSelectedClient } from '@/components/AppShell';
import { loadGlobal, saveGlobal } from '@/lib/globals/client';
import { DEFAULT_ANNOUNCEMENT, type AnnouncementGlobal, type AnnouncementVariant } from '@/lib/globals/types';

/**
 * Announcement banner editor — Task 5.1. A thin, single-purpose page
 * focused only on the `announcement` `site_globals` key, kept separate
 * from `src/app/(app)/settings/globals/page.tsx` (which owns
 * footer/theme/social/contact) because an announcement is the one
 * reserved key with time-sensitivity (enable/disable, optional
 * starts_at/ends_at) that editors are expected to touch far more often
 * than footer text or theme tokens — worth a dedicated, always-one-click-
 * away sidebar entry rather than a buried tab. Shares the same
 * load/save-by-key helpers as the globals settings page
 * (`src/lib/globals/client.ts`).
 */
export default function AnnouncementsPage() {
  const { selectedClientId } = useSelectedClient();
  const [loading, setLoading] = useState(true);
  const [announcement, setAnnouncement] = useState<AnnouncementGlobal>(DEFAULT_ANNOUNCEMENT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!selectedClientId) { setLoading(false); return; }
    setLoading(true);
    const a = await loadGlobal<AnnouncementGlobal>(selectedClientId, 'announcement', DEFAULT_ANNOUNCEMENT);
    setAnnouncement(a);
    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function patch(next: Partial<AnnouncementGlobal>) {
    setAnnouncement((prev) => ({ ...prev, ...next }));
    setSaved(false);
  }

  async function handleSave() {
    if (!selectedClientId) return;
    setSaving(true);
    setSaved(false);
    setError('');
    const err = await saveGlobal(selectedClientId, 'announcement', announcement);
    setSaving(false);
    if (err) { setError(err); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid var(--border)',
    borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)',
  };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 };

  const VARIANTS: { value: AnnouncementVariant; label: string; color: string; Icon: React.ElementType }[] = [
    { value: 'info',    label: 'Info',    color: 'var(--ne-blue)',    Icon: Info },
    { value: 'success', label: 'Success', color: 'var(--ne-success)', Icon: CheckCircle2 },
    { value: 'warning', label: 'Warning', color: 'var(--ne-danger)',  Icon: AlertTriangle },
  ];
  const activeVariant = VARIANTS.find((v) => v.value === announcement.variant) ?? VARIANTS[0];

  if (loading) return (
    <>
      <Topbar title="Announcements" />
      <div className="page-body" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );

  return (
    <>
      <Topbar title="Announcements" subtitle="Site-wide banner shown on the public website" />
      <div className="page-body" style={{ maxWidth: 640 }}>

        {!selectedClientId ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 32, color: 'var(--fg3)', fontSize: 13.5 }}>
            Select a client in the sidebar first.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20, gap: 8 }}>
              {saved && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ne-success)', padding: '8px 14px', background: '#DCFCE7', borderRadius: 'var(--r-sm)' }}>
                  <CheckCircle size={13} /> Saved
                </div>
              )}
              <button className="btn-ne" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
                Save
              </button>
            </div>

            {error && (
              <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}

            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Megaphone size={16} color="var(--ne-blue)" />
                <div style={{ fontWeight: 700, fontSize: 14 }}>Announcement banner</div>
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={announcement.enabled}
                    onChange={(e) => patch({ enabled: e.target.checked })}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg1)' }}>Show announcement banner</span>
                </label>

                <div>
                  <label style={labelStyle}>Message</label>
                  <textarea
                    value={announcement.message}
                    onChange={(e) => patch({ message: e.target.value })}
                    placeholder="We're launching a new feature — check it out!"
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Link (optional)</label>
                  <input
                    value={announcement.href ?? ''}
                    onChange={(e) => patch({ href: e.target.value || undefined })}
                    placeholder="/blog/new-feature"
                    style={{ ...inputStyle, fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Style</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {VARIANTS.map(({ value, label, color, Icon }) => (
                      <button
                        key={value}
                        onClick={() => patch({ variant: value })}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '9px 12px', borderRadius: 'var(--r-sm)', fontSize: 12.5, fontWeight: 600,
                          cursor: 'pointer',
                          border: announcement.variant === value ? `1.5px solid ${color}` : '1px solid var(--border)',
                          color: announcement.variant === value ? color : 'var(--fg2)',
                          background: announcement.variant === value ? 'var(--surface-2)' : 'var(--surface)',
                        }}
                      >
                        <Icon size={13} /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Starts at (optional)</label>
                    <input
                      type="datetime-local"
                      value={announcement.starts_at ?? ''}
                      onChange={(e) => patch({ starts_at: e.target.value || undefined })}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Ends at (optional)</label>
                    <input
                      type="datetime-local"
                      value={announcement.ends_at ?? ''}
                      onChange={(e) => patch({ ends_at: e.target.value || undefined })}
                      style={inputStyle}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Live preview */}
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Preview</div>
            {announcement.enabled && announcement.message ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
                borderRadius: 'var(--r-sm)', border: `1px solid ${activeVariant.color}`,
                background: 'var(--surface-2)', color: activeVariant.color, fontSize: 13, fontWeight: 600,
              }}>
                <activeVariant.Icon size={15} />
                <span>{announcement.message}</span>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>Banner is disabled or has no message — nothing will show on the public site.</div>
            )}
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
