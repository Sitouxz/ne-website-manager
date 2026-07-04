'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Loader2, Save, CheckCircle, X, Inbox, Mail,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import type { Form } from '@/lib/supabase/types';
import type { FieldDef, FieldType } from '@/lib/collections/types';
import { validateFieldDefs } from '@/lib/collections/validate';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text',        label: 'Text' },
  { value: 'textarea',    label: 'Textarea' },
  { value: 'number',      label: 'Number' },
  { value: 'boolean',     label: 'Boolean' },
  { value: 'date',        label: 'Date' },
  { value: 'select',      label: 'Select' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'url',         label: 'URL' },
  { value: 'email',       label: 'Email' },
];

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const slugifyKey = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 };

/**
 * Forms & Leads — Task 5.2. Combines the forms list, a "New Form" flow, and
 * an inline field-builder (matching the collections schema-builder pattern
 * in `src/app/(app)/cms/collections/[id]/schema/page.tsx`, Task 4.2) into
 * one page per the brief's explicit file listing — unlike collections,
 * there's no separate `/forms/[id]/schema` route; selecting a form expands
 * its editor inline below the list. `/forms/[id]` is reserved for the
 * submissions inbox instead (a different concern from schema editing).
 *
 * No admin-only gate (unlike the collections schema builder): forms are
 * everyday editorial/marketing content, not schema-sensitive the way
 * `collections.fields` is — `forms_authenticated` RLS (migration
 * 010_forms.sql) already allows any authenticated user of the client to
 * write, matching `site_globals`/`menu_items`'s broader policy (see that
 * migration's header comment for the full reasoning).
 */
export default function FormsPage() {
  const { selectedClientId } = useSelectedClient();

  const [forms,   setForms]   = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName,       setNewName]       = useState('');
  const [newSlug,       setNewSlug]       = useState('');
  const [slugTouched,   setSlugTouched]   = useState(false);
  const [creating,      setCreating]      = useState(false);
  const [createError,   setCreateError]   = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchForms = useCallback(async () => {
    if (!selectedClientId) { setForms([]); setLoading(false); return; }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('forms')
      .select('*')
      .eq('client_id', selectedClientId)
      .order('created_at', { ascending: false });
    setForms((data ?? []) as Form[]);
    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => fetchForms(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchForms]);

  function handleNameChange(value: string) {
    setNewName(value);
    if (!slugTouched) setNewSlug(slugify(value));
  }

  function closeNewDialog() {
    setShowNewDialog(false);
    setNewName('');
    setNewSlug('');
    setSlugTouched(false);
    setCreateError('');
  }

  async function handleCreate() {
    setCreateError('');
    const name = newName.trim();
    const slug = newSlug.trim();
    if (!name) { setCreateError('Name is required.'); return; }
    if (!slug) { setCreateError('Slug is required.'); return; }
    if (!selectedClientId) { setCreateError('Select a client in the sidebar first.'); return; }

    setCreating(true);
    const supabase = createClient();
    const { data: created, error } = await supabase
      .from('forms')
      .insert({
        client_id: selectedClientId,
        name,
        slug,
        fields: [],
        notify_emails: [],
        honeypot_field: 'website',
      })
      .select()
      .single();
    setCreating(false);

    if (error) { setCreateError(error.message); return; }
    closeNewDialog();
    await fetchForms();
    setEditingId((created as Form).id);
  }

  async function handleDelete(form: Form) {
    if (!window.confirm(`Delete "${form.name}"? This also deletes all of its submissions.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from('forms').delete().eq('id', form.id);
    if (error) { window.alert(error.message); return; }
    if (editingId === form.id) setEditingId(null);
    await fetchForms();
  }

  return (
    <>
      <Topbar title="Forms & Leads" subtitle={`${forms.length} forms`} />
      <div className="page-body">
        {!selectedClientId ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 32, color: 'var(--fg3)', fontSize: 13.5 }}>
            Select a client in the sidebar first.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 20 }}>
              <button className="btn-ne" onClick={() => setShowNewDialog(true)}>
                <Plus size={15} /> New Form
              </button>
            </div>

            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20 }}>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 20 }}>Form</th>
                      <th>Fields</th>
                      <th style={{ width: 220 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={3} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /> Loading...
                          </div>
                        </td>
                      </tr>
                    ) : forms.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                          No forms yet. Create your first one!
                        </td>
                      </tr>
                    ) : forms.map((f) => (
                      <tr key={f.id}>
                        <td style={{ paddingLeft: 20 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Mail size={14} color="var(--fg3)" />
                            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg1)' }}>{f.name}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 2 }}>/{f.slug}</div>
                        </td>
                        <td style={{ color: 'var(--fg2)', fontSize: 13 }}>{f.fields?.length ?? 0}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <Link href={`/forms/${f.id}`} className="btn-outline-ne" style={{ fontSize: 11.5, padding: '5px 10px' }}>
                              <Inbox size={12} /> Submissions
                            </Link>
                            <button
                              className="btn-outline-ne"
                              style={{ fontSize: 11.5, padding: '5px 10px' }}
                              onClick={() => setEditingId(editingId === f.id ? null : f.id)}
                            >
                              {editingId === f.id ? 'Close' : 'Edit'}
                            </button>
                            <button
                              onClick={() => handleDelete(f)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', padding: 6 }}
                              aria-label={`Delete ${f.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {editingId && (
              <FormEditor
                // `key={editingId}` forces a fresh mount (and fresh
                // useState initial values from `form`) whenever the user
                // switches which form they're editing, instead of an
                // effect that re-syncs local state on prop change — avoids
                // the "setState synchronously within an effect" anti-pattern
                // for what is otherwise just per-form initial state.
                key={editingId}
                form={forms.find((f) => f.id === editingId)!}
                onSaved={(updated) => {
                  setForms((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
                }}
              />
            )}
          </>
        )}
      </div>

      {showNewDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '28px 32px', width: 440, boxShadow: '0 16px 48px rgba(0,0,0,.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>New Form</div>
              <button onClick={closeNewDialog} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {createError && (
                <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
                  {createError}
                </div>
              )}
              <div>
                <label style={labelStyle}>Name</label>
                <input
                  value={newName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Contact Us"
                  autoFocus
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Slug</label>
                <input
                  value={newSlug}
                  onChange={(e) => { setNewSlug(e.target.value); setSlugTouched(true); }}
                  placeholder="contact"
                  style={{ ...inputStyle, color: 'var(--ne-blue)', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-ne" style={{ flex: 1, justifyContent: 'center' }} onClick={handleCreate} disabled={creating}>
                  {creating ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Plus size={14} />}
                  Create
                </button>
                <button className="btn-outline-ne" onClick={closeNewDialog}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

/**
 * Inline field-builder + settings editor for one form, matching the
 * collections schema builder's add/remove/reorder-via-up/down-buttons
 * pattern (Task 4.2). Deliberately no in-place editing of an existing
 * field's type/options — same trade-off as the collections builder: fixing
 * a mistake means remove + re-add.
 */
function FormEditor({ form, onSaved }: { form: Form; onSaved: (updated: Form) => void }) {
  const [fields, setFields] = useState<FieldDef[]>(form.fields ?? []);
  const [honeypotField, setHoneypotField] = useState(form.honeypot_field || 'website');
  const [notifyEmails, setNotifyEmails] = useState<string[]>(form.notify_emails ?? []);

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  const [showAddField,     setShowAddField]     = useState(false);
  const [fieldLabel,       setFieldLabel]       = useState('');
  const [fieldKey,         setFieldKey]         = useState('');
  const [keyTouched,       setKeyTouched]       = useState(false);
  const [fieldType,        setFieldType]        = useState<FieldType>('text');
  const [fieldRequired,    setFieldRequired]    = useState(false);
  const [fieldOptionsText, setFieldOptionsText] = useState('');
  const [addFieldError,    setAddFieldError]    = useState('');

  function resetAddForm() {
    setFieldLabel('');
    setFieldKey('');
    setKeyTouched(false);
    setFieldType('text');
    setFieldRequired(false);
    setFieldOptionsText('');
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

    const newField: FieldDef = { key, label, type: fieldType, required: fieldRequired, options };
    setFields((prev) => [...prev, newField]);
    setSaveErrors([]);
    setSaved(false);
    resetAddForm();
  }

  function handleRemoveField(key: string) {
    setFields((prev) => prev.filter((f) => f.key !== key));
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

  function updateEmail(i: number, value: string) {
    setNotifyEmails((prev) => prev.map((e, idx) => (idx === i ? value : e)));
    setSaved(false);
  }
  function addEmail() {
    setNotifyEmails((prev) => [...prev, '']);
    setSaved(false);
  }
  function removeEmail(i: number) {
    setNotifyEmails((prev) => prev.filter((_, idx) => idx !== i));
    setSaved(false);
  }

  async function handleSave() {
    // The honeypot field name is a separate anti-spam mechanism, not a real
    // FieldDef (see migration 010_forms.sql) — so it's fine (expected, even)
    // for it to collide with nothing in `fields`; no cross-validation needed
    // between the two here.
    const result = validateFieldDefs(fields);
    if (!result.ok) { setSaveErrors(result.errors); setSaved(false); return; }
    if (!honeypotField.trim()) { setSaveErrors(['Honeypot field name must not be empty.']); return; }

    setSaveErrors([]);
    setSaving(true);
    const supabase = createClient();
    const cleanedEmails = notifyEmails.map((e) => e.trim()).filter(Boolean);
    const { data: updated, error } = await supabase
      .from('forms')
      .update({ fields, honeypot_field: honeypotField.trim(), notify_emails: cleanedEmails })
      .eq('id', form.id)
      .select()
      .single();
    setSaving(false);

    if (error) { setSaveErrors([error.message]); return; }
    setNotifyEmails(cleanedEmails);
    onSaved(updated as Form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Editing &quot;{form.name}&quot;</div>

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
                <label style={labelStyle}>Label</label>
                <input value={fieldLabel} onChange={(e) => handleLabelChange(e.target.value)} placeholder="Full name" style={inputStyle} />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={labelStyle}>Key</label>
                <input
                  value={fieldKey}
                  onChange={(e) => { setFieldKey(e.target.value); setKeyTouched(true); }}
                  placeholder="full_name"
                  style={{ ...inputStyle, color: 'var(--ne-blue)', fontFamily: 'monospace' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={labelStyle}>Type</label>
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value as FieldType)}
                  style={{ ...inputStyle, background: 'var(--surface)' }}
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
                <label style={labelStyle}>Options (one per line)</label>
                <textarea
                  value={fieldOptionsText}
                  onChange={(e) => setFieldOptionsText(e.target.value)}
                  rows={3}
                  placeholder={'Option A\nOption B'}
                  style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ne" onClick={handleAddField}><Plus size={14} /> Add</button>
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
                  <button onClick={() => moveField(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--border)' : 'var(--fg3)', padding: 2 }} aria-label="Move up">
                    <ChevronUp size={14} />
                  </button>
                  <button onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} style={{ background: 'none', border: 'none', cursor: i === fields.length - 1 ? 'default' : 'pointer', color: i === fields.length - 1 ? 'var(--border)' : 'var(--fg3)', padding: 2 }} aria-label="Move down">
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
                    {f.required && <span style={{ fontSize: 11, color: 'var(--ne-danger)', fontWeight: 600 }}>Required</span>}
                    {f.key === honeypotField && <span style={{ fontSize: 11, color: 'var(--ne-danger)', fontWeight: 600 }}>⚠ Same as honeypot key</span>}
                  </div>
                  {(f.type === 'select' || f.type === 'multiselect') && f.options && f.options.length > 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>Options: {f.options.join(', ')}</div>
                  )}
                </div>
                <button onClick={() => handleRemoveField(f.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', padding: 6, flexShrink: 0 }} aria-label={`Remove ${f.label}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Honeypot + notify emails */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>Honeypot field name</label>
          <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 8 }}>
            The client site should render an input with this name hidden (off-screen/opacity-0) to real visitors. Real submitters leave it blank; bots that autofill every field trip it, and the submission is filed as spam instead of a real lead.
          </div>
          <input
            value={honeypotField}
            onChange={(e) => { setHoneypotField(e.target.value); setSaved(false); }}
            placeholder="website"
            style={{ ...inputStyle, maxWidth: 320, fontFamily: 'monospace' }}
          />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Notification emails</label>
            <button className="btn-outline-ne" style={{ fontSize: 11.5, padding: '5px 10px' }} onClick={addEmail}>
              <Plus size={12} /> Add email
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 8 }}>
            Addresses to notify when this form receives a new submission (sending itself is out of scope for this task — this only records who should be notified).
          </div>
          {notifyEmails.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>No notification emails yet.</div>
          ) : notifyEmails.map((email, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input
                value={email}
                onChange={(e) => updateEmail(i, e.target.value)}
                placeholder="staff@acme.com"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={() => removeEmail(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', padding: 6, flexShrink: 0 }} aria-label={`Remove ${email || 'email'}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn-ne" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
          Save Form
        </button>
        {saved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ne-success)' }}>
            <CheckCircle size={13} /> Saved
          </div>
        )}
      </div>
    </div>
  );
}
