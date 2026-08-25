export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'taglist'
  | 'image'
  | 'gallery'
  | 'url'
  | 'email'
  | 'repeater'
  | 'json';

/**
 * Display configuration for a `number` field. Without this every price
 * renders as a bare integer, which is the single most common reason a
 * client's listing looks wrong on their own website.
 *
 * `precision` is a *display* concern only — `data[key]` always stores a
 * plain JS `number`, never a formatted string, so the public API and SDK
 * keep returning something a site can do arithmetic on. The editor rounds
 * the stored value to `precision` on blur so what the user sees and what
 * the site receives agree.
 */
export interface NumberFormat {
  /** Decimal places, 0–6. Omitted means "don't round". */
  precision?: number;
  /** Rendered before the value in the editor, e.g. `"S$ "`. */
  prefix?: string;
  /** Rendered after the value in the editor, e.g. `" sqft"`. */
  suffix?: string;
}

export interface FieldDef {
  key: string; // snake_case, unique within collection
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[]; // select / multiselect
  help?: string;
  /**
   * Optional panel heading in the entry editor. Fields sharing a `group`
   * render together under that heading, in the order they appear in the
   * schema; fields without one render first, ungrouped. Purely presentational
   * — it never appears in `data` and never reaches the public API.
   */
  group?: string;
  /** `number` only. */
  format?: NumberFormat;
  /**
   * `repeater` only — the shape of one row. Each row of `data[key]` is an
   * object keyed by these sub-fields' own `key`s, exactly like a top-level
   * entry's `data`, which is what lets `validateEntry` recurse into itself.
   */
  fields?: FieldDef[];
  /**
   * Retired from the entry editor, but NOT from the data or from the
   * generated SDK types. This is the safe half of "remove a field": the
   * editor stops offering it, existing values stay exactly where they are,
   * and a client website that still reads the field keeps compiling and
   * keeps rendering. Deleting it for real becomes a separate, later,
   * deliberate act — by which time the site has been updated.
   *
   * Everything that reads a schema *for a human* filters on this via
   * `visibleFields` (`./schema-changes.ts`); everything that reads it *for
   * a machine* deliberately ignores it. A deprecated field is never
   * `required` in practice — `validateEntry` skips it, because an entry
   * cannot be made to satisfy a field its editor no longer shows.
   */
  deprecated?: boolean;
}

/**
 * How many levels of `repeater` may nest. 1 = a repeater of flat rows;
 * 2 = a repeater whose rows may themselves contain a repeater (a page
 * section holding a list of cards, say). A third level is nearly always a
 * missing collection rather than a real hierarchy, so it's rejected.
 *
 * Note the schema builder UI deliberately only offers one level today — the
 * validator allows two so seeded and templated schemas (Stage 5 onboarding
 * templates) aren't boxed in by the builder's current surface.
 */
export const MAX_REPEATER_DEPTH = 2;
