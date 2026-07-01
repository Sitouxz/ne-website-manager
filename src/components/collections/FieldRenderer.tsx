'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { FieldDef } from '@/lib/supabase/types';

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)', outline: 'none',
};

function Label({ field }: { field: FieldDef }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>
      {field.label}{field.required && <span style={{ color: 'var(--ne-danger)' }}> *</span>}
    </label>
  );
}

export function defaultValueFor(field: FieldDef): unknown {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'boolean': return false;
    case 'number': return null;
    case 'multiselect': return [];
    case 'json': return [];
    default: return '';
  }
}

export default function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <div>
          <Label field={field} />
          <input
            type={field.type === 'url' ? 'url' : 'text'}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            style={inputStyle}
            placeholder={field.help}
          />
        </div>
      );

    case 'textarea':
    case 'richtext':
      return (
        <div>
          <Label field={field} />
          <textarea
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            rows={field.type === 'richtext' ? 8 : 4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
            placeholder={field.help}
          />
        </div>
      );

    case 'number':
      return (
        <div>
          <Label field={field} />
          <input
            type="number"
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            style={inputStyle}
            placeholder={field.help}
          />
        </div>
      );

    case 'boolean':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13, color: 'var(--fg1)' }}>{field.label}</span>
        </div>
      );

    case 'date':
      return (
        <div>
          <Label field={field} />
          <input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
        </div>
      );

    case 'select':
      return (
        <div>
          <Label field={field} />
          <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">— Select —</option>
            {(field.options?.choices ?? []).map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
        </div>
      );

    case 'media':
      return (
        <div>
          <Label field={field} />
          <input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} style={inputStyle} placeholder="https://..." />
          {value ? (
            <img src={value as string} alt="" style={{ marginTop: 8, width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 'var(--r-sm)' }} />
          ) : null}
        </div>
      );

    case 'multiselect':
      return <MultiselectField field={field} value={(value as string[]) ?? []} onChange={onChange} />;

    case 'json':
      return <RepeaterField field={field} value={(value as Record<string, unknown>[]) ?? []} onChange={onChange} />;

    default:
      return null;
  }
}

function MultiselectField({ field, value, onChange }: { field: FieldDef; value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const choices = field.options?.choices;

  function add(v: string) {
    const trimmed = v.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setDraft('');
  }

  return (
    <div>
      <Label field={field} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {value.map((v, i) => {
          const label = choices?.find((c) => c.value === v)?.label ?? v;
          return (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, background: 'var(--surface-3)', color: 'var(--fg2)', padding: '3px 8px', borderRadius: 99 }}>
              {label}
              <button onClick={() => onChange(value.filter((_, j) => j !== i))} type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 0, display: 'flex' }}><X size={10} /></button>
            </span>
          );
        })}
      </div>
      {choices ? (
        <select value="" onChange={(e) => add(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">+ Add...</option>
          {choices.filter((c) => !value.includes(c.value)).map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
            style={{ ...inputStyle, flex: 1 }} placeholder="Type and press Enter" />
          <button type="button" onClick={() => add(draft)}
            style={{ background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 10px', cursor: 'pointer', color: '#fff' }}>
            <Plus size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function RepeaterField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: Record<string, unknown>[];
  onChange: (v: Record<string, unknown>[]) => void;
}) {
  const subFields = field.options?.subFields ?? [];

  function updateRow(i: number, key: string, v: unknown) {
    const next = [...value];
    next[i] = { ...next[i], [key]: v };
    onChange(next);
  }

  function addRow() {
    const row: Record<string, unknown> = {};
    for (const sub of subFields) row[sub.key] = defaultValueFor(sub);
    onChange([...value, row]);
  }

  return (
    <div>
      <Label field={field} />
      {value.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${subFields.length}, 1fr)`, gap: 8 }}>
            {subFields.map((sub) => (
              <input
                key={sub.key}
                value={(row[sub.key] as string) ?? ''}
                onChange={(e) => updateRow(i, sub.key, e.target.value)}
                style={inputStyle}
                placeholder={sub.label}
              />
            ))}
          </div>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: '8px 4px' }}>
            <X size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 12px', cursor: 'pointer', color: '#fff', fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>
        <Plus size={14} /> Add {field.label}
      </button>
    </div>
  );
}
