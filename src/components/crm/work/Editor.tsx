'use client';

import { useEffect, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Code2, Heading1, Heading2, Heading3, Highlighter, Italic, Link2, List, ListChecks, ListOrdered,
  Minus, Pilcrow, Quote, Redo2, RemoveFormatting, Strikethrough, Table as TableIcon, Underline as UnderlineIcon, Undo2, Unlink,
} from 'lucide-react';

/** The editor's extensions. Links only open http(s), mail and phone links (the default protocol check). */
export const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
  Placeholder.configure({ placeholder: 'Write the plan: the goal, who does what, by when…' }),
  TaskList, TaskItem.configure({ nested: true }),
  Highlight,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TableKit.configure({ table: { resizable: false } }),
];

export function useDocEditor(content: JSONContent | null, onChange: () => void, editable = true) {
  return useEditor({
    extensions: EXTENSIONS,
    content: content ?? undefined,
    editable,
    immediatelyRender: false,
    onUpdate: onChange,
    editorProps: { attributes: { class: 'wk-prose', 'aria-label': 'Plan text', spellcheck: 'true' } },
  }, [editable]);
}

export { EditorContent };
export type { Editor, JSONContent };

function Btn({ on, label, onClick, children, disabled }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="wk-tb-btn" aria-pressed={on} aria-label={label} title={label} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  );
}

/** The formatting bar. Every button also has a keyboard shortcut (Ctrl+B, Ctrl+I, Ctrl+Shift+8 …). */
export function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'), mark: e.isActive('highlight'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }), p: e.isActive('paragraph'),
      ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), task: e.isActive('taskList'), quote: e.isActive('blockquote'), code: e.isActive('codeBlock'),
      link: e.isActive('link'), table: e.isActive('table'),
      left: e.isActive({ textAlign: 'left' }), center: e.isActive({ textAlign: 'center' }), right: e.isActive({ textAlign: 'right' }),
      undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const c = () => editor.chain().focus();
  const applyLink = () => {
    const u = url.trim();
    if (!u) c().extendMarkRange('link').unsetLink().run();
    else c().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|tel:|\/)/i.test(u) ? u : `https://${u}` }).run();
    setLinkOpen(false); setUrl('');
  };
  return (
    <div className="wk-tb" role="toolbar" aria-label="Formatting">
      <Btn label="Undo (Ctrl+Z)" onClick={() => c().undo().run()} disabled={!s.undo}><Undo2 size={16} /></Btn>
      <Btn label="Redo (Ctrl+Y)" onClick={() => c().redo().run()} disabled={!s.redo}><Redo2 size={16} /></Btn>
      <span className="wk-tb-sep" />
      <Btn label="Normal text" on={s.p && !s.h1 && !s.h2 && !s.h3} onClick={() => c().setParagraph().run()}><Pilcrow size={16} /></Btn>
      <Btn label="Big heading" on={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></Btn>
      <Btn label="Heading" on={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></Btn>
      <Btn label="Small heading" on={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}><Heading3 size={16} /></Btn>
      <span className="wk-tb-sep" />
      <Btn label="Bold (Ctrl+B)" on={s.bold} onClick={() => c().toggleBold().run()}><Bold size={16} /></Btn>
      <Btn label="Italic (Ctrl+I)" on={s.italic} onClick={() => c().toggleItalic().run()}><Italic size={16} /></Btn>
      <Btn label="Underline (Ctrl+U)" on={s.underline} onClick={() => c().toggleUnderline().run()}><UnderlineIcon size={16} /></Btn>
      <Btn label="Strike through" on={s.strike} onClick={() => c().toggleStrike().run()}><Strikethrough size={16} /></Btn>
      <Btn label="Highlight" on={s.mark} onClick={() => c().toggleHighlight().run()}><Highlighter size={16} /></Btn>
      <span className="wk-tb-sep" />
      <Btn label="Bullet list" on={s.ul} onClick={() => c().toggleBulletList().run()}><List size={16} /></Btn>
      <Btn label="Numbered list" on={s.ol} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={16} /></Btn>
      <Btn label="To-do list" on={s.task} onClick={() => c().toggleTaskList().run()}><ListChecks size={16} /></Btn>
      <Btn label="Quote" on={s.quote} onClick={() => c().toggleBlockquote().run()}><Quote size={16} /></Btn>
      <Btn label="Code" on={s.code} onClick={() => c().toggleCodeBlock().run()}><Code2 size={16} /></Btn>
      <Btn label="Divider line" onClick={() => c().setHorizontalRule().run()}><Minus size={16} /></Btn>
      <span className="wk-tb-sep" />
      <Btn label="Align left" on={s.left} onClick={() => c().setTextAlign('left').run()}><AlignLeft size={16} /></Btn>
      <Btn label="Centre" on={s.center} onClick={() => c().setTextAlign('center').run()}><AlignCenter size={16} /></Btn>
      <Btn label="Align right" on={s.right} onClick={() => c().setTextAlign('right').run()}><AlignRight size={16} /></Btn>
      <span className="wk-tb-sep" />
      <Btn label={s.link ? 'Change link' : 'Add link'} on={s.link} onClick={() => { setUrl(editor.getAttributes('link').href ?? ''); setLinkOpen((o) => !o); }}><Link2 size={16} /></Btn>
      {s.link && <Btn label="Remove link" onClick={() => c().extendMarkRange('link').unsetLink().run()}><Unlink size={16} /></Btn>}
      <Btn label="Insert table" on={s.table} onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={16} /></Btn>
      <Btn label="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={16} /></Btn>
      {s.table && (
        <span className="wk-tb-table">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => c().addRowAfter().run()}>+ Row</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => c().addColumnAfter().run()}>+ Column</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => c().deleteRow().run()}>− Row</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => c().deleteColumn().run()}>− Column</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => c().deleteTable().run()}>Remove table</button>
        </span>
      )}
      {linkOpen && (
        <form className="wk-tb-link" onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
          <input className="crm-input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link" aria-label="Link address"
            onKeyDown={(e) => { if (e.key === 'Escape') setLinkOpen(false); }} />
          <button type="submit" className="crm-btn is-sm">Apply</button>
        </form>
      )}
    </div>
  );
}

/** Read-only view of a saved version (History). */
export function ReadOnly({ content }: { content: JSONContent }) {
  const editor = useEditor({ extensions: EXTENSIONS, content, editable: false, immediatelyRender: false, editorProps: { attributes: { class: 'wk-prose' } } });
  useEffect(() => { if (editor && content) editor.commands.setContent(content); }, [editor, content]);
  return <EditorContent editor={editor} />;
}
