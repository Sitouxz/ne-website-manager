'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Send, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useCollection, useCollectionItem } from '@/lib/collections/useCollection';
import { createItem, updateItem } from '@/lib/collections/adapter';
import { defaultValueFor } from '@/components/collections/FieldRenderer';
import FieldRenderer from '@/components/collections/FieldRenderer';
import { slugify } from '@/lib/collections/slugify';
import type { Collection } from '@/lib/supabase/types';

function buildEmptyForm(def: Collection): Record<string, unknown> {
  const form: Record<string, unknown> = { slug: '', status: def.options.statusValues[0] };
  for (const field of def.fields) form[field.key] = defaultValueFor(field);
  return form;
}

export default function CollectionItemEditor({ params }: { params: Promise<{ collection: string; id: string }> }) {
  const { collection: slug, id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();

  const { def, clientId, isAdmin, loading: defLoading } = useCollection(slug);
  const { item, loading: itemLoading } = useCollectionItem(def, id);

  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function apply() {
      if (!def) return;
      if (isNew) { setForm(buildEmptyForm(def)); return; }
      if (item) setForm({ ...buildEmptyForm(def), ...item });
    }
    apply();
  }, [def, item, isNew]);

  const loading = defLoading || itemLoading || !form;

  if (loading) {
    return (
      <>
        <Topbar title="Loading..." />
        <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </>
    );
  }

  if (!def) {
    return (
      <>
        <Topbar title="Not found" />
        <div className="page-body">
          <p style={{ color: 'var(--fg3)', fontSize: 13.5 }}>No collection named &ldquo;{slug}&rdquo; exists for this client.</p>
        </div>
      </>
    );
  }

  const set = (key: string, value: unknown) => setForm((f) => ({ ...(f as Record<string, unknown>), [key]: value }));
  const titleField = def.fields.find((f) => f.key === def.options.titleField);

  async function handleSave(statusOverride?: string) {
    if (!clientId) { setError('No client linked. Select a client in the sidebar first.'); return; }
    if (!form) return;
    setSaving(true); setError('');

    const payload = {
      ...form,
      slug: (form.slug as string) || slugify(String(form[def!.options.titleField] ?? '')) || 'untitled',
      status: statusOverride ?? form.status,
    };

    const supabase = createClient();
    if (isNew) {
      const { data, error: err } = await createItem(supabase, def!, clientId, payload);
      if (err) { setError(err); setSaving(false); return; }
      setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
      if (data) router.replace(`/cms/c/${slug}/${data.id}`);
    } else {
      const { error: err } = await updateItem(supabase, def!, id, payload);
      if (err) { setError(err); setSaving(false); return; }
      if (statusOverride) set('status', statusOverride);
      setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', padding: '18px 20px',
  };

  const otherFields = def.fields.filter((f) => f.key !== titleField?.key);

  return (
    <>
      <Topbar
        title={isNew ? `New ${def.name_singular}` : `Edit ${def.name_singular}`}
        subtitle={isNew ? `Add a new ${def.name_singular.toLowerCase()}` : String(form![def.options.titleField] ?? '(Untitled)')}
      />
      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Link href={`/cms/c/${slug}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to {def.name}
          </Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isAdmin && isNew && !clientId && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>Select a client in the sidebar first.</div>}
            {error && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>{error}</div>}
            {saved && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-success)', padding: '8px 14px', background: '#DCFCE7', borderRadius: 'var(--r-sm)' }}>Saved</div>}
            <button className="btn-ne" onClick={() => handleSave(def.options.statusValues[def.options.statusValues.length - 1])} disabled={saving}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Send size={14} />}
              {form!.status === def.options.statusValues[0] ? `Publish ${def.name_singular}` : 'Update'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {titleField && (
              <div style={cardStyle}>
                <input
                  value={(form![titleField.key] as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...(f as Record<string, unknown>), [titleField.key]: e.target.value, slug: slugify(e.target.value) }))}
                  placeholder={`${def.name_singular} ${titleField.label.toLowerCase()}...`}
                  style={{ width: '100%', padding: '14px 16px', border: 'none', outline: 'none', fontSize: 20, fontWeight: 700, color: 'var(--fg1)', background: 'transparent' }}
                />
                <div style={{ padding: '0 16px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg3)', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                  <span>Slug:</span>
                  <input value={(form!.slug as string) ?? ''} onChange={(e) => set('slug', e.target.value)}
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--ne-blue)', fontFamily: 'monospace' }} />
                </div>
              </div>
            )}

            <div style={cardStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {otherFields.map((field) => (
                  <FieldRenderer
                    key={field.key}
                    field={field}
                    value={form![field.key]}
                    onChange={(v) => set(field.key, v)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Settings</div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Status</label>
                  <select
                    value={(form!.status as string) ?? def.options.statusValues[0]}
                    onChange={(e) => set('status', e.target.value)}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)', outline: 'none', cursor: 'pointer' }}
                  >
                    {def.options.statusValues.map((s) => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <button className="btn-ne" style={{ width: '100%', justifyContent: 'center' }} onClick={() => handleSave()} disabled={saving}>
                  <Save size={14} /> Save {def.name_singular}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
