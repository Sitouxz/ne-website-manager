import { describe, expect, it } from 'vitest';
import type { FieldDef } from './types';
import { validateFieldDefs } from './validate';
import { SECTIONS_KEY, SECTION_TYPE_KEY, collectSectionsErrors, declaredSectionTypes, isSectionsField } from './sections';

const sectionsField = (subFields: FieldDef[]): FieldDef => ({
  key: SECTIONS_KEY,
  label: 'Page sections',
  type: 'repeater',
  fields: subFields,
});

const typeField: FieldDef = {
  key: SECTION_TYPE_KEY,
  label: 'Section',
  type: 'select',
  options: ['hero', 'card_grid', 'prayer_times'],
};

describe('isSectionsField', () => {
  it('binds only the reserved key on a repeater', () => {
    expect(isSectionsField(sectionsField([typeField]))).toBe(true);
    expect(isSectionsField({ key: 'sections', label: 'Sections', type: 'text' })).toBe(false);
    expect(isSectionsField({ key: 'highlights', label: 'Highlights', type: 'repeater', fields: [typeField] })).toBe(false);
  });
});

describe('the page-sections convention', () => {
  it('accepts a well-formed sections field', () => {
    expect(collectSectionsErrors(sectionsField([typeField, { key: 'heading', label: 'Heading', type: 'text' }])))
      .toEqual([]);
  });

  it('rejects sections with no type sub-field', () => {
    // Without it, a row is an anonymous field bag and every consumer has to
    // guess what it is from which keys happen to be filled in.
    const errors = collectSectionsErrors(sectionsField([{ key: 'heading', label: 'Heading', type: 'text' }]));
    expect(errors.join(' ')).toContain('needs a "type" sub-field');
  });

  it('rejects a free-text type, which would let an editor invent a section', () => {
    const errors = collectSectionsErrors(sectionsField([{ key: 'type', label: 'Section', type: 'text' }]));
    expect(errors.join(' ')).toContain('must be a Select');
  });

  it('rejects a select with no section types declared', () => {
    const errors = collectSectionsErrors(sectionsField([{ key: 'type', label: 'Section', type: 'select', options: [] }]));
    expect(errors.join(' ')).toContain('at least one section type');
  });

  it('leaves every other repeater alone', () => {
    // `highlights` on the listings template is a plain repeater and must not
    // be dragged into this convention.
    expect(
      collectSectionsErrors({
        key: 'highlights',
        label: 'Highlights',
        type: 'repeater',
        fields: [{ key: 'label', label: 'Label', type: 'text' }],
      }),
    ).toEqual([]);
  });

  it('does not retroactively invalidate an existing schema that happens to use the key', () => {
    // The rule binds at authoring time, not universally — see sections.ts.
    // A live collection with an unrelated `sections` repeater must still save.
    expect(validateFieldDefs([sectionsField([{ key: 'heading', label: 'Heading', type: 'text' }])]))
      .toEqual({ ok: true });
  });
});

describe('declaredSectionTypes', () => {
  it('lists what an editor may place on a page', () => {
    expect(declaredSectionTypes([sectionsField([typeField])])).toEqual(['hero', 'card_grid', 'prayer_times']);
  });

  it('is empty for a collection that is not a page', () => {
    expect(declaredSectionTypes([{ key: 'title', label: 'Title', type: 'text' }])).toEqual([]);
  });
});
