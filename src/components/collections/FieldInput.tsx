'use client';

import { useState } from 'react';
import { Image as ImageIcon, X, Plus, AlertCircle } from 'lucide-react';
import RichTextEditor from '@/components/editor/RichTextEditor';
import MediaPicker from '@/components/MediaPicker';
import type { MediaItem } from '@/app/api/media/route';
import type { FieldDef } from '@/lib/collections/types';

/**
 * ## `collection_items.data` shape contract
 *
 * `collection_items.data` is a single JSONB column keyed by `FieldDef.key`
 * (see `src/lib/supabase/types.ts`). Task 4.1/4.2 defined the *schema*
 * (`FieldDef`/`FieldType`) but nothing before this task actually wrote to
 * `data`, so this is the first place the per-type value shape is decided.
 * Documented here (rather than in the entry editor) because `FieldInput` is
 * the single chokepoint every read/write of a `data[key]` value passes
 * through — any other Phase 4/SDK code reading `collection_items.data`
 * should treat this comment as the source of truth.
 *
 * | `FieldType`                        | `data[key]` shape                                    |
 * |-------------------------------------|-------------------------------------------------------|
 * | `text`/`textarea`/`url`/`email`/`date` | `string`                                          |
 * | `number`                            | `number`                                              |
 * | `boolean`                           | `boolean`                                             |
 * | `select`                            | `string` (one of `def.options`)                       |
 * | `multiselect`                       | `string[]` (subset of `def.options`)                  |
 * | `richtext`                          | `{ json: Record<string, unknown>; html: string }`     |
 * | `image`                             | `{ url: string; alt: string \| null }`                |
 * | `gallery`                           | `Array<{ url: string; alt: string \| null }>`         |
 * | `json`                              | pass-through arbitrary JSON (object or array)         |
 *
 * Notes on the judgment calls:
 * - `richtext` stores `{ json, html }` together (not just one) because
 *   `RichTextEditor` (Phase 3) always produces both in lockstep via its
 *   `onChange(json, html)` callback, and public API consumers want the
 *   rendered `html` the same way `posts.content`/`pages.content` already
 *   work — storing only `json` would push HTML-rendering duplication onto
 *   every consumer, storing only `html` would lose round-trip editability.
 * - `image` stores `{ url, alt }`, not the full `MediaItem` returned by
 *   `MediaPicker.onSelect` — a generic field has exactly one JSONB slot to
 *   work with, and `url`/`alt` are the only two things any renderer needs
 *   (mirrors how `posts.cover_url` and `properties.hero_url`+`hero_alt`
 *   already work as separate scalar columns, adapted here into one object
 *   since there's no second column to split `alt` into).
 * - `gallery` uses `{ url, alt }` per item (not `properties.gallery`'s exact
 *   `{ src, alt }` field names) — chosen for consistency with this file's
 *   own `image` type immediately above it, so a caller reading a generic
 *   collection's `data` doesn't have to remember two different key names
 *   for "the same kind of thing" depending on whether it's a single image or
 *   a list of them. `properties.gallery` is a separate, pre-existing native
 *   table column outside this contract's scope, so this doesn't change it.
 */

export type FieldInputValue = unknown;

export interface FieldInputProps {
  def: FieldDef;
  value: FieldInputValue;
  onChange: (value: FieldInputValue) => void;
}

interface RichTextValue {
  json: Record<string, unknown> | null;
  html: string;
}

interface ImageValue {
  url: string;
  alt: string | null;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)',
  padding: '9px 12px',
  fontSize: 13.5,
  color: 'var(--fg1)',
  background: 'var(--surface)',
  outline: 'none',
  fontFamily: 'inherit',
};

export default function FieldInput({ def, value, onChange }: FieldInputProps) {
  switch (def.type) {
    case 'text':
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );

    case 'url':
      return (
        <input
          type="url"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );

    case 'email':
      return (
        <input
          type="email"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );

    case 'textarea':
      return (
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      );

    case 'number':
      return (
        <input
          type="number"
          value={value === undefined || value === null ? '' : String(value as number)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') { onChange(undefined); return; }
            const num = Number(raw);
            onChange(Number.isNaN(num) ? raw : num);
          }}
          style={inputStyle}
        />
      );

    case 'boolean':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--fg1)' }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          Yes
        </label>
      );

    case 'date':
      return (
        <input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );

    case 'select':
      return (
        <select
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          style={{ ...inputStyle, background: 'var(--surface)' }}
        >
          <option value="">— none —</option>
          {(def.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );

    // Multi-select: rendered as a checkbox list rather than a native
    // `<select multiple>`. A `<select multiple>` is the "simplest" widget
    // per the brief, but it requires ctrl/cmd-click to select more than one
    // option, which is not discoverable and is easy to mis-operate — a
    // checkbox list needs more vertical space but every interaction is a
    // single obvious click, consistent with this app's general preference
    // for explicit, low-cleverness controls (e.g. Task 4.2's up/down
    // reorder buttons over drag-and-drop).
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(def.options ?? []).map((opt) => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--fg1)' }}>
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={(e) => {
                  if (e.target.checked) onChange([...selected, opt]);
                  else onChange(selected.filter((s) => s !== opt));
                }}
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }

    case 'richtext': {
      const rt = (value as RichTextValue | undefined) ?? undefined;
      return (
        <RichTextEditor
          valueJson={rt?.json ?? null}
          fallbackHtml={rt?.html ?? ''}
          onChange={(json, html) => onChange({ json: json as Record<string, unknown>, html })}
        />
      );
    }

    case 'image':
      return <ImageFieldInput value={value as ImageValue | undefined} onChange={onChange} />;

    case 'gallery':
      return <GalleryFieldInput value={value as ImageValue[] | undefined} onChange={onChange} />;

    case 'json':
      return <JsonFieldInput value={value} onChange={onChange} />;

    default:
      return null;
  }
}

function ImageFieldInput({
  value,
  onChange,
}: {
  value: ImageValue | undefined;
  onChange: (value: FieldInputValue) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleSelect(item: MediaItem) {
    onChange({ url: item.url, alt: item.alt ?? null } satisfies ImageValue);
  }

  return (
    <div>
      {value?.url ? (
        <div style={{ position: 'relative', width: 160 }}>
          <img src={value.url} alt={value.alt ?? ''} style={{ width: 160, height: 110, objectFit: 'cover', borderRadius: 'var(--r-sm)', display: 'block' }} />
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 'var(--r-sm)', padding: '4px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 600 }}
          >
            Change
          </button>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label="Remove image"
            style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', color: '#fff', display: 'grid', placeItems: 'center' }}
          >
            <X size={11} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          style={{ width: 160, border: '2px dashed var(--border)', borderRadius: 'var(--r-sm)', padding: '20px 12px', textAlign: 'center', cursor: 'pointer', background: 'transparent' }}
        >
          <ImageIcon size={20} color="var(--fg3)" style={{ margin: '0 auto 6px' }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg2)' }}>Choose</div>
        </button>
      )}

      {value?.url && (
        <input
          value={value.alt ?? ''}
          onChange={(e) => onChange({ url: value.url, alt: e.target.value || null } satisfies ImageValue)}
          placeholder="Alt text"
          style={{ ...inputStyle, marginTop: 8, width: 160, fontSize: 12 }}
        />
      )}

      <MediaPicker open={pickerOpen} onOpenChange={setPickerOpen} accept="image" onSelect={handleSelect} />
    </div>
  );
}

function GalleryFieldInput({
  value,
  onChange,
}: {
  value: ImageValue[] | undefined;
  onChange: (value: FieldInputValue) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const items = value ?? [];

  function handleSelect(item: MediaItem) {
    onChange([...items, { url: item.url, alt: item.alt ?? null } satisfies ImageValue]);
  }

  function handleRemove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {items.map((item, i) => (
          <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
            <img src={item.url} alt={item.alt ?? ''} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--r-sm)', display: 'block' }} />
            <button
              type="button"
              onClick={() => handleRemove(i)}
              aria-label="Remove"
              style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.65)', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', color: '#fff', display: 'grid', placeItems: 'center' }}
            >
              <X size={10} />
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ width: 80, height: 80, border: '2px dashed var(--border)', borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center' }}>
            <ImageIcon size={18} color="var(--fg3)" />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--ne-blue)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '5px 10px', cursor: 'pointer' }}
      >
        <Plus size={12} /> Add Image
      </button>

      <MediaPicker open={pickerOpen} onOpenChange={setPickerOpen} accept="image" onSelect={handleSelect} />
    </div>
  );
}

function JsonFieldInput({
  value,
  onChange,
}: {
  value: FieldInputValue;
  onChange: (value: FieldInputValue) => void;
}) {
  // Buffers the raw text independently of `value` so the textarea can hold
  // in-progress, possibly-invalid JSON while typing — re-deriving the text
  // from `value` on every keystroke would either fight the user's cursor or
  // require parsing on every keystroke (which is exactly what "parse on
  // blur, don't silently swallow invalid JSON" rules out). The initializer
  // only runs once per mount; this component isn't expected to have its
  // `value` prop changed externally after the entry editor's initial load
  // (see the entry editor's loading gate), so no re-sync effect is needed.
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState('');

  function handleBlur() {
    try {
      const parsed = JSON.parse(text);
      setError('');
      onChange(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        rows={6}
        spellCheck={false}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12.5 }}
      />
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ne-danger)', marginTop: 6 }}>
          <AlertCircle size={13} /> Invalid JSON: {error}
        </div>
      )}
    </div>
  );
}
