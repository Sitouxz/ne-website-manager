import { describe, it, expect, vi } from 'vitest';
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

  it('number: renders an input[type=number] and coerces to/from number', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FieldInput def={def({ type: 'number' })} value={42} onChange={onChange} />);

    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('42');

    fireEvent.change(input, { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(7);
    expect(typeof onChange.mock.calls[0][0]).toBe('number');

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(undefined);

    rerender(<FieldInput def={def({ type: 'number' })} value={undefined} onChange={onChange} />);
    expect((document.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('');
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
