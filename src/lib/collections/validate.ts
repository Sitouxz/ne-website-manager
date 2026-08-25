import { MAX_REPEATER_DEPTH, type FieldDef, type FieldType } from './types';

/**
 * Validates a collection's `FieldDef[]` schema itself (not an entry against
 * it). Checks:
 *  - every `key` is non-empty and matches snake_case (`/^[a-z][a-z0-9_]*$/`)
 *  - no duplicate `key` across the array — and, independently, within each
 *    repeater's own sub-schema, since a sub-field lives in a different
 *    object and may legitimately reuse a top-level key
 *  - every `'select'`/`'multiselect'` field has a non-empty `options` array
 *  - every `'repeater'` field has a non-empty `fields` sub-schema, which is
 *    validated recursively and nests no deeper than `MAX_REPEATER_DEPTH`
 *  - a `format.precision`, where present, is a whole number in 0–6
 *
 * Design choice: a field carrying a property irrelevant to its type — an
 * `options` array on a `text` field, a `fields` sub-schema on a `number` —
 * is NOT flagged as an error. Those properties are simply unused for those
 * types. Being lenient avoids penalizing leftover data from a field whose
 * `type` was just changed away from select/multiselect/repeater, and there's
 * no ambiguity or safety concern in ignoring an unused property.
 *
 * Error shape: `{ ok: false, errors: string[] }` — a flat list of
 * human-readable messages (mirroring `validateEntry`'s `ok`-discriminated
 * result, but a plain array instead of a per-key record, since a field-defs
 * error isn't always attributable to a single key, e.g. "duplicate key
 * across two entries" or "key must not be empty"). Errors raised inside a
 * repeater are prefixed with the path to the offending sub-schema, because
 * a bare "Duplicate field key" is useless once a schema has three repeaters.
 */

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export type ValidateFieldDefsResult = { ok: true } | { ok: false; errors: string[] };

const MAX_PRECISION = 6;

function collectFieldDefErrors(fields: FieldDef[], depth: number, path: string, errors: string[]): void {
  const seenKeys = new Set<string>();
  const duplicateKeysReported = new Set<string>();
  const prefix = path ? `In "${path}": ` : '';

  for (const field of fields) {
    const key = field.key;

    if (!key || key.trim() === '') {
      errors.push(`${prefix}Field key must not be empty (label: "${field.label}")`);
    } else if (!KEY_PATTERN.test(key)) {
      errors.push(`${prefix}Field key "${key}" must be snake_case (lowercase letters, numbers, underscores, starting with a letter)`);
    } else if (seenKeys.has(key)) {
      if (!duplicateKeysReported.has(key)) {
        errors.push(`${prefix}Duplicate field key "${key}"`);
        duplicateKeysReported.add(key);
      }
    } else {
      seenKeys.add(key);
    }

    const label = key || field.label;

    if ((field.type === 'select' || field.type === 'multiselect') && (!field.options || field.options.length === 0)) {
      errors.push(`${prefix}Field "${label}" of type "${field.type}" requires a non-empty options array`);
    }

    if (field.type === 'repeater') {
      if (depth > MAX_REPEATER_DEPTH) {
        // Reported instead of recursed, so a pathological schema can't walk
        // the stack down producing one error per level on the way.
        errors.push(`${prefix}Field "${label}" nests repeaters more than ${MAX_REPEATER_DEPTH} levels deep — use a separate collection instead`);
      } else if (!field.fields || field.fields.length === 0) {
        errors.push(`${prefix}Field "${label}" of type "repeater" requires at least one sub-field`);
      } else {
        collectFieldDefErrors(field.fields, depth + 1, path ? `${path} > ${label}` : label, errors);
      }
    }

    const precision = field.format?.precision;
    if (precision !== undefined && (!Number.isInteger(precision) || precision < 0 || precision > MAX_PRECISION)) {
      errors.push(`${prefix}Field "${label}" has an invalid decimal places setting — must be a whole number from 0 to ${MAX_PRECISION}`);
    }
  }
}

export function validateFieldDefs(fields: FieldDef[]): ValidateFieldDefsResult {
  const errors: string[] = [];
  collectFieldDefErrors(fields, 1, '', errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Validates an entry's `data` against a collection's `FieldDef[]` schema.
 *
 * Rules:
 *  - `required` fields must be present with a non-empty value
 *    (`undefined`/`null`/`''` all count as missing, and so does an empty
 *    array — "required" on a list field means "at least one row").
 *  - Type checks are performed where cheap and meaningful:
 *    - `number` -> `typeof value === 'number'`
 *    - `boolean` -> `typeof value === 'boolean'`
 *    - `select` -> value must be one of `field.options`
 *    - `multiselect` -> value must be an array where every element is one
 *      of `field.options`
 *    - `taglist` -> must be an array of non-blank strings. Unlike
 *      `multiselect` there is no fixed vocabulary, so the only thing worth
 *      checking is that no entry is blank or a non-string.
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
 *    - `repeater` -> must be an array of plain objects, each of which is
 *      validated recursively against `field.fields`.
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
 * a given field — required-check takes priority over the type check). An
 * error inside a repeater row is keyed by path — `highlights[0].label` —
 * so the entry editor can show the message against the row that's actually
 * wrong instead of against the repeater as a whole.
 */

export type ValidateEntryResult = { ok: true } | { ok: false; errors: Record<string, string> };

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  // A list field that is present but empty reads, to a user, as not filled
  // in — which is what `required` is asking about.
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
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
    case 'taglist':
      if (!Array.isArray(value)) return 'must be a list';
      return value.every((v) => typeof v === 'string' && v.trim() !== '')
        ? null
        : 'must not contain blank entries';
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

function collectEntryErrors(
  fields: FieldDef[],
  data: Record<string, unknown>,
  keyPrefix: string,
  errors: Record<string, string>,
): void {
  for (const field of fields) {
    // A deprecated field is skipped entirely, not merely exempted from
    // `required`. Its value is frozen legacy data that the entry editor no
    // longer renders, so ANY error raised against it — a required value that
    // was never filled in, a legacy string in what is now a number field —
    // would block a save the user has no control to fix. Deprecating a field
    // must never be able to strand an entry.
    if (field.deprecated) continue;

    const value = data[field.key];
    const errorKey = `${keyPrefix}${field.key}`;
    const present = Object.prototype.hasOwnProperty.call(data, field.key) && !isEmpty(value);

    if (field.required && !present) {
      errors[errorKey] = `"${field.label}" is required`;
      continue;
    }

    if (!present) continue;

    if (field.type === 'repeater') {
      const subFields = field.fields;
      if (!Array.isArray(value)) {
        errors[errorKey] = `"${field.label}" must be a list`;
        continue;
      }
      // A repeater with no sub-schema has no rules to apply to its rows.
      // `validateFieldDefs` already rejects that schema; there's nothing to
      // gain from inventing entry errors for data we can't describe.
      if (!subFields || subFields.length === 0) continue;

      value.forEach((row, index) => {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) {
          errors[`${errorKey}[${index}]`] = `"${field.label}" item ${index + 1} must be a set of fields`;
          return;
        }
        collectEntryErrors(subFields, row as Record<string, unknown>, `${errorKey}[${index}].`, errors);
      });
      continue;
    }

    const typeError = checkType(field.type, value, field.options);
    if (typeError) {
      errors[errorKey] = `"${field.label}" ${typeError}`;
    }
  }
}

export function validateEntry(fields: FieldDef[], data: Record<string, unknown>): ValidateEntryResult {
  const errors: Record<string, string> = {};
  collectEntryErrors(fields, data, '', errors);
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}
