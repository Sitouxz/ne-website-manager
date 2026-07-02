'use client';

import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Heading2, Heading3, Heading4, List, ListOrdered,
  Quote, Code, Link2, Image as ImageIcon, Minus,
} from 'lucide-react';

/**
 * Icon-button toolbar for `RichTextEditor`. Pure presentation over a Tiptap
 * `Editor` instance — every action is `editor.chain().focus().<cmd>().run()`,
 * and active-state highlighting comes straight from `editor.isActive(...)`.
 *
 * `editor` is nullable because `useEditor({ immediatelyRender: false })`
 * (required to avoid Next.js SSR hydration mismatches — Tiptap renders into
 * a client-only ProseMirror DOM tree) returns `null` until the editor mounts
 * on the client. Buttons render disabled rather than the toolbar
 * disappearing, so there's no layout shift while the editor initializes.
 *
 * Image insertion doesn't call an editor command directly here — it defers
 * to `onImageClick`, which `RichTextEditor` wires up to open `MediaPicker`
 * and call `setImage` once the user picks a file. That keeps this component
 * free of any MediaPicker/data-fetching concerns.
 */
function ToolbarButton({
  onClick,
  active = false,
  disabled = false,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        border: 'none',
        borderRadius: 'var(--r-sm)',
        background: active ? 'var(--ne-blue)' : 'transparent',
        color: active ? '#fff' : 'var(--fg2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function EditorToolbar({
  editor,
  onImageClick,
}: {
  editor: Editor | null;
  onImageClick: () => void;
}) {
  const disabled = !editor;

  function setLink() {
    if (!editor) return;
    const previousUrl = (editor.getAttributes('link').href as string | undefined) ?? '';
    const url = window.prompt('URL', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        padding: '6px 8px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface-2)',
        position: 'sticky',
        top: 0,
        zIndex: 1,
      }}
    >
      <ToolbarButton
        label="Bold"
        disabled={disabled}
        active={editor?.isActive('bold') ?? false}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        disabled={disabled}
        active={editor?.isActive('italic') ?? false}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 2"
        disabled={disabled}
        active={editor?.isActive('heading', { level: 2 }) ?? false}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        disabled={disabled}
        active={editor?.isActive('heading', { level: 3 }) ?? false}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 4"
        disabled={disabled}
        active={editor?.isActive('heading', { level: 4 }) ?? false}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 4 }).run()}
      >
        <Heading4 size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Bullet list"
        disabled={disabled}
        active={editor?.isActive('bulletList') ?? false}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Ordered list"
        disabled={disabled}
        active={editor?.isActive('orderedList') ?? false}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        disabled={disabled}
        active={editor?.isActive('blockquote') ?? false}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        disabled={disabled}
        active={editor?.isActive('codeBlock') ?? false}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <Code size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Link"
        disabled={disabled}
        active={editor?.isActive('link') ?? false}
        onClick={setLink}
      >
        <Link2 size={16} />
      </ToolbarButton>
      <ToolbarButton label="Image" disabled={disabled} onClick={onImageClick}>
        <ImageIcon size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Horizontal rule"
        disabled={disabled}
        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={16} />
      </ToolbarButton>
    </div>
  );
}
