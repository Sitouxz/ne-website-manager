import type { FieldDef, FieldType } from './types';

/**
 * Validates a collection's `FieldDef[]` schema itself (not an entry against
 * it). Checks:
 *  - every `key` is non-empty and matches snake_case (`/^[a-z][a-z0-9_]*$/`)
 *  - no duplicate `key` across the array
 *  - every `'select'`/`'multiselect'` field has a non-empty `options` array
 *
 * Design choice: a non-select/multiselect field that happens to have an
 * `options` array set is NOT flagged as an error. `options` is simply
 * irrelevant/unused for those types — being lenient here avoids penalizing
 * leftover data from a field whose `type` was just changed away from
 * select/multiselect, and there's no ambiguity or safety concern in
 * ignoring an unused property.
 *
 * Error shape: `{ ok: false, errors: string[] }` — a flat list of
 * human-readable messages (mirroring `validateEntry`'s `ok`-discriminated
 * result, but a plain array instead of a per-key record, since a field-defs
 * error isn't always attributable to a single key, e.g. "duplicate key
 * across two entries" or "key must not be empty").
 */

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export type ValidateFieldDefsResult = { ok: true } | { ok: false; errors: string[] };

export function validateFieldDefs(fields: FieldDef[]): ValidateFieldDefsResult {
  const errors: string[] = [];
  const seenKeys = new Set<string>();
  const duplicateKeysReported = new Set<string>();

  for (const field of fields) {
    const key = field.key;

    if (!key || key.trim() === '') {
      errors.push(`Field key must not be empty (label: "${field.label}")`);
    } else if (!KEY_PATTERN.test(key)) {
      errors.push(`Field key "${key}" must be snake_case (lowercase letters, numbers, underscores, starting with a letter)`);
    } else if (seenKeys.has(key)) {
      if (!duplicateKeysReported.has(key)) {
        errors.push(`Duplicate field key "${key}"`);
        duplicateKeysReported.add(key);
      }
    } else {
      seenKeys.add(key);
    }

    if ((field.type === 'select' || field.type === 'multiselect') && (!field.options || field.options.length === 0)) {
      errors.push(`Field "${key || field.label}" of type "${field.type}" requires a non-empty options array`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Validates an entry's `data` against a collection's `FieldDef[]` schema.
 *
 * Rules:
 *  - `required` fields must be present with a non-empty value
 *    (`undefined`/`null`/`''` all count as missing).
 *  - Type checks are performed where cheap and meaningful:
 *    - `number` -> `typeof value === 'number'`
 *    - `boolean` -> `typeof value === 'boolean'`
 *    - `select` -> value must be one of `field.options`
 *    - `multiselect` -> value must be an array where every element is one
 *      of `field.options`
 *    - `email` -> basic shape check (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`)
 *    - `url` -> must parse via `new URL(value)`
 *    - `gallery` -> must be an array
 *    - `json` -> must be a non-null object or an array (not a primitive)
 *    - `richtext` -> must be an object shaped `{ json, html }` per
 *      `FieldInput.tsx`'s data-shape contract: `json` a non-null object,
 *      `html` a string. This mirrors what `RichTextEditor.onChange` always
 *      produces in lockstep, so any populated `richtext` value has both.
 *    - `image` -> must be an object shaped `{ url, alt }` per the same
 *      contract: `url` a non-empty string (cheap presence check only — not
 *      validated as a real URL, keeping this check cheap per the brief),
 *      `alt` either a string or `null` (both are valid per the contract).
 *  - For `text`, `textarea`, `date` — no cheap format check is meaningful
 *    (the brief explicitly calls these out), so we only check the value is
 *    a string when present. This is deliberately not exhaustive (e.g. we
 *    don't validate `date` is a real date) — over-validating these was out
 *    of scope.
 *  - Fields absent from `data` and not `required` are fine (no error).
 *  - Keys present in `data` with no matching `FieldDef` are silently
 *    ignored — this function validates data against the schema, not the
 *    other way around, so extra keys are not this function's concern.
 *
 * Error shape: `{ ok: false, errors: Record<string, string> }`, keyed by
 * `FieldDef.key`, one message per offending field (first failure wins for
 * a given field — required-check takes priority over the type check).
 */

export type ValidateEntryResult = { ok: true } | { ok: false; errors: Record<string, string> };

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Returns an error message for `value` against `type`, or `null` if it's fine. */
function checkType(type: FieldType, value: unknown, options: string[] | undefined): string | null {
  switch (type) {
    case 'number':
      return typeof value === 'number' ? null : 'must be a number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'select':
      return typeof value === 'string' && (options ?? []).includes(value)
        ? null
        : `must be one of: ${(options ?? []).join(', ')}`;
    case 'multiselect':
      if (!Array.isArray(value)) return 'must be an array';
      return value.every((v) => typeof v === 'string' && (options ?? []).includes(v))
        ? null
        : `every value must be one of: ${(options ?? []).join(', ')}`;
    case 'email':
      return typeof value === 'string' && EMAIL_PATTERN.test(value) ? null : 'must be a valid email address';
    case 'url':
      return typeof value === 'string' && isValidUrl(value) ? null : 'must be a valid URL';
    case 'gallery':
      return Array.isArray(value) ? null : 'must be an array';
    case 'json':
      return typeof value === 'object' && value !== null ? null : 'must be an object or array';
    case 'richtext': {
      // Per FieldInput.tsx's data-shape contract: `{ json: Record<string,
      // unknown>; html: string }`, produced in lockstep by
      // RichTextEditor.onChange. Not a string (unlike text/textarea/date).
      if (typeof value !== 'object' || value === null) return 'must be a rich text value with json and html';
      const v = value as { json?: unknown; html?: unknown };
      const jsonOk = typeof v.json === 'object' && v.json !== null;
      const htmlOk = typeof v.html === 'string';
      return jsonOk && htmlOk ? null : 'must be a rich text value with json and html';
    }
    case 'image': {
      // Per FieldInput.tsx's data-shape contract: `{ url: string; alt: string
      // | null }`. `url` is checked for non-empty presence only — validating
      // it's a plausible URL shape would duplicate the `url` field type's
      // `isValidUrl` check for marginal benefit and isn't required by the
      // contract.
      if (typeof value !== 'object' || value === null) return 'must be an image value with a url';
      const v = value as { url?: unknown; alt?: unknown };
      const urlOk = typeof v.url === 'string' && v.url.trim() !== '';
      const altOk = v.alt === null || typeof v.alt === 'string';
      return urlOk && altOk ? null : 'must be an image value with a url';
    }
    case 'text':
    case 'textarea':
    case 'date':
      return typeof value === 'string' ? null : 'must be a string';
    default:
      return null;
  }
}

export function validateEntry(fields: FieldDef[], data: Record<string, unknown>): ValidateEntryResult {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = data[field.key];
    const present = Object.prototype.hasOwnProperty.call(data, field.key) && !isEmpty(value);

    if (field.required && !present) {
      errors[field.key] = `"${field.label}" is required`;
      continue;
    }

    if (!present) continue;

    const typeError = checkType(field.type, value, field.options);
    if (typeError) {
      errors[field.key] = `"${field.label}" ${typeError}`;
    }
  }

  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}
