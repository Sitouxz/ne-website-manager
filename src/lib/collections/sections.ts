import type { FieldDef } from './types';

/**
 * The page-sections convention (Decision 3, settled 13 August 2026 — see
 * `docs/cms-multitenancy-plan.md`).
 *
 * Page sections are an ordinary `repeater`, which is what makes them free:
 * they reuse the field system, the entry editor, the validator and the SDK
 * wholesale, with no block model of their own. The only thing added on top
 * is a convention about the row's shape, enforced here so that a schema
 * which breaks it fails a test rather than a client's homepage.
 *
 *   - Sections live under the reserved key `sections`.
 *   - Every row carries `type`: a `select` whose options are the section
 *     types that client's website can actually render. `type` names the
 *     component; the rest of the row is that component's content.
 *   - An editor picks from those options and can never invent one.
 *
 * ## Why the `type` sub-field is required rather than merely conventional
 *
 * Without it, `sections` is a list of anonymous field bags, and the only way
 * to know what a row *is* would be to guess from which keys it happens to
 * have filled in. Every consumer — the entry editor, the SDK, anything that
 * ever renders a page — would have to implement the same guess, and they
 * would drift. One required, constrained field removes the guess entirely
 * and costs an editor exactly one dropdown.
 *
 * This is deliberately the smallest possible commitment: a reserved key and
 * one sub-field. It models page sections tidily on its own terms, and it
 * happens to leave `docs/strategy-site-runtime.md` available as an
 * incremental option rather than a rewrite. Nothing here decides that
 * strategy.
 *
 * ## Why this is NOT wired into `validateFieldDefs`
 *
 * It was, briefly, and that was wrong. `validateFieldDefs` runs against every
 * schema on every save, including schemas that predate this convention — so
 * putting the rule there retroactively invalidates any existing collection
 * that happens to have a repeater keyed `sections` for some unrelated
 * purpose, and blocks its author from saving until they add a field they
 * never wanted. That is a live-site risk taken on behalf of a feature nobody
 * has built yet.
 *
 * The tell was that three existing test files already use `sections` as the
 * natural name for an ordinary repeater. If it is the obvious name in tests,
 * it is the obvious name in a hand-built client schema too, and those cannot
 * be inspected from here.
 *
 * So the convention binds at *authoring* time, not universally:
 * `templates.test.ts` gates every built-in template, so a starter schema can
 * never ship broken; and whoever builds the page-sections editor calls
 * `collectSectionsErrors` on the way in. Existing schemas are left alone.
 */

export const SECTIONS_KEY = 'sections';
export const SECTION_TYPE_KEY = 'type';

/** True for the reserved page-sections field, whatever else the schema holds. */
export function isSectionsField(field: FieldDef): boolean {
  return field.key === SECTIONS_KEY && field.type === 'repeater';
}

/**
 * Errors in a `sections` field's shape, as human-readable strings matching
 * `validateFieldDefs`'s error style. Empty array means the field is fine —
 * or is not a sections field at all, since the convention only binds the
 * reserved key.
 */
export function collectSectionsErrors(field: FieldDef): string[] {
  if (!isSectionsField(field)) return [];

  const errors: string[] = [];
  const typeField = (field.fields ?? []).find((f) => f.key === SECTION_TYPE_KEY);

  if (!typeField) {
    errors.push(
      `The "${SECTIONS_KEY}" field needs a "${SECTION_TYPE_KEY}" sub-field naming which kind of section each row is`,
    );
    return errors;
  }

  if (typeField.type !== 'select') {
    errors.push(
      `"${SECTIONS_KEY}.${SECTION_TYPE_KEY}" must be a Select, so an editor picks a section the website can actually render`,
    );
  }

  if (!typeField.options || typeField.options.length === 0) {
    errors.push(
      `"${SECTIONS_KEY}.${SECTION_TYPE_KEY}" needs at least one section type in its options`,
    );
  }

  return errors;
}

/**
 * The section types a collection's schema declares — i.e. what an editor may
 * place on a page. Empty when the collection has no sections field, which is
 * every collection that is not a page.
 */
export function declaredSectionTypes(fields: FieldDef[]): string[] {
  const sections = fields.find(isSectionsField);
  if (!sections) return [];
  const typeField = (sections.fields ?? []).find((f) => f.key === SECTION_TYPE_KEY);
  return typeField?.options ?? [];
}
