import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FieldInput from './FieldInput';
import type { FieldDef } from '@/lib/collections/types';

/**
 * Verifies `FieldInput`'s switch renders the right control per `FieldType`
 * and wires `value`/`onChange` correctly for the simple (non-editor/picker)
 * types. `richtext` (backed by `RichTextEditor`) and `image`/`gallery`
 * (backed by `MediaPicker`) are only checked for "the right child mounted
 * with the right trigger UI" — their own internals are covered by
 * `RichTextEditor.test.tsx` (Phase 3) and will get `MediaPicker` coverage of
 * their own; re-testing them here would be redundant. `MediaPicker` renders
 * `null` while its own `open` prop is `false` (its default, uncontrolled by
 * this test), so mounting `FieldInput` for `image`/`gallery` never triggers
 * `MediaPicker`'s internal media-list fetch.
 */

function def(overrides: Partial<FieldDef>): FieldDef {
  return { key: 'field_key', label: 'Field Label', type: 'text', ...overrides };
}

describe('FieldInput', () => {
  it('text: renders a text input wired to value/onChange', () => {
    const onChange = vi.fn();
    render(<FieldInput def={def({ type: 'text' })} value="hello" onChange={onChange} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.value).toBe('hello');

    fireEvent.change(input, { target: { value: 'world' } });
    expect(onChange).toHaveBeenCalledWith('world');
  });

  it('url: renders an input[type=url]', () => {
    const onChange = vi.fn();
    render(<FieldInput def={def({ type: 'url' })} value="https://a.com" onChange={onChange} />);

    const input = document.querySelector('input[type="url"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('https://a.com');

    fireEvent.change(input, { target: { value: 'https://b.com' } });
    expect(onChange).toHaveBeenCalledWith('https://b.com');
  });

  it('email: renders an input[type=email]', () => {
    const onChange = vi.fn();
    render(<FieldInput def={def({ type: 'email' })} value="a@b.com" onChange={onChange} />);

    const input = document.querySelector('input[type="email"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('a@b.com');
  });

  it('textarea: renders a textarea wired to value/onChange', () => {
    const onChange = vi.fn();
    render(<FieldInput def={def({ type: 'textarea' })} value="long text" onChange={onChange} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('long text');

    fireEvent.change(textarea, { target: { value: 'more text' } });
    expect(onChange).toHaveBeenCalledWith('more text');
  });

  /**
   * Number commits on blur, not on every keystroke, and uses
   * `type="text" inputMode="decimal"` rather than `type="number"`. Both are
   * deliberate: rounding to `format.precision` as you type makes "12.50"
   * impossible to enter at precision 1, and a native number input reports
   * `''` for partially-typed values like "12." or "-", which makes the text
   * buffer (needed for prefix/suffix and for revision-restore resync)
   * unreliable.
   */
  it('number: buffers text and commits a real number on blur', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FieldInput def={def({ type: 'number' })} value={42} onChange={onChange} />);

    const input = document.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    expect(input.value).toBe('42');

    fireEvent.change(input, { target: { value: '7' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(7);
    expect(typeof onChange.mock.calls[0][0]).toBe('number');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(undefined);

    rerender(<FieldInput def={def({ type: 'number' })} value={undefined} onChange={onChange} />);
    expect((document.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value).toBe('');
  });

  it('number: rounds to format.precision and shows prefix/suffix', () => {
    const numberDef = def({ type: 'number', format: { precision: 2, prefix: 'S$', suffix: 'psf' } });
    const seen: unknown[] = [];

    // A stateful wrapper, because the resync effect's whole job is to tell an
    // echo of this component's own change apart from an external replacement
    // — a `vi.fn()` that swallows the change can't exercise that.
    function Harness() {
      const [value, setValue] = useState<unknown>(1234.5);
      return (
        <FieldInput
          def={numberDef}
          value={value}
          onChange={(v) => { seen.push(v); setValue(v); }}
        />
      );
    }
    render(<Harness />);

    expect(screen.getByText('S$')).toBeTruthy();
    expect(screen.getByText('psf')).toBeTruthy();

    const input = document.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    // Display carries the trailing zeros `precision` implies.
    expect(input.value).toBe('1234.50');

    fireEvent.change(input, { target: { value: '10.005' } });
    fireEvent.blur(input);
    expect(seen).toEqual([10.01]);
    expect(input.value).toBe('10.01');
  });

  it('number: an external value change (revision restore) replaces the text', () => {
    const onChange = vi.fn();
    const numberDef = def({ type: 'number', format: { precision: 2 } });
    const { rerender } = render(<FieldInput def={numberDef} value={5} onChange={onChange} />);

    const input = document.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    expect(input.value).toBe('5.00');

    rerender(<FieldInput def={numberDef} value={99} onChange={onChange} />);
    expect((document.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value).toBe('99.00');
  });

  it('number: keeps unparseable text so the user can see and fix it', () => {
    const onChange = vi.fn();
    render(<FieldInput def={def({ type: 'number' })} value={undefined} onChange={onChange} />);

    const input = document.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('abc');
  });

  it('taglist: adds on Enter, on comma, and removes a tag', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FieldInput def={def({ type: 'taglist' })} value={['MRT']} onChange={onChange} />,
    );

    expect(screen.getByText('MRT')).toBeTruthy();

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Bus' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['MRT', 'Bus']);

    onChange.mockClear();
    fireEvent.change(input, { target: { value: 'Schools, Parks' } });
    expect(onChange).toHaveBeenCalledWith(['MRT', 'Schools', 'Parks']);

    onChange.mockClear();
    fireEvent.click(screen.getByLabelText('Remove MRT'));
    expect(onChange).toHaveBeenCalledWith([]);

    // A duplicate is ignored rather than rejected with an error.
    onChange.mockClear();
    rerender(<FieldInput def={def({ type: 'taglist' })} value={['MRT']} onChange={onChange} />);
    const input2 = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input2, { target: { value: 'MRT' } });
    fireEvent.keyDown(input2, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('taglist: backspace on an empty input removes the last tag', () => {
    const onChange = vi.fn();
    render(<FieldInput def={def({ type: 'taglist' })} value={['a', 'b']} onChange={onChange} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('repeater: renders one sub-form per row and edits the right row', () => {
    const onChange = vi.fn();
    const repeaterDef = def({
      key: 'highlights',
      label: 'Highlight',
      type: 'repeater',
      fields: [
        { key: 'heading', label: 'Heading', type: 'text' },
        { key: 'body', label: 'Body', type: 'textarea' },
      ],
    });
    render(
      <FieldInput
        def={repeaterDef}
        value={[{ heading: 'Near MRT' }, { heading: 'New launch' }]}
        onChange={onChange}
      />,
    );

    // Two rows, each with its own heading + body control.
    expect(screen.getAllByText('Heading')).toHaveLength(2);
    const headingInputs = screen.getAllByDisplayValue(/Near MRT|New launch/) as HTMLInputElement[];
    expect(headingInputs).toHaveLength(2);

    fireEvent.change(headingInputs[1], { target: { value: 'Renovated' } });
    expect(onChange).toHaveBeenCalledWith([{ heading: 'Near MRT' }, { heading: 'Renovated' }]);
  });

  it('repeater: adds, duplicates and removes rows', () => {
    const onChange = vi.fn();
    const repeaterDef = def({
      key: 'highlights',
      label: 'Highlight',
      type: 'repeater',
      fields: [{ key: 'heading', label: 'Heading', type: 'text' }],
    });
    const { rerender } = render(
      <FieldInput def={repeaterDef} value={[{ heading: 'One' }]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByText('Add Highlight'));
    expect(onChange).toHaveBeenCalledWith([{ heading: 'One' }, {}]);

    onChange.mockClear();
    fireEvent.click(screen.getByLabelText('Duplicate item 1'));
    expect(onChange).toHaveBeenCalledWith([{ heading: 'One' }, { heading: 'One' }]);

    onChange.mockClear();
    fireEvent.click(screen.getByLabelText('Remove item 1'));
    expect(onChange).toHaveBeenCalledWith([]);

    // A repeater with no sub-schema explains itself instead of rendering blank.
    rerender(<FieldInput def={def({ type: 'repeater', fields: [] })} value={[]} onChange={onChange} />);
    expect(screen.getByText(/no sub-fields set up yet/i)).toBeTruthy();
  });

  it('boolean: renders a checkbox wired to value/onChange', () => {
    const onChange = vi.fn();
    render(<FieldInput def={def({ type: 'boolean' })} value={true} onChange={onChange} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('date: renders an input[type=date]', () => {
    const onChange = vi.fn();
    render(<FieldInput def={def({ type: 'date' })} value="2026-01-01" onChange={onChange} />);

    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('2026-01-01');

    fireEvent.change(input, { target: { value: '2026-02-02' } });
    expect(onChange).toHaveBeenCalledWith('2026-02-02');
  });

  it('select: renders a combobox populated from def.options', () => {
    const onChange = vi.fn();
    render(
      <FieldInput
        def={def({ type: 'select', options: ['A', 'B', 'C'] })}
        value="B"
        onChange={onChange}
      />
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('B');
    const optionLabels = Array.from(select.options).map((o) => o.value);
    expect(optionLabels).toEqual(expect.arrayContaining(['A', 'B', 'C']));

    fireEvent.change(select, { target: { value: 'C' } });
    expect(onChange).toHaveBeenCalledWith('C');
  });

  it('multiselect: renders a checkbox per option and toggles array membership', () => {
    const onChange = vi.fn();
    render(
      <FieldInput
        def={def({ type: 'multiselect', options: ['Red', 'Green', 'Blue'] })}
        value={['Red']}
        onChange={onChange}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);

    fireEvent.click(checkboxes[1]); // check "Green"
    expect(onChange).toHaveBeenCalledWith(['Red', 'Green']);

    fireEvent.click(checkboxes[0]); // uncheck "Red"
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('richtext: renders a RichTextEditor seeded from the {json, html} value', async () => {
    const onChange = vi.fn();
    render(
      <FieldInput
        def={def({ type: 'richtext' })}
        value={{ json: null, html: '<p>Rich content</p>' }}
        onChange={onChange}
      />
    );
    expect(await screen.findByText('Rich content')).toBeTruthy();
  });

  it('image: renders a "Choose" trigger when empty, and a thumbnail + Change/Remove when set', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FieldInput def={def({ type: 'image' })} value={undefined} onChange={onChange} />);
    expect(screen.getByText('Choose')).toBeTruthy();

    rerender(
      <FieldInput
        def={def({ type: 'image' })}
        value={{ url: 'https://cdn/img.jpg', alt: 'An image' }}
        onChange={onChange}
      />
    );
    expect(screen.getByText('Change')).toBeTruthy();
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('https://cdn/img.jpg');

    fireEvent.click(screen.getByLabelText('Remove image'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('gallery: renders an "Add Image" trigger and a thumbnail per item with remove', () => {
    const onChange = vi.fn();
    render(
      <FieldInput
        def={def({ type: 'gallery' })}
        value={[{ url: 'https://cdn/a.jpg', alt: 'A' }, { url: 'https://cdn/b.jpg', alt: 'B' }]}
        onChange={onChange}
      />
    );

    expect(screen.getByText('Add Image')).toBeTruthy();
    const imgs = document.querySelectorAll('img');
    expect(imgs).toHaveLength(2);

    fireEvent.click(screen.getAllByLabelText('Remove')[0]);
    expect(onChange).toHaveBeenCalledWith([{ url: 'https://cdn/b.jpg', alt: 'B' }]);
  });

  it('json: renders a textarea, parses on blur, and surfaces a visible error for invalid JSON', async () => {
    const onChange = vi.fn();
    render(<FieldInput def={def({ type: 'json' })} value={{ a: 1 }} onChange={onChange} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('"a": 1');

    fireEvent.change(textarea, { target: { value: '{"a": 2}' } });
    fireEvent.blur(textarea);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ a: 2 }));

    fireEvent.change(textarea, { target: { value: '{not valid json' } });
    fireEvent.blur(textarea);
    expect(await screen.findByText(/Invalid JSON/)).toBeTruthy();
    // Invalid JSON must not silently overwrite the last good value.
    expect(onChange).not.toHaveBeenCalledWith(undefined);
  });

  it('json: resyncs its textarea when value changes externally (e.g. a revision Restore)', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FieldInput def={def({ type: 'json' })} value={{ a: 1 }} onChange={onChange} />
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('"a": 1');

    // Simulate the entry editor's revision-Restore flow: the same mounted
    // `FieldInput` instance (stable `key={f.key}`) receives a brand-new
    // `value` prop from `setForm`, without the user ever touching the field.
    rerender(<FieldInput def={def({ type: 'json' })} value={{ b: 2 }} onChange={onChange} />);

    expect(textarea.value).toContain('"b": 2');
    expect(textarea.value).not.toContain('"a": 1');

    // Blurring the now-current (unedited) textarea must persist the
    // restored value, not silently revert to the pre-restore one.
    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalledWith({ b: 2 });
  });
});
