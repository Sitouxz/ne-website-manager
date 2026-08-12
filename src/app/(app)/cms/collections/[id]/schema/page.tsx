'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { use, useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, Loader2, Save, CheckCircle, ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Collection, CollectionSortDefault } from '@/lib/supabase/types';
import type { FieldDef, FieldType } from '@/lib/collections/types';
import { validateFieldDefs } from '@/lib/collections/validate';
import { FILTERABLE_TYPES, MAX_LIST_COLUMNS, SORT_LABELS } from '@/lib/collections/display';
import { RESERVED_SEO_KEYS, SEO_DESCRIPTION_KEY, SEO_TITLE_KEY, collectionHasSeoFields } from '@/lib/seo/entries';
import SortableList from '@/components/builder/SortableList';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text',        label: 'Text' },
  { value: 'textarea',    label: 'Textarea' },
  { value: 'richtext',    label: 'Rich Text' },
  { value: 'number',      label: 'Number' },
  { value: 'boolean',     label: 'Boolean' },
  { value: 'date',        label: 'Date' },
  { value: 'select',      label: 'Select' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'taglist',     label: 'Tag list' },
  { value: 'image',       label: 'Image' },
  { value: 'gallery',     label: 'Gallery' },
  { value: 'url',         label: 'URL' },
  { value: 'email',       label: 'Email' },
  { value: 'repeater',    label: 'Repeating group' },
  { value: 'json',        label: 'JSON (advanced)' },
];

/**
 * Types offered for a repeating group's sub-fields. `repeater` is excluded:
 * `validateFieldDefs` permits two levels of nesting so seeded and templated
 * schemas aren't boxed in, but a builder that lets an operator nest groups by
 * hand needs a genuinely recursive editor, and a group inside a group inside
 * a form is not something to hand a client without one. `json` is excluded
 * because a raw JSON textarea inside a repeating row is the least usable
 * control this product can produce.
 */
const SUB_FIELD_TYPES = FIELD_TYPES.filter((t) => t.value !== 'repeater' && t.value !== 'json');

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

  const [fields,      setFields]      = useState<FieldDef[]>([]);
  const [titleField,  setTitleField]  = useState('');
  const [listColumns, setListColumns] = useState<string[]>([]);
  const [listFilters, setListFilters] = useState<string[]>([]);
  const [sortDefault, setSortDefault] = useState<CollectionSortDefault>('manual');

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
  const [fieldGroup,       setFieldGroup]       = useState('');
  const [fieldPrecision,   setFieldPrecision]   = useState('');
  const [fieldPrefix,      setFieldPrefix]      = useState('');
  const [fieldSuffix,      setFieldSuffix]      = useState('');
  const [addFieldError,    setAddFieldError]    = useState('');

  // Sub-schema being assembled for a `repeater` field, plus its own small
  // add-a-sub-field form. Kept flat rather than as a nested component so the
  // whole add-field panel stays one piece of state to reset.
  const [subFields,     setSubFields]     = useState<FieldDef[]>([]);
  const [subLabel,      setSubLabel]      = useState('');
  const [subKey,        setSubKey]        = useState('');
  const [subKeyTouched, setSubKeyTouched] = useState(false);
  const [subType,       setSubType]       = useState<FieldType>('text');
  const [subRequired,   setSubRequired]   = useState(false);
  const [subOptionsText, setSubOptionsText] = useState('');

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
        setListColumns(c.options?.list_columns ?? []);
        setListFilters(c.options?.list_filters ?? []);
        setSortDefault(c.options?.sort_default ?? 'manual');
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
    setFieldGroup('');
    setFieldPrecision('');
    setFieldPrefix('');
    setFieldSuffix('');
    setAddFieldError('');
    resetSubForm();
    setSubFields([]);
    setShowAddField(false);
  }

  function resetSubForm() {
    setSubLabel('');
    setSubKey('');
    setSubKeyTouched(false);
    setSubType('text');
    setSubRequired(false);
    setSubOptionsText('');
  }

  function handleAddSubField() {
    const label = subLabel.trim();
    const key = subKey.trim();
    if (!label) { setAddFieldError('Sub-field label is required.'); return; }
    if (!key) { setAddFieldError('Sub-field key is required.'); return; }
    if (subFields.some((f) => f.key === key)) { setAddFieldError(`Key "${key}" is already used inside this group.`); return; }

    let options: string[] | undefined;
    if (subType === 'select' || subType === 'multiselect') {
      options = subOptionsText.split('\n').map((s) => s.trim()).filter(Boolean);
      if (options.length === 0) { setAddFieldError('At least one option is required for select / multi-select sub-fields.'); return; }
    }

    setSubFields((prev) => [...prev, {
      key,
      label,
      type: subType,
      required: subRequired,
      options,
    }]);
    setAddFieldError('');
    resetSubForm();
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

    if (fieldType === 'repeater' && subFields.length === 0) {
      setAddFieldError('A repeating group needs at least one sub-field.');
      return;
    }

    let format: FieldDef['format'] | undefined;
    if (fieldType === 'number') {
      const precision = fieldPrecision.trim() === '' ? undefined : Number(fieldPrecision);
      if (precision !== undefined && (!Number.isInteger(precision) || precision < 0 || precision > 6)) {
        setAddFieldError('Decimal places must be a whole number from 0 to 6.');
        return;
      }
      const prefix = fieldPrefix.trim() || undefined;
      const suffix = fieldSuffix.trim() || undefined;
      if (precision !== undefined || prefix || suffix) format = { precision, prefix, suffix };
    }

    const newField: FieldDef = {
      key,
      label,
      type: fieldType,
      required: fieldRequired,
      options,
      help: fieldHelp.trim() || undefined,
      group: fieldGroup.trim() || undefined,
      format,
      fields: fieldType === 'repeater' ? subFields : undefined,
    };
    setFields((prev) => [...prev, newField]);
    setSaveErrors([]);
    setSaved(false);
    resetAddForm();
  }

  /**
   * Adds the two reserved SEO fields in one action. The keys are the contract
   * (`src/lib/seo/entries.ts`); typing them by hand is the kind of exact-spelling
   * requirement that quietly never gets met, so the builder offers it as a
   * button and the audit starts working the moment it's used.
   */
  function handleAddSeoFields() {
    const candidates: FieldDef[] = [
      {
        key: SEO_TITLE_KEY,
        label: 'Search title',
        type: 'text' as const,
        group: 'Search',
        help: 'The headline shown on Google. Leave blank to use the entry name.',
      },
      {
        key: SEO_DESCRIPTION_KEY,
        label: 'Search description',
        type: 'textarea' as const,
        group: 'Search',
        help: 'The short summary shown under the headline on Google. Aim for one or two sentences.',
      },
    ];
    const additions = candidates.filter((f) => !fields.some((existing) => existing.key === f.key));

    if (additions.length === 0) return;
    setFields((prev) => [...prev, ...additions]);
    setSaveErrors([]);
    setSaved(false);
  }

  function handleRemoveField(key: string) {
    setFields((prev) => prev.filter((f) => f.key !== key));
    // Drop every reference to the removed field, so the saved options never
    // name a key that no longer exists.
    if (titleField === key) setTitleField('');
    setListColumns((prev) => prev.filter((k) => k !== key));
    setListFilters((prev) => prev.filter((k) => k !== key));
    setSaveErrors([]);
    setSaved(false);
  }

  function reorderFields(next: FieldDef[]) {
    setFields(next);
    setSaved(false);
  }

  async function handleSave() {
    if (!collection) return;
    const result = validateFieldDefs(fields);
    if (!result.ok) { setSaveErrors(result.errors); setSaved(false); return; }

    setSaveErrors([]);
    setSaving(true);
    const supabase = createClient();
    const options = {
      ...collection.options,
      title_field: titleField || undefined,
      list_columns: listColumns.length > 0 ? listColumns : undefined,
      list_filters: listFilters.length > 0 ? listFilters : undefined,
      sort_default: sortDefault === 'manual' ? undefined : sortDefault,
    };
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
        <Topbar title="Fields" />
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Loader2 size={24} color="var(--ne-blue)" className="spin" />
        </div>
        </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <Topbar title="Fields" />
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
        <Topbar title="Fields" />
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
        <Topbar title={collection.name} subtitle="Fields" />
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

  // Offered as autocomplete so an operator reuses "Location" rather than
  // creating "location" and "Location " as two separate editor sections.
  const existingGroups = Array.from(new Set(fields.map((f) => f.group).filter((g): g is string => !!g)));

  const filterableFields = fields.filter((f) => FILTERABLE_TYPES.has(f.type));
  const hasSeoFields = collectionHasSeoFields(fields);

  return (
    <>
      <Topbar title={collection.name} subtitle="What information each entry can hold" />
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
          <div className="panel">
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Fields</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!hasSeoFields && (
                  <button className="btn-outline-ne" onClick={handleAddSeoFields}>
                    <Plus size={14} /> Add search fields
                  </button>
                )}
                <button className="btn-ne" onClick={() => setShowAddField((v) => !v)}>
                  <Plus size={14} /> Add Field
                </button>
              </div>
            </div>
            {!hasSeoFields && (
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 11.5, color: 'var(--fg3)' }}>
                Entries in this collection aren&apos;t checked for search titles and descriptions.
                Add the search fields to include them in the SEO review.
              </div>
            )}

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
                {fieldType === 'number' && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ width: 130 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Decimal places</label>
                      <input
                        value={fieldPrecision}
                        onChange={(e) => setFieldPrecision(e.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 2"
                        style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)' }}
                      />
                    </div>
                    <div style={{ width: 130 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Shown before</label>
                      <input
                        value={fieldPrefix}
                        onChange={(e) => setFieldPrefix(e.target.value)}
                        placeholder="S$"
                        style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)' }}
                      />
                    </div>
                    <div style={{ width: 130 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Shown after</label>
                      <input
                        value={fieldSuffix}
                        onChange={(e) => setFieldSuffix(e.target.value)}
                        placeholder="sqft"
                        style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)' }}
                      />
                    </div>
                  </div>
                )}

                {fieldType === 'repeater' && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', padding: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg2)', marginBottom: 4 }}>What each item contains</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 12 }}>
                      Editors add as many items as they need, and each item has these fields.
                    </div>

                    {subFields.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                        {subFields.map((sf) => (
                          <div key={sf.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg1)' }}>{sf.label}</span>
                            <code style={{ fontSize: 11, color: 'var(--fg3)' }}>{sf.key}</code>
                            <span style={{ fontSize: 11, color: 'var(--fg2)' }}>
                              {SUB_FIELD_TYPES.find((t) => t.value === sf.type)?.label ?? sf.type}
                            </span>
                            {sf.required && <span style={{ fontSize: 11, color: 'var(--ne-danger)', fontWeight: 600 }}>Required</span>}
                            <button
                              onClick={() => setSubFields((prev) => prev.filter((f) => f.key !== sf.key))}
                              aria-label={`Remove ${sf.label}`}
                              style={{ marginLeft: 'auto', width: 32, height: 32, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 5 }}>Label</label>
                        <input
                          value={subLabel}
                          onChange={(e) => {
                            setSubLabel(e.target.value);
                            if (!subKeyTouched) setSubKey(slugifyKey(e.target.value));
                          }}
                          placeholder="Heading"
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)' }}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 5 }}>Key</label>
                        <input
                          value={subKey}
                          onChange={(e) => { setSubKey(e.target.value); setSubKeyTouched(true); }}
                          placeholder="heading"
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 12.5, outline: 'none', color: 'var(--ne-blue)', fontFamily: 'monospace' }}
                        />
                      </div>
                      <div style={{ width: 140 }}>
                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 5 }}>Type</label>
                        <select
                          value={subType}
                          onChange={(e) => setSubType(e.target.value as FieldType)}
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 12.5, color: 'var(--fg1)', background: 'var(--surface)' }}
                        >
                          {SUB_FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--fg2)', paddingBottom: 9 }}>
                        <input type="checkbox" checked={subRequired} onChange={(e) => setSubRequired(e.target.checked)} />
                        Required
                      </label>
                      <button className="btn-outline-ne" onClick={handleAddSubField} style={{ marginBottom: 1 }}>
                        <Plus size={13} /> Add
                      </button>
                    </div>

                    {(subType === 'select' || subType === 'multiselect') && (
                      <div style={{ marginTop: 10 }}>
                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 5 }}>Options (one per line)</label>
                        <textarea
                          value={subOptionsText}
                          onChange={(e) => setSubOptionsText(e.target.value)}
                          rows={3}
                          placeholder={'Option A\nOption B'}
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 12.5, outline: 'none', color: 'var(--fg1)', fontFamily: 'monospace', resize: 'vertical' }}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Help text (optional)</label>
                    <input
                      value={fieldHelp}
                      onChange={(e) => setFieldHelp(e.target.value)}
                      placeholder="Shown beneath the field in the entry editor"
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)' }}
                    />
                  </div>
                  <div style={{ width: 200 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>Section (optional)</label>
                    <input
                      value={fieldGroup}
                      onChange={(e) => setFieldGroup(e.target.value)}
                      placeholder="e.g. Location"
                      list="schema-group-suggestions"
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)' }}
                    />
                    <datalist id="schema-group-suggestions">
                      {existingGroups.map((g) => <option key={g} value={g} />)}
                    </datalist>
                  </div>
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
              <SortableList
                items={fields}
                getId={(field) => field.key}
                getLabel={(field) => field.label}
                onReorder={reorderFields}
                renderItem={(f) => (
                  <div style={{ minHeight: 58, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
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
                        {f.group && (
                          <span style={{ fontSize: 11, background: 'var(--surface-3)', padding: '2px 7px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 500 }}>
                            {f.group}
                          </span>
                        )}
                        {RESERVED_SEO_KEYS.includes(f.key) && (
                          <span
                            title="Checked by the SEO review. Renaming this field's key removes it from that check."
                            style={{ fontSize: 11, color: 'var(--ne-blue)', fontWeight: 600 }}
                          >
                            Used for search
                          </span>
                        )}
                      </div>
                      {f.help && <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>{f.help}</div>}
                      {(f.type === 'select' || f.type === 'multiselect') && f.options && f.options.length > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>Options: {f.options.join(', ')}</div>
                      )}
                      {f.type === 'repeater' && f.fields && f.fields.length > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>
                          Each item has: {f.fields.map((sf) => sf.label).join(', ')}
                        </div>
                      )}
                      {f.type === 'number' && f.format && (
                        <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>
                          Shown as {f.format.prefix ?? ''}
                          {(1234.5).toFixed(f.format.precision ?? 1)}
                          {f.format.suffix ? ` ${f.format.suffix}` : ''}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveField(f.key)}
                      style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', flexShrink: 0 }}
                      aria-label={`Remove ${f.label}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              />
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

          {/* Entry list layout */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>How the entry list looks</div>
            <div style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 16 }}>
              Controls what an editor sees when they open this collection.
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--fg2)', marginBottom: 4 }}>
                Extra columns <span style={{ fontWeight: 500, color: 'var(--fg3)' }}>(up to {MAX_LIST_COLUMNS})</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 10 }}>
                Shown beside each entry&apos;s name, so an editor can tell rows apart without opening them.
              </div>
              {fields.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>Add a field first.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {fields.map((f) => {
                    const selected = listColumns.includes(f.key);
                    const atLimit = !selected && listColumns.length >= MAX_LIST_COLUMNS;
                    return (
                      <label
                        key={f.key}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px',
                          border: `1px solid ${selected ? 'var(--ne-blue)' : 'var(--border)'}`,
                          borderRadius: 99, fontSize: 12.5, fontWeight: 600,
                          color: atLimit ? 'var(--fg3)' : 'var(--fg1)',
                          background: selected ? 'var(--ne-blue-muted)' : 'transparent',
                          cursor: atLimit ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={atLimit}
                          onChange={(e) => {
                            setSaved(false);
                            setListColumns((prev) => e.target.checked ? [...prev, f.key] : prev.filter((k) => k !== f.key));
                          }}
                        />
                        {f.label}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--fg2)', marginBottom: 4 }}>Filters</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 10 }}>
                Adds a dropdown above the list. Only fields with a small set of repeated
                values can be filters — a free-text field would give one option per entry.
              </div>
              {filterableFields.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--fg3)' }}>
                  No fields in this collection can be used as a filter yet. Select, multi-select,
                  tag list and yes/no fields can.
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {filterableFields.map((f) => {
                    const selected = listFilters.includes(f.key);
                    return (
                      <label
                        key={f.key}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px',
                          border: `1px solid ${selected ? 'var(--ne-blue)' : 'var(--border)'}`,
                          borderRadius: 99, fontSize: 12.5, fontWeight: 600, color: 'var(--fg1)',
                          background: selected ? 'var(--ne-blue-muted)' : 'transparent', cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => {
                            setSaved(false);
                            setListFilters((prev) => e.target.checked ? [...prev, f.key] : prev.filter((k) => k !== f.key));
                          }}
                        />
                        {f.label}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--fg2)', marginBottom: 4 }}>Order</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 10 }}>
                Entries can only be dragged into a custom order when this is set to manual.
              </div>
              <select
                value={sortDefault}
                onChange={(e) => { setSortDefault(e.target.value as CollectionSortDefault); setSaved(false); }}
                style={{ width: '100%', maxWidth: 320, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}
              >
                {(Object.keys(SORT_LABELS) as CollectionSortDefault[]).map((value) => (
                  <option key={value} value={value}>{SORT_LABELS[value]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn-ne" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
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
    </>
  );
}
