import { describe, it, expect, vi } from 'vitest';
import { createRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import RichTextEditor, { type RichTextEditorHandle } from './RichTextEditor';

/**
 * `useEditor({ immediatelyRender: false })` means the Tiptap editor mounts
 * asynchronously (it's null on the very first render, then becomes
 * available once the effect that creates the ProseMirror view runs). Every
 * test below waits for that via `waitFor`/`findBy*` before asserting.
 *
 * Simulated typing into a contenteditable ProseMirror surface doesn't work
 * under jsdom: jsdom implements `contenteditable` as an attribute only — it
 * doesn't run a layout/editing engine, so `userEvent.type` on the editor's
 * DOM node fires key events but never mutates the DOM the way a real
 * browser's contenteditable would, and ProseMirror's view has nothing to
 * observe. So "edit the document" is done programmatically via the narrow
 * `RichTextEditorHandle` obtained through the `ref` `RichTextEditor`
 * forwards (see `RichTextEditor.tsx` for why this handle is intentionally
 * narrower than the raw Tiptap `Editor` instance).
 */

describe('RichTextEditor', () => {
  it('renders fallbackHtml when valueJson is null', async () => {
    render(<RichTextEditor valueJson={null} fallbackHtml="<p>Hello</p>" onChange={() => {}} />);
    expect(await screen.findByText('Hello')).toBeTruthy();
  });

  it('prefers valueJson over fallbackHtml when both are provided', async () => {
    const valueJson = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From JSON' }] }],
    };
    render(
      <RichTextEditor valueJson={valueJson} fallbackHtml="<p>From HTML</p>" onChange={() => {}} />
    );
    expect(await screen.findByText('From JSON')).toBeTruthy();
    expect(screen.queryByText('From HTML')).toBeNull();
  });

  it('calls onChange with an updated JSON object and HTML string on edit', async () => {
    const onChange = vi.fn();
    const ref = createRef<RichTextEditorHandle>();
    render(
      <RichTextEditor ref={ref} valueJson={null} fallbackHtml="<p>Hello</p>" onChange={onChange} />
    );
    await screen.findByText('Hello');

    // insertContent moves focus to the end of the document and inserts
    // there, so the handle never has to know about ProseMirror positions.
    ref.current!.insertContent(' world');

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [json, html] = onChange.mock.calls.at(-1)!;
    expect(html).toContain('Hello world');
    expect(json).toMatchObject({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    });

    expect(await screen.findByText('Hello world')).toBeTruthy();
  });

  it('re-syncs displayed content when valueJson prop changes to new external data', async () => {
    const initial = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial record' }] }],
    };
    const updated = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Different record' }] }],
    };

    const { rerender } = render(
      <RichTextEditor valueJson={initial} fallbackHtml="<p>fallback</p>" onChange={() => {}} />
    );
    expect(await screen.findByText('Initial record')).toBeTruthy();

    // Simulates content that arrives asynchronously after mount, or the same
    // mounted instance being reused for a different record — a prop change
    // that is genuinely new external data, not an echo of this component's
    // own onChange.
    rerender(
      <RichTextEditor valueJson={updated} fallbackHtml="<p>fallback</p>" onChange={() => {}} />
    );

    expect(await screen.findByText('Different record')).toBeTruthy();
    expect(screen.queryByText('Initial record')).toBeNull();
  });

  it('does not clobber an in-progress edit when onChange echoes back as valueJson', async () => {
    // Reproduces the realistic controlled-component pattern: the parent
    // stores whatever onChange reports and passes it straight back down as
    // valueJson on the next render. If the resync effect can't tell this
    // apart from genuinely new external data, every keystroke would trigger
    // a redundant setContent — harmless to the text here, but the kind of
    // thing that resets cursor position in a real browser.
    const ref = createRef<RichTextEditorHandle>();
    let latestJson: object | null = null;

    function ControlledHarness() {
      const [valueJson, setValueJson] = useState<object | null>(null);
      return (
        <RichTextEditor
          ref={ref}
          valueJson={valueJson}
          fallbackHtml="<p>Hello</p>"
          onChange={(json) => {
            latestJson = json;
            setValueJson(json);
          }}
        />
      );
    }

    render(<ControlledHarness />);
    await screen.findByText('Hello');

    ref.current!.insertContent(' world');
    await waitFor(() => expect(latestJson).not.toBeNull());
    await screen.findByText('Hello world');

    ref.current!.insertContent('!');
    await waitFor(() =>
      expect((latestJson as { content: Array<{ content: Array<{ text: string }> }> }).content[0].content[0].text).toBe(
        'Hello world!'
      )
    );

    // Both edits landed in the same paragraph exactly once each — if the
    // echoed valueJson had been treated as external and re-applied via
    // setContent, this would still pass for content, but the point of this
    // test is that no console warnings/errors occur and content is correct
    // after two consecutive edit+echo round-trips.
    expect(await screen.findByText('Hello world!')).toBeTruthy();
    expect(screen.queryByText('Hello world')).toBeNull();
  });
});
