'use client';

import Topbar from '@/components/Topbar';
import { useCallback, useEffect, useState } from 'react';
import {
  Save, Loader2, CheckCircle, PanelBottom, Palette, Share2, Phone, Plus, Trash2,
} from 'lucide-react';
import { useSelectedClient } from '@/components/AppShell';
import { loadGlobal, saveGlobal } from '@/lib/globals/client';
import { firePublishNotify } from '@/lib/publish-client';
import {
  DEFAULT_FOOTER, DEFAULT_THEME, DEFAULT_SOCIAL, DEFAULT_CONTACT,
  type FooterGlobal, type ThemeGlobal, type SocialGlobal, type ContactGlobal,
} from '@/lib/globals/types';

type Tab = 'footer' | 'theme' | 'social' | 'contact';

/**
 * Site globals editor — Task 5.1. Covers `footer`, `theme`, `social`, and
 * `contact` (the "site-wide settings" reserved keys). `announcement` is
 * deliberately NOT edited here — it has its own dedicated page
 * (`src/app/(app)/announcements/page.tsx`) per the task brief's explicit
 * separate file listing, since an announcement banner is a more
 * frequently-touched, time-sensitive piece of content (enable/disable,
 * schedule) that benefits from its own focused page rather than living as
 * a fifth tab buried in general site settings. Both pages share the same
 * load/save-by-key helpers (`src/lib/globals/client.ts`) to avoid
 * duplicating the upsert boilerplate.
 *
 * Each tab loads/saves its own `site_globals` row independently (rather
 * than one combined save-all), matching this page's per-tab structure and
 * avoiding accidentally overwriting a key the user hasn't touched yet.
 */
export default function SiteGlobalsPage() {
  const { selectedClientId } = useSelectedClient();
  const [tab, setTab] = useState<Tab>('footer');
  const [loading, setLoading] = useState(true);

  const [footer, setFooter]   = useState<FooterGlobal>(DEFAULT_FOOTER);
  const [theme, setTheme]     = useState<ThemeGlobal>(DEFAULT_THEME);
  const [social, setSocial]   = useState<SocialGlobal>(DEFAULT_SOCIAL);
  const [contact, setContact] = useState<ContactGlobal>(DEFAULT_CONTACT);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const load = useCallback(async () => {
    if (!selectedClientId) { setLoading(false); return; }
    setLoading(true);
    const [f, t, s, c] = await Promise.all([
      loadGlobal<FooterGlobal>(selectedClientId, 'footer', DEFAULT_FOOTER),
      loadGlobal<ThemeGlobal>(selectedClientId, 'theme', DEFAULT_THEME),
      loadGlobal<SocialGlobal>(selectedClientId, 'social', DEFAULT_SOCIAL),
      loadGlobal<ContactGlobal>(selectedClientId, 'contact', DEFAULT_CONTACT),
    ]);
    setFooter(f);
    setTheme(t);
    setSocial(s);
    setContact(c);
    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function handleSave() {
    if (!selectedClientId) return;
    setSaving(true);
    setSaved(false);
    setError('');
    const value = tab === 'footer' ? footer : tab === 'theme' ? theme : tab === 'social' ? social : contact;
    const err = await saveGlobal(selectedClientId, tab, value);
    setSaving(false);
    if (err) { setError(err); return; }
    // No publish/unpublish transition exists for globals (there's no
    // draft state to promote from) — every successful save here is
    // `content.updated`. `entityId`/`slug` use the `site_globals` key
    // (footer/theme/social/contact) since there's no separate row id
    // tracked in this component — `(client_id, key)` is the natural
    // identity for a globals row.
    firePublishNotify({ clientId: selectedClientId, event: 'content.updated', entityType: 'site_globals', entityId: tab, slug: tab });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // ── Footer link list helpers ──
  function updateFooterLink(i: number, patch: Partial<{ label: string; href: string }>) {
    setFooter((prev) => ({ ...prev, links: prev.links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
    setSaved(false);
  }
  function addFooterLink() {
    setFooter((prev) => ({ ...prev, links: [...prev.links, { label: '', href: '' }] }));
    setSaved(false);
  }
  function removeFooterLink(i: number) {
    setFooter((prev) => ({ ...prev, links: prev.links.filter((_, idx) => idx !== i) }));
    setSaved(false);
  }

  // ── Theme token key/value list helpers ──
  const themeEntries = Object.entries(theme.tokens);
  function updateThemeEntry(i: number, key: string, val: string) {
    setTheme((prev) => {
      const entries = Object.entries(prev.tokens);
      entries[i] = [key, val];
      return { tokens: Object.fromEntries(entries) };
    });
    setSaved(false);
  }
  function addThemeEntry() {
    setTheme((prev) => {
      let n = 1;
      let key = '--token-1';
      while (key in prev.tokens) { n += 1; key = `--token-${n}`; }
      return { tokens: { ...prev.tokens, [key]: '' } };
    });
    setSaved(false);
  }
  function removeThemeEntry(key: string) {
    setTheme((prev) => {
      const next = { ...prev.tokens };
      delete next[key];
      return { tokens: next };
    });
    setSaved(false);
  }

  // ── Social key/value list helpers ──
  const socialEntries = Object.entries(social);
  function updateSocialEntry(i: number, key: string, val: string) {
    setSocial((prev) => {
      const entries = Object.entries(prev);
      entries[i] = [key, val];
      return Object.fromEntries(entries);
    });
    setSaved(false);
  }
  function addSocialEntry() {
    setSocial((prev) => {
      let n = 1;
      let key = 'platform-1';
      while (key in prev) { n += 1; key = `platform-${n}`; }
      return { ...prev, [key]: '' };
    });
    setSaved(false);
  }
  function removeSocialEntry(key: string) {
    setSocial((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSaved(false);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid var(--border)',
    borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)',
  };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 };
  const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 };
  const iconBtnDanger: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', padding: 6, flexShrink: 0 };

  const TAB_STYLES = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 13, fontWeight: active ? 700 : 500,
    color: active ? 'var(--ne-blue)' : 'var(--fg2)',
    background: 'none', border: 'none', borderBottom: active ? '2px solid var(--ne-blue)' : '2px solid transparent',
    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  });

  if (loading) return (
    <>
      <Topbar title="Site Globals" />
      <div className="page-body" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );

  return (
    <>
      <Topbar title="Site Globals" subtitle="Footer, theme, social links, and contact info" />
      <div className="page-body" style={{ maxWidth: 760 }}>

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

            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 0, overflowX: 'auto' }}>
              {([
                ['footer',  'Footer',  PanelBottom],
                ['theme',   'Theme',   Palette],
                ['social',  'Social',  Share2],
                ['contact', 'Contact', Phone],
              ] as [Tab, string, React.ElementType][]).map(([key, label, Icon]) => (
                <button key={key} style={TAB_STYLES(tab === key)} onClick={() => setTab(key)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon size={13} />{label}
                  </span>
                </button>
              ))}
            </div>

            {/* ── Footer ── */}
            {tab === 'footer' && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>Footer</div>
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Copyright / tagline text</label>
                    <input
                      value={footer.text}
                      onChange={(e) => { setFooter({ ...footer, text: e.target.value }); setSaved(false); }}
                      placeholder="© 2026 Acme Corp. All rights reserved."
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ ...labelStyle, marginBottom: 0 }}>Footer links</label>
                      <button className="btn-outline-ne" style={{ fontSize: 11.5, padding: '5px 10px' }} onClick={addFooterLink}>
                        <Plus size={12} /> Add link
                      </button>
                    </div>
                    {footer.links.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>No footer links yet (e.g. Privacy Policy, Terms).</div>
                    ) : footer.links.map((link, i) => (
                      <div key={i} style={rowStyle}>
                        <input
                          value={link.label}
                          onChange={(e) => updateFooterLink(i, { label: e.target.value })}
                          placeholder="Label (e.g. Privacy Policy)"
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <input
                          value={link.href}
                          onChange={(e) => updateFooterLink(i, { href: e.target.value })}
                          placeholder="/privacy"
                          style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }}
                        />
                        <button onClick={() => removeFooterLink(i)} style={iconBtnDanger} aria-label={`Remove footer link ${i + 1}`}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Theme ── */}
            {tab === 'theme' && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Theme tokens</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>Free-form CSS custom-property overrides a client site can apply (e.g. <code>--brand-primary</code>).</div>
                </div>
                <div style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <button className="btn-outline-ne" style={{ fontSize: 11.5, padding: '5px 10px' }} onClick={addThemeEntry}>
                      <Plus size={12} /> Add token
                    </button>
                  </div>
                  {themeEntries.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>No theme tokens yet.</div>
                  ) : themeEntries.map(([key, val], i) => (
                    <div key={i} style={rowStyle}>
                      <input
                        value={key}
                        onChange={(e) => updateThemeEntry(i, e.target.value, val)}
                        placeholder="--brand-primary"
                        style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }}
                      />
                      <input
                        value={val}
                        onChange={(e) => updateThemeEntry(i, key, e.target.value)}
                        placeholder="#1E40AF"
                        style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }}
                      />
                      <button onClick={() => removeThemeEntry(key)} style={iconBtnDanger} aria-label={`Remove token ${key}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Social ── */}
            {tab === 'social' && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Social links</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>Platform name to URL — add any platform your client needs.</div>
                </div>
                <div style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <button className="btn-outline-ne" style={{ fontSize: 11.5, padding: '5px 10px' }} onClick={addSocialEntry}>
                      <Plus size={12} /> Add platform
                    </button>
                  </div>
                  {socialEntries.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>No social links yet.</div>
                  ) : socialEntries.map(([key, val], i) => (
                    <div key={i} style={rowStyle}>
                      <input
                        value={key}
                        onChange={(e) => updateSocialEntry(i, e.target.value, val)}
                        placeholder="instagram"
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <input
                        value={val}
                        onChange={(e) => updateSocialEntry(i, key, e.target.value)}
                        placeholder="https://instagram.com/acme"
                        style={{ ...inputStyle, flex: 2, fontFamily: 'monospace' }}
                      />
                      <button onClick={() => removeSocialEntry(key)} style={iconBtnDanger} aria-label={`Remove ${key}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Contact ── */}
            {tab === 'contact' && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>Contact info</div>
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input
                      value={contact.email ?? ''}
                      onChange={(e) => { setContact({ ...contact, email: e.target.value }); setSaved(false); }}
                      placeholder="hello@acme.com"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Phone</label>
                    <input
                      value={contact.phone ?? ''}
                      onChange={(e) => { setContact({ ...contact, phone: e.target.value }); setSaved(false); }}
                      placeholder="+65 6123 4567"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Address</label>
                    <input
                      value={contact.address ?? ''}
                      onChange={(e) => { setContact({ ...contact, address: e.target.value }); setSaved(false); }}
                      placeholder="1 Raffles Place, Singapore"
                      style={inputStyle}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
