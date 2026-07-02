'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorToolbar } from './EditorToolbar';
import MediaPicker from '@/components/MediaPicker';
import type { MediaItem } from '@/app/api/media/route';

export interface RichTextEditorProps {
  /** Tiptap JSON document. When present, takes precedence over `fallbackHtml`
   * as the initial content — this is the shape posts/pages persist once
   * they've been edited at least once through this component. */
  valueJson: object | null;
  /** HTML used as the initial content when `valueJson` is null (e.g. content
   * authored before this editor existed, or seeded from elsewhere as HTML). */
  fallbackHtml: string;
  /** Fired on every edit with both representations — Tiptap always keeps
   * both in sync, so callers can persist whichever their schema wants
   * (JSON for round-tripping, HTML for read-only rendering) without a
   * second conversion step. Not debounced here: the post/page editor
   * (Task 3.3) owns its own autosave debounce, so debouncing again at this
   * layer would just add a second timer to reason about for no benefit. */
  onChange: (json: object, html: string) => void;
}

/**
 * Tiptap-based rich text editor, the shared foundation consumed by the post
 * editor, page editor, and (Phase 4) the collections rich-text field type.
 *
 * Extensions: StarterKit (bold/italic/blockquote/code block/bullet+ordered
 * lists/horizontal rule, headings restricted to levels 2-4 — H1 is reserved
 * for the page/post title rendered outside the editor), Link (configured
 * separately from StarterKit's bundled link so `openOnClick`/`autolink` are
 * explicit rather than relying on StarterKit's defaults), Image (inserted
 * via `MediaPicker`, never a raw URL prompt), and Placeholder.
 *
 * `immediatelyRender: false` avoids the SSR hydration mismatch Tiptap logs
 * a warning about otherwise (this component renders under the app's normal
 * server-rendered client-component tree, not a client-only route) — it
 * means `editor` is `null` on the very first render and becomes non-null
 * once mounted; `EditorToolbar` and this component both handle that.
 *
 * Exposes the underlying Tiptap `Editor` via `ref` (in addition to the exact
 * `{ valueJson, fallbackHtml, onChange }` prop contract, which is
 * unchanged) so tests — and future consumers that need to e.g. imperatively
 * focus the editor — can reach it without widening the props API.
 */
const RichTextEditor = forwardRef<Editor | null, RichTextEditorProps>(function RichTextEditor(
  { valueJson, fallbackHtml, onChange },
  ref,
) {
  const [imagePickerOpen, setImagePickerOpen] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    content: valueJson ?? fallbackHtml,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        // Configured as a standalone extension below instead, so link
        // behavior (openOnClick, autolink) is explicit rather than left to
        // StarterKit's bundled defaults.
        link: false,
        // New to StarterKit as of Tiptap 3 (v2's StarterKit didn't include
        // it); the brief's extension list doesn't call for it and the
        // toolbar has no button for it, so it stays off rather than being a
        // silent extra feature.
        underline: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Image,
      Placeholder.configure({
        placeholder: 'Start writing…',
      }),
    ],
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON(), editor.getHTML());
    },
  });

  useImperativeHandle<Editor | null, Editor | null>(ref, () => editor, [editor]);

  function handleImageSelect(item: MediaItem) {
    editor?.chain().focus().setImage({ src: item.url, alt: item.alt ?? undefined }).run();
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
      }}
    >
      <EditorToolbar editor={editor} onImageClick={() => setImagePickerOpen(true)} />
      <div style={{ padding: '14px 16px', minHeight: 200, color: 'var(--fg1)', fontSize: 14 }}>
        <EditorContent editor={editor} />
      </div>
      <MediaPicker
        open={imagePickerOpen}
        onOpenChange={setImagePickerOpen}
        accept="image"
        onSelect={handleImageSelect}
      />
    </div>
  );
});

export default RichTextEditor;
