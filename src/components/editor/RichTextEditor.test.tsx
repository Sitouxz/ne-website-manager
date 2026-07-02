import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import RichTextEditor from './RichTextEditor';

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
 * observe. So "edit the document" is done programmatically via the Tiptap
 * `Editor` instance obtained through the `ref` `RichTextEditor` forwards
 * (see `RichTextEditor.tsx` for why the ref exists alongside the exact
 * `{ valueJson, fallbackHtml, onChange }` prop contract).
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
    const ref = createRef<Editor | null>();
    render(
      <RichTextEditor ref={ref} valueJson={null} fallbackHtml="<p>Hello</p>" onChange={onChange} />
    );
    await screen.findByText('Hello');

    await waitFor(() => expect(ref.current).not.toBeNull());
    // Insert inside the last paragraph's text (content.size - 1), not at the
    // document's outer boundary (content.size) — inserting loose text at the
    // very end of the doc sits between blocks, not inside one, so Tiptap
    // wraps it in a *new* paragraph instead of appending to the existing text.
    const insertPos = ref.current!.state.doc.content.size - 1;
    ref.current!.commands.insertContentAt(insertPos, ' world');

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
});
