'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorToolbar } from './EditorToolbar';
import MediaPicker from '@/components/MediaPicker';
import type { MediaItem } from '@/app/api/media/route';

/**
 * Narrow imperative surface exposed via `ref`, instead of the raw Tiptap
 * `Editor` instance. Deliberately minimal: `focus` for a future consumer
 * that needs to move focus into the editor programmatically, and
 * `insertContent` for tests to drive real edits through the component (see
 * `RichTextEditor.test.tsx` — jsdom's contenteditable doesn't support
 * simulated typing, so tests must call into Tiptap's own commands, but they
 * do so through this narrow handle rather than reaching into `editor.state`/
 * `editor.commands`/`editor.view` directly). Do not widen this without a
 * concrete need — the whole point is that consumers build against
 * `{ valueJson, fallbackHtml, onChange }` and this handle, not against
 * Tiptap's full API surface.
 */
export interface RichTextEditorHandle {
  /** Moves focus into the editor. */
  focus: () => void;
  /** Inserts content at the end of the document (after existing content),
   * moving focus there first. Used by tests to simulate a user typing
   * without needing to know about ProseMirror positions. */
  insertContent: (content: string | object) => void;
}

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
 * ## Re-syncing content after mount
 *
 * `useEditor`'s `content` option only seeds the *initial* document — Tiptap
 * never re-reads it on later renders. Without extra handling, a parent that
 * re-renders this component with new `valueJson`/`fallbackHtml` (e.g.
 * content that finishes loading asynchronously after first paint, or the
 * same mounted instance being reused for a different record) would keep
 * showing stale content forever.
 *
 * A `useEffect` below re-syncs the document when `valueJson`/`fallbackHtml`
 * change, but it has to avoid a second failure mode: this component's own
 * `onUpdate` calls `onChange(json, html)` on every keystroke, and a typical
 * controlled-component consumer will store that in state and pass it right
 * back down as the `valueJson` prop. That "echo" is *not* new external data
 * — it's just the editor's own last edit reflected back — and calling
 * `editor.commands.setContent(...)` in response would be redundant at best
 * and would reset the cursor/selection at worst.
 *
 * The guard: a ref (`lastSyncedContentRef`) remembers, as a JSON string, the
 * content this component itself last set (whether from an incoming prop
 * sync or from its own `onUpdate`). The effect only calls `setContent` when
 * the incoming `valueJson ?? fallbackHtml` serializes to something
 * *different* from that ref — i.e. content this component didn't already
 * know about. `onUpdate` updates the same ref immediately, so by the time
 * the echoed prop comes back around, it matches and the effect no-ops.
 *
 * Tradeoffs of this approach:
 * - It compares by `JSON.stringify`, not deep-equal or reference identity.
 *   That's intentionally cheap and simple, but it means a parent that
 *   round-trips the JSON through something that reorders object keys (e.g.
 *   certain DB layers) could produce a false "this is new" mismatch — the
 *   consequence is just an extra (harmless but cursor-resetting) resync,
 *   not data loss, so this is an acceptable tradeoff for this component's
 *   scale of documents.
 * - It does not attempt to preserve cursor position across a genuine
 *   external resync (switching records, async data arriving) — `setContent`
 *   replaces the whole document, which is the correct behavior for "this is
 *   a different record now."
 *
 * Exposes a narrow `RichTextEditorHandle` via `ref` (not the raw Tiptap
 * `Editor`) — see that type's doc comment for why the surface is
 * deliberately small.
 */
const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { valueJson, fallbackHtml, onChange },
  ref,
) {
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const lastSyncedContentRef = useRef<string>(JSON.stringify(valueJson ?? fallbackHtml));

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
      const json = editor.getJSON();
      const html = editor.getHTML();
      // Record this as "known" content before calling onChange, so that if
      // the parent stores it and passes it straight back as `valueJson`, the
      // resync effect below recognizes it as an echo rather than external
      // data and leaves the document (and cursor) alone.
      lastSyncedContentRef.current = JSON.stringify(json);
      onChange(json, html);
    },
  });

  // See "Re-syncing content after mount" above.
  useEffect(() => {
    if (!editor) return;
    const incoming = valueJson ?? fallbackHtml;
    const incomingKey = JSON.stringify(incoming);
    if (incomingKey === lastSyncedContentRef.current) {
      return;
    }
    lastSyncedContentRef.current = incomingKey;
    editor.commands.setContent(incoming);
  }, [editor, valueJson, fallbackHtml]);

  useImperativeHandle<RichTextEditorHandle, RichTextEditorHandle>(
    ref,
    () => ({
      focus: () => {
        editor?.commands.focus();
      },
      insertContent: (content) => {
        // 'end' resolves to the last valid cursor position inside the
        // document (not the outer document boundary), so this appends into
        // the last block rather than creating a new empty paragraph after
        // it. `scrollIntoView: false` because this is a programmatic
        // insertion (used by tests and any future non-interactive caller),
        // not a user-driven focus change — the browser default of scrolling
        // the focused position into view isn't warranted here, and jsdom
        // (used in tests) doesn't implement the layout APIs that
        // `scrollIntoView: true` relies on.
        editor?.chain().focus('end', { scrollIntoView: false }).insertContent(content).run();
      },
    }),
    [editor],
  );

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
