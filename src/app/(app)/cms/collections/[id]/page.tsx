'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Loader2, Plus, X, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useResolvedClient } from '@/lib/collections/useCollection';
import { slugify } from '@/lib/collections/slugify';
import type { FieldDef, FieldType, Collection } from '@/lib/supabase/types';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'richtext', label: 'Rich Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'select', label: 'Select (one choice)' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'date', label: 'Date' },
  { value: 'media', label: 'Image / Media URL' },
  { value: 'url', label: 'URL' },
  { value: 'json', label: 'Repeater (list of items)' },
];

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)', outline: 'none',
};

function newField(): FieldDef {
  return { key: '', label: '', type: 'text', required: false, showInList: false };
}

export default function CollectionEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();
  const { clientId, loading: clientLoading } = useResolvedClient();

  const [name, setName] = useState('');
  const [nameSingular, setNameSingular] = useState('');
  const [slug, setSlug] = useState('');
  const [icon, setIcon] = useState('Boxes');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldDef[]>([newField()]);
  const [titleField, setTitleField] = useState('');

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (isNew) { setLoading(false); return; }
      const supabase = createClient();
      const { data } = await supabase.from('collections').select('*').eq('id', id).single();
      if (cancelled || !data) { setLoading(false); return; }
      const collection = data as Collection;
      setName(collection.name);
      setNameSingular(collection.name_singular);
      setSlug(collection.slug);
      setIcon(collection.icon);
      setDescription(collection.description);
      setFields(collection.fields.length ? collection.fields : [newField()]);
      setTitleField(collection.options.titleField);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [id, isNew]);

  function updateField(i: number, patch: Partial<FieldDef>) {
    setFields((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }
  function moveField(i: number, dir: -1 | 1) {
    setFields((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function removeField(i: number) {
    setFields((prev) => prev.filter((_, j) => j !== i));
  }

  async function handleSave() {
    if (!clientId) { setError('Select a client in the sidebar first.'); return; }
    const cleanFields = fields.filter((f) => f.key && f.label);
    if (!name.trim() || cleanFields.length === 0) { setError('Name and at least one valid field are required.'); return; }

    const resolvedTitleField = cleanFields.find((f) => f.key === titleField)?.key ?? cleanFields[0].key;
    const options = {
      hasStatus: true,
      statusValues: ['draft', 'published', 'archived'],
      titleField: resolvedTitleField,
      slugField: 'slug',
      listColumns: [
        resolvedTitleField,
        ...cleanFields.filter((f) => f.showInList && f.key !== resolvedTitleField).map((f) => f.key),
        'status',
      ],
    };

    setSaving(true); setError('');
    const supabase = createClient();
    const payload = {
      client_id: clientId,
      slug: slug || slugify(name),
      name,
      name_singular: nameSingular || name,
      icon,
      description,
      storage: 'generic' as const,
      fields: cleanFields,
      options,
    };

    if (isNew) {
      const { data, error: err } = await supabase.from('collections').insert(payload).select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      setSaving(false);
      router.replace(`/cms/collections/${data.id}`);
    } else {
      const { error: err } = await supabase.from('collections').update(payload).eq('id', id);
      if (err) { setError(err.message); setSaving(false); return; }
      setSaving(false);
    }
  }

  if (loading || clientLoading) {
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

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', padding: '18px 20px',
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: 'var(--fg2)', marginBottom: 14,
    textTransform: 'uppercase', letterSpacing: '.06em',
  };

  return (
    <>
      <Topbar title={isNew ? 'New Collection' : 'Edit Collection'} subtitle={name || 'Define a custom content type'} />
      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Link href="/cms/collections" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to Collections
          </Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {error && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>{error}</div>}
            <button className="btn-ne" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
              Save Collection
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 780 }}>
          <div style={cardStyle}>
            <div style={sectionTitle}>Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Name (plural)</label>
                <input value={name} onChange={(e) => { setName(e.target.value); if (isNew) setSlug(slugify(e.target.value)); }} style={inputStyle} placeholder="Cars" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Name (singular)</label>
                <input value={nameSingular} onChange={(e) => setNameSingular(e.target.value)} style={inputStyle} placeholder="Car" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Slug</label>
                <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} style={{ ...inputStyle, fontFamily: 'monospace' }} placeholder="cars" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Icon (lucide name)</label>
                <input value={icon} onChange={(e) => setIcon(e.target.value)} style={inputStyle} placeholder="Car" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Description</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} placeholder="What is this collection for?" />
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={sectionTitle}>Fields</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {fields.map((field, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <input value={field.label} onChange={(e) => updateField(i, { label: e.target.value, key: field.key || slugify(e.target.value).replace(/-/g, '_') })}
                      style={inputStyle} placeholder="Field label (e.g. Make)" />
                    <input value={field.key} onChange={(e) => updateField(i, { key: e.target.value })}
                      style={{ ...inputStyle, fontFamily: 'monospace' }} placeholder="field_key" />
                    <select value={field.type} onChange={(e) => updateField(i, { type: e.target.value as FieldType })} style={{ ...inputStyle, cursor: 'pointer' }}>
                      {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>

                  {(field.type === 'select' || field.type === 'multiselect') && (
                    <ChoicesEditor field={field} onChange={(choices) => updateField(i, { options: { ...field.options, choices } })} />
                  )}

                  {field.type === 'json' && (
                    <SubFieldsEditor field={field} onChange={(subFields) => updateField(i, { options: { ...field.options, subFields } })} />
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg2)' }}>
                      <input type="checkbox" checked={!!field.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
                      Required
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg2)' }}>
                      <input type="checkbox" checked={!!field.showInList} onChange={(e) => updateField(i, { showInList: e.target.checked })} />
                      Show in list
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg2)' }}>
                      <input type="radio" name="titleField" checked={titleField === field.key} onChange={() => setTitleField(field.key)} />
                      Use as title
                    </label>
                    <div style={{ flex: 1 }} />
                    <button type="button" onClick={() => moveField(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}><ArrowUp size={14} /></button>
                    <button type="button" onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}><ArrowDown size={14} /></button>
                    <button type="button" onClick={() => removeField(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)' }}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setFields((prev) => [...prev, newField()])}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '8px 14px', cursor: 'pointer', color: '#fff', fontSize: 12.5, fontWeight: 600, marginTop: 12 }}>
              <Plus size={14} /> Add Field
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

function ChoicesEditor({ field, onChange }: { field: FieldDef; onChange: (choices: { label: string; value: string }[]) => void }) {
  const choices = field.options?.choices ?? [];
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');

  function add() {
    if (!label.trim()) return;
    onChange([...choices, { label: label.trim(), value: value.trim() || slugify(label) }]);
    setLabel(''); setValue('');
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 6 }}>Choices</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {choices.map((c, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, background: 'var(--surface-3)', color: 'var(--fg2)', padding: '3px 8px', borderRadius: 99 }}>
            {c.label}
            <button type="button" onClick={() => onChange(choices.filter((_, j) => j !== i))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 0, display: 'flex' }}><X size={10} /></button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="Label (e.g. Toyota)" />
        <input value={value} onChange={(e) => setValue(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="Value (optional)" />
        <button type="button" onClick={add} style={{ background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 10px', cursor: 'pointer', color: '#fff' }}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function SubFieldsEditor({ field, onChange }: { field: FieldDef; onChange: (subFields: FieldDef[]) => void }) {
  const subFields = field.options?.subFields ?? [];
  const [label, setLabel] = useState('');

  function add() {
    if (!label.trim()) return;
    onChange([...subFields, { key: slugify(label).replace(/-/g, '_'), label: label.trim(), type: 'text' }]);
    setLabel('');
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 6 }}>Item fields (each row of this repeater)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {subFields.map((sub, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, background: 'var(--surface-3)', color: 'var(--fg2)', padding: '3px 8px', borderRadius: 99 }}>
            {sub.label}
            <button type="button" onClick={() => onChange(subFields.filter((_, j) => j !== i))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 0, display: 'flex' }}><X size={10} /></button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="e.g. Label, Body, Image URL" />
        <button type="button" onClick={add} style={{ background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 10px', cursor: 'pointer', color: '#fff' }}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
