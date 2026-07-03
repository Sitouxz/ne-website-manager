'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { use, useState, useEffect } from 'react';
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Loader2, Save, CheckCircle, ShieldAlert,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Collection } from '@/lib/supabase/types';
import type { FieldDef, FieldType } from '@/lib/collections/types';
import { validateFieldDefs } from '@/lib/collections/validate';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text',        label: 'Text' },
  { value: 'textarea',    label: 'Textarea' },
  { value: 'richtext',    label: 'Rich Text' },
  { value: 'number',      label: 'Number' },
  { value: 'boolean',     label: 'Boolean' },
  { value: 'date',        label: 'Date' },
  { value: 'select',      label: 'Select' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'image',       label: 'Image' },
  { value: 'gallery',     label: 'Gallery' },
  { value: 'url',         label: 'URL' },
  { value: 'email',       label: 'Email' },
  { value: 'json',        label: 'JSON' },
];

const slugifyKey = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Schema builder — Task 4.2. Supports add / remove / reorder of `FieldDef`s
 * plus a "title field" selector; deliberately does NOT support in-place
 * editing of an existing field's type/options (the brief's field-builder
 * list is add/remove/reorder only) — fixing a mistake on an existing field
 * means remove + re-add, which is an acceptable trade for the scope of this
 * task. Reorder uses simple up/down buttons rather than drag-and-drop, to
 * avoid pulling in a DnD library for what the brief calls a "nice to have."
 *
 * `ne_admin`-only, gated client-side by loading `profiles.role` the same
 * way `src/app/(app)/settings/page.tsx` and `src/app/(app)/cms/pages/[id]/page.tsx`
 * do. This is a UX nicety, not the real security boundary: RLS on
 * `collections` (see `supabase/migrations/008_restrict_collections_writes.sql`)
 * restricts INSERT/UPDATE/DELETE to `is_ne_admin() OR (client_id =
 * my_client_id() AND role = 'client_admin')`, explicitly excluding plain
 * `editor` — so a non-admin's actual DB writes are blocked regardless of
 * what this page renders. Reads remain open to any authenticated user of
 * the client (`client_id = my_client_id() OR is_ne_admin()`), matching the
 * collections list page's intentionally broader visibility.
 */
export default function CollectionSchemaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [loading,      setLoading]      = useState(true);
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin,      setIsAdmin]      = useState(false);
  const [collection,   setCollection]   = useState<Collection | null>(null);

  const [fields,     setFields]     = useState<FieldDef[]>([]);
  const [titleField, setTitleField] = useState('');

  const [saving,      setSaving]      = useState(false);
  const [saved,        setSaved]       = useState(false);
  const [saveErrors,  setSaveErrors]  = useState<string[]>([]);

  const [showAddField,     setShowAddField]     = useState(false);
  const [fieldLabel,       setFieldLabel]       = useState('');
  const [fieldKey,         setFieldKey]         = useState('');
  const [keyTouched,       setKeyTouched]       = useState(false);
  const [fieldType,        setFieldType]        = useState<FieldType>('text');
  const [fieldRequired,    setFieldRequired]    = useState(false);
  const [fieldOptionsText, setFieldOptionsText] = useState('');
  const [fieldHelp,        setFieldHelp]        = useState('');
  const [addFieldError,    setAddFieldError]    = useState('');

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); setAdminChecked(true); return; }

      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      const admin = profile?.role === 'ne_admin';
      setIsAdmin(admin);
      setAdminChecked(true);

      if (!admin) { setLoading(false); return; }

      const { data: coll } = await supabase.from('collections').select('*').eq('id', id).single();
      if (coll) {
        const c = coll as Collection;
        setCollection(c);
        setFields(c.fields ?? []);
        setTitleField(c.options?.title_field ?? '');
      }
      setLoading(false);
    }
    load();
  }, [id]);

  function resetAddForm() {
    setFieldLabel('');
    setFieldKey('');
    setKeyTouched(false);
    setFieldType('text');
    setFieldRequired(false);
    setFieldOptionsText('');
    setFieldHelp('');
    setAddFieldError('');
    setShowAddField(false);
  }

  function handleLabelChange(value: string) {
    setFieldLabel(value);
    if (!keyTouched) setFieldKey(slugifyKey(value));
  }

  function handleAddField() {
    const label = fieldLabel.trim();
    const key = fieldKey.trim();

    if (!label) { setAddFieldError('Label is required.'); return; }
    if (!key) { setAddFieldError('Key is required.'); return; }
    if (fields.some((f) => f.key === key)) { setAddFieldError(`Key "${key}" is already used by another field.`); return; }

    let options: string[] | undefined;
    if (fieldType === 'select' || fieldType === 'multiselect') {
      options = fieldOptionsText.split('\n').map((s) => s.trim()).filter(Boolean);
      if (options.length === 0) { setAddFieldError('At least one option is required for select / multi-select fields.'); return; }
    }

    const newField: FieldDef = {
      key,
      label,
      type: fieldType,
      required: fieldRequired,
      options,
      help: fieldHelp.trim() || undefined,
    };
    setFields((prev) => [...prev, newField]);
    setSaveErrors([]);
    setSaved(false);
    resetAddForm();
  }

  function handleRemoveField(key: string) {
    setFields((prev) => prev.filter((f) => f.key !== key));
    if (titleField === key) setTitleField('');
    setSaveErrors([]);
    setSaved(false);
  }

  function moveField(index: number, dir: -1 | 1) {
    setFields((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    if (!collection) return;
    const result = validateFieldDefs(fields);
    if (!result.ok) { setSaveErrors(result.errors); setSaved(false); return; }

    setSaveErrors([]);
    setSaving(true);
    const supabase = createClient();
    const options = { ...collection.options, title_field: titleField || undefined };
    const { error } = await supabase.from('collections').update({ fields, options }).eq('id', collection.id);
    setSaving(false);

    if (error) { setSaveErrors([error.message]); return; }
    setCollection({ ...collection, fields, options });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading || !adminChecked) {
    return (
      <>
        <Topbar title="Collection Schema" />
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <Topbar title="Collection Schema" />
        <div className="page-body">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '64px 24px', color: 'var(--fg3)' }}>
            <ShieldAlert size={28} color="var(--ne-danger)" />
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg1)' }}>Not authorized</div>
            <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 360 }}>
              Only NE admins can build or edit a collection&apos;s schema.
            </div>
            <Link href="/cms/collections" className="btn-outline-ne" style={{ marginTop: 8 }}>
              <ArrowLeft size={14} /> Back to Collections
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (!collection) {
    return (
      <>
        <Topbar title="Collection Schema" />
        <div className="page-body">
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--fg3)' }}>
            Collection not found.
            <div style={{ marginTop: 16 }}>
              <Link href="/cms/collections" className="btn-outline-ne">
                <ArrowLeft size={14} /> Back to Collections
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (collection.storage !== 'generic' || collection.client_id === null) {
    return (
      <>
        <Topbar title={collection.name} subtitle="Collection Schema" />
        <div className="page-body">
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--fg3)' }}>
            Schema editing isn&apos;t available for {collection.client_id === null ? 'global/system' : 'native'} collections.
            <div style={{ marginTop: 16 }}>
              <Link href="/cms/collections" className="btn-outline-ne">
                <ArrowLeft size={14} /> Back to Collections
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title={collection.name} subtitle={`Schema · /${collection.slug}`} />
      <div className="page-body">
        <Link href="/cms/collections" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500, marginBottom: 20, width: 'fit-content' }}>
          <ArrowLeft size={14} /> Back to Collections
        </Link>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>

          {saveErrors.length > 0 && (
            <div style={{ padding: '12px 16px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Fix the following before saving:</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {saveErrors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          {/* Fields */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Fields</div>
              <button className="btn-ne" onClick={() => setShowAddField((v) => !v)}>
                <Plus size={14} /> Add Field
              </button>
            </div>

            {showAddField && (
              <div style={{ padding: 20, borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {addFieldError && (
                  <div style={{ padding: '8px 12px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 12.5 }}>
                    {addFieldError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Label</label>
                    <input
                      value={fieldLabel}
                      onChange={(e) => handleLabelChange(e.target.value)}
                      placeholder="Author name"
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Key</label>
                    <input
                      value={fieldKey}
                      onChange={(e) => { setFieldKey(e.target.value); setKeyTouched(true); }}
                      placeholder="author_name"
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--ne-blue)', fontFamily: 'monospace' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Type</label>
                    <select
                      value={fieldType}
                      onChange={(e) => setFieldType(e.target.value as FieldType)}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}
                    >
                      {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg2)', paddingBottom: 9 }}>
                    <input type="checkbox" checked={fieldRequired} onChange={(e) => setFieldRequired(e.target.checked)} />
                    Required
                  </label>
                </div>
                {(fieldType === 'select' || fieldType === 'multiselect') && (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Options (one per line)</label>
                    <textarea
                      value={fieldOptionsText}
                      onChange={(e) => setFieldOptionsText(e.target.value)}
                      rows={3}
                      placeholder={'Option A\nOption B'}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace', resize: 'vertical' }}
                    />
                  </div>
                )}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Help text (optional)</label>
                  <input
                    value={fieldHelp}
                    onChange={(e) => setFieldHelp(e.target.value)}
                    placeholder="Shown beneath the field in the entry editor"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ne" onClick={handleAddField}>
                    <Plus size={14} /> Add
                  </button>
                  <button className="btn-outline-ne" onClick={resetAddForm}>Cancel</button>
                </div>
              </div>
            )}

            {fields.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>
                No fields yet. Add your first field above.
              </div>
            ) : (
              <div>
                {fields.map((f, i) => (
                  <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <button
                        onClick={() => moveField(i, -1)}
                        disabled={i === 0}
                        style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--border)' : 'var(--fg3)', padding: 2 }}
                        aria-label="Move up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => moveField(i, 1)}
                        disabled={i === fields.length - 1}
                        style={{ background: 'none', border: 'none', cursor: i === fields.length - 1 ? 'default' : 'pointer', color: i === fields.length - 1 ? 'var(--border)' : 'var(--fg3)', padding: 2 }}
                        aria-label="Move down"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg1)' }}>{f.label}</span>
                        <code style={{ fontSize: 11, color: 'var(--fg3)' }}>{f.key}</code>
                        <span style={{ fontSize: 11, background: 'var(--surface-3)', padding: '2px 7px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 500 }}>
                          {FIELD_TYPES.find((t) => t.value === f.type)?.label ?? f.type}
                        </span>
                        {f.required && (
                          <span style={{ fontSize: 11, color: 'var(--ne-danger)', fontWeight: 600 }}>Required</span>
                        )}
                        {titleField === f.key && (
                          <span style={{ fontSize: 11, color: 'var(--ne-blue)', fontWeight: 600 }}>Title field</span>
                        )}
                      </div>
                      {f.help && <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>{f.help}</div>}
                      {(f.type === 'select' || f.type === 'multiselect') && f.options && f.options.length > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>Options: {f.options.join(', ')}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveField(f.key)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', padding: 6, flexShrink: 0 }}
                      aria-label={`Remove ${f.label}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Title field */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Title field</div>
            <div style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 12 }}>
              Which field&apos;s value should be shown as each entry&apos;s display name in the entry list.
            </div>
            <select
              value={titleField}
              onChange={(e) => { setTitleField(e.target.value); setSaved(false); }}
              disabled={fields.length === 0}
              style={{ width: '100%', maxWidth: 320, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--fg1)', background: fields.length === 0 ? 'var(--surface-2)' : 'var(--surface)' }}
            >
              <option value="">— none —</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label} ({f.key})</option>)}
            </select>
          </div>

          {/* Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn-ne" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
              Save Schema
            </button>
            {saved && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ne-success)' }}>
                <CheckCircle size={13} /> Saved
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
