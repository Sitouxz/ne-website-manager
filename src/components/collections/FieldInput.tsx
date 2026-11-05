'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Image as ImageIcon, X, Plus, AlertCircle, Copy, Trash2 } from 'lucide-react';
import RichTextEditor from '@/components/editor/RichTextEditor';
import MediaPicker from '@/components/MediaPicker';
import SortableList from '@/components/builder/SortableList';
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
 * | `taglist`                           | `string[]` (free-form, no fixed vocabulary)           |
 * | `repeater`                          | `Array<Record<string, unknown>>` — one object per row, keyed by `def.fields[].key` |
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
 * - `taglist` stores a plain `string[]` rather than `{ value }[]` — a tag has
 *   nothing to carry besides its own text, and a bare array is what every
 *   client site's template wants to `.join(', ')` or map over. It is
 *   deliberately shaped identically to `multiselect` so a field can be
 *   changed between the two without a data migration.
 * - `repeater` stores an array of objects keyed by the sub-field `key`s —
 *   i.e. each row has exactly the shape of a whole entry's `data`. That
 *   self-similarity is the point: `validateEntry` recurses into rows using
 *   the same code path as the top level, and this component recurses into
 *   `FieldInput` for each sub-field, so a repeater's rows support every
 *   field type without a second implementation. Rows carry no synthetic id
 *   — nothing is stored that a client site would have to know to ignore.
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

/** One row of a `repeater` — the same shape as a whole entry's `data`. */
type RepeaterRow = Record<string, unknown>;

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
      return <NumberFieldInput def={def} value={value} onChange={onChange} />;

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

    case 'taglist':
      return <TagListFieldInput def={def} value={value as string[] | undefined} onChange={onChange} />;

    case 'repeater':
      return <RepeaterFieldInput def={def} value={value as RepeaterRow[] | undefined} onChange={onChange} />;

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

/**
 * `number` with optional prefix/suffix adornments and decimal rounding.
 *
 * The adornments are display-only — `data[key]` stays a plain JS `number`, so
 * a client site can still do arithmetic with it. Rounding is applied on blur
 * rather than on every keystroke: rounding as you type makes it impossible to
 * enter "12.50" when precision is 1 (the "5" is swallowed before you reach the
 * "0"), which is the classic way a currency input becomes unusable.
 *
 * Text is buffered locally for the same reason `JsonFieldInput` buffers its
 * own: re-deriving the input's text from `value` on every render would fight
 * the caret while typing "1." or "-". `lastSyncedRef` follows that component's
 * established pattern so an external change (a revision restore) still lands,
 * while this component's own `onChange` echoing back does not clobber
 * in-progress typing.
 */
function NumberFieldInput({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: FieldInputValue;
  onChange: (value: FieldInputValue) => void;
}) {
  const { precision, prefix, suffix } = def.format ?? {};

  // Display keeps the trailing zeros `precision` implies ("10.50"); the
  // stored value never does, since it's a plain number.
  const toText = (v: FieldInputValue) => {
    if (v === undefined || v === null) return '';
    if (typeof v === 'number' && precision !== undefined) return v.toFixed(precision);
    return String(v);
  };

  // Tracks the last value this component itself emitted, so the resync effect
  // below can tell "the parent echoed my own change back" from "something
  // external replaced the value" (a revision restore). Comparing *values*
  // rather than their text avoids a subtle revert: "10.50" and 10.5 are the
  // same value but different strings, and a string comparison would treat the
  // echo as external data and overwrite the just-committed display.
  const lastEmittedRef = useRef<FieldInputValue>(value);
  const [text, setText] = useState(() => toText(value));

  useEffect(() => {
    if (Object.is(value, lastEmittedRef.current)) return;
    lastEmittedRef.current = value;
    setText(toText(value));
    // `toText` closes over `precision` from props and is stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, precision]);

  function commit(raw: string) {
    if (raw.trim() === '') {
      lastEmittedRef.current = undefined;
      setText('');
      onChange(undefined);
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) {
      // Keep the user's text so they can see and fix what they typed;
      // `validateEntry` reports it as "must be a number" on publish rather
      // than silently discarding what they entered.
      lastEmittedRef.current = raw;
      setText(raw);
      onChange(raw);
      return;
    }
    const rounded = precision === undefined ? num : Number(num.toFixed(precision));
    lastEmittedRef.current = rounded;
    setText(toText(rounded));
    onChange(rounded);
  }

  const adornment: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--fg3)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {prefix && <span style={adornment}>{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        style={{ ...inputStyle, minWidth: 0 }}
      />
      {suffix && <span style={adornment}>{suffix}</span>}
    </div>
  );
}

/**
 * `taglist` — a free-form list of short strings (amenities, connectivity,
 * whatever the client calls them). Distinct from `multiselect`, which needs a
 * fixed vocabulary defined up front in the schema.
 *
 * Entry is by Enter or comma, which is the interaction people already know
 * from every email "To:" field and every tagging UI. Backspace on an empty
 * input removes the last tag — expected by anyone who types fast, and
 * harmless for anyone who doesn't. Duplicates are silently ignored rather
 * than rejected with an error: a duplicate tag is never what was meant, and
 * an error message for it would be noise.
 */
function TagListFieldInput({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string[] | undefined;
  onChange: (value: FieldInputValue) => void;
}) {
  const tags = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState('');

  function addFrom(raw: string) {
    const additions = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && !tags.includes(s));
    if (additions.length > 0) onChange([...tags, ...additions]);
    setDraft('');
  }

  function remove(index: number) {
    onChange(tags.filter((_, i) => i !== index));
  }

  return (
    <div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {tags.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--surface-3)',
                color: 'var(--fg1)',
                borderRadius: 99,
                padding: '4px 6px 4px 10px',
                fontSize: 12.5,
                fontWeight: 500,
              }}
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${tag}`}
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 18,
                  height: 18,
                  border: 'none',
                  borderRadius: '50%',
                  background: 'transparent',
                  color: 'var(--fg3)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          if (e.target.value.includes(',')) { addFrom(e.target.value); return; }
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Adding a tag must not submit the surrounding editor form.
            e.preventDefault();
            addFrom(draft);
          } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
            remove(tags.length - 1);
          }
        }}
        onBlur={() => addFrom(draft)}
        placeholder={def.help ? 'Type and press Enter' : 'Type an item and press Enter'}
        style={inputStyle}
      />
    </div>
  );
}

/**
 * `repeater` — an ordered list of rows, each row a small form built from
 * `def.fields`. This is what page sections, listing highlights, FAQ pairs and
 * every other "a list of things that each have a few properties" need, and
 * without it those all degrade to a raw JSON textarea.
 *
 * Row identity is positional (`row-${index}`) for both the React key and the
 * drag id. Rows are plain data with no synthetic id — deliberately, so
 * nothing reaches a client site that it has to know to ignore. Positional
 * keys are safe here because every input inside a row is fully controlled by
 * its `value` prop, so a reorder re-renders each row with the correct values
 * rather than leaving stale DOM behind; the two components that do hold
 * internal buffers (`RichTextEditor`, `JsonFieldInput`) already resync from
 * their props via the `lastSyncedRef` pattern for exactly this case.
 *
 * Rows are collapsible and show a derived summary when collapsed, because a
 * repeater of eight sections each holding a rich-text body is unusable as
 * eight expanded forms stacked vertically.
 */
function RepeaterFieldInput({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: RepeaterRow[] | undefined;
  onChange: (value: FieldInputValue) => void;
}) {
  const subFields = def.fields ?? [];
  const rows = Array.isArray(value) ? value : [];
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  if (subFields.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--fg3)' }}>
        <AlertCircle size={13} /> This field has no sub-fields set up yet.
      </div>
    );
  }

  function update(next: RepeaterRow[]) {
    onChange(next);
  }

  function addRow() {
    update([...rows, {}]);
    // A newly added row is always the one being worked on, so it opens.
    setCollapsed((prev) => ({ ...prev, [rows.length]: false }));
  }

  function duplicateRow(index: number) {
    const copy = structuredClone(rows[index]);
    update([...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)]);
  }

  function removeRow(index: number) {
    update(rows.filter((_, i) => i !== index));
    setCollapsed({});
  }

  function setCell(index: number, key: string, cellValue: FieldInputValue) {
    update(rows.map((row, i) => (i === index ? { ...row, [key]: cellValue } : row)));
  }

  /** First non-empty text-ish sub-field value, so a collapsed row is identifiable. */
  function summarize(row: RepeaterRow, index: number): string {
    for (const sub of subFields) {
      const cell = row[sub.key];
      if (typeof cell === 'string' && cell.trim() !== '') return cell.length > 60 ? `${cell.slice(0, 60)}…` : cell;
      if (typeof cell === 'number') return String(cell);
    }
    return `Item ${index + 1}`;
  }

  return (
    <div>
      {rows.length > 0 && (
        <SortableList
          items={rows}
          getId={(_row, index) => `row-${index}`}
          getLabel={(row, index) => summarize(row, index)}
          onReorder={(next) => { update(next); setCollapsed({}); }}
          renderItem={(row, index) => {
            const isCollapsed = collapsed[index] ?? false;
            return (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', marginBottom: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: isCollapsed ? 'none' : '1px solid var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [index]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {summarize(row, index)}
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateRow(index)}
                    aria-label={`Duplicate item ${index + 1}`}
                    title="Duplicate"
                    style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', flexShrink: 0 }}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    aria-label={`Remove item ${index + 1}`}
                    title="Remove"
                    style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', flexShrink: 0 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {!isCollapsed && (
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {subFields.map((sub) => (
                      <div key={sub.key}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: 'var(--fg2)', marginBottom: 6 }}>
                          {sub.label}
                          {sub.required && <span style={{ color: 'var(--ne-danger)' }}>*</span>}
                        </label>
                        <FieldInput
                          def={sub}
                          value={row[sub.key]}
                          onChange={(v) => setCell(index, sub.key, v)}
                        />
                        {sub.help && <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 6 }}>{sub.help}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
        />
      )}

      <button
        type="button"
        onClick={addRow}
        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--ne-blue)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 12px', cursor: 'pointer' }}
      >
        <Plus size={12} /> Add {def.label}
      </button>
    </div>
  );
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
          <Image unoptimized src={value.url} alt={value.alt ?? ''} width={160} height={110} style={{ width: 160, height: 110, objectFit: 'cover', borderRadius: 'var(--r-sm)', display: 'block' }} />
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
            <Image unoptimized src={item.url} alt={item.alt ?? ''} width={80} height={80} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--r-sm)', display: 'block' }} />
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

function stringifyJsonValue(value: FieldInputValue): string {
  return JSON.stringify(value ?? {}, null, 2);
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
  // blur, don't silently swallow invalid JSON" rules out).
  //
  // `value` CAN change externally after mount: `FieldInput` instances use a
  // stable `key={f.key}` in the entry editor and are never remounted, so the
  // entry editor's revision-Restore flow (`applyItemToForm`/`setForm`) can
  // update `form.data[key]` — and therefore this `value` prop — on an
  // already-mounted instance. Without a resync, the textarea would keep
  // showing the pre-restore text, and blurring it unedited would silently
  // revert the just-restored value on the next save.
  //
  // Re-synced the same way `RichTextEditor` (Phase 3) handles the identical
  // problem: `lastSyncedRef` remembers, as a JSON string, the value this
  // component itself last knew about (whether from an incoming prop or its
  // own `onChange`). The effect below only overwrites `text` when the
  // incoming `value` serializes to something *different* from that ref —
  // i.e. genuinely new external data, not this component's own `onChange`
  // echoed straight back down. `handleBlur` updates the ref *before* calling
  // `onChange`, so the echo is recognized and the effect no-ops instead of
  // clobbering whatever the user has typed since.
  const initialText = stringifyJsonValue(value);
  const lastSyncedRef = useRef<string>(initialText);
  const [text, setText] = useState(() => initialText);
  const [error, setError] = useState('');

  useEffect(() => {
    const incoming = stringifyJsonValue(value);
    if (incoming === lastSyncedRef.current) return;
    lastSyncedRef.current = incoming;
    setText(incoming);
    setError('');
  }, [value]);

  function handleBlur() {
    try {
      const parsed = JSON.parse(text);
      setError('');
      lastSyncedRef.current = stringifyJsonValue(parsed);
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
