import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import {
  Bold, Code, CodeXml, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Minus, Pilcrow, Quote,
  Redo2, Strikethrough, Table as TableIcon, Undo2,
} from 'lucide-react';
import { editorHtmlToMarkdown, looksLikeMarkdown, markdownToEditorHtml } from '../lib/markdown';

/**
 * Éditeur visuel : on clique sur « Titre », « Gras », « Liste »… sans taper de Markdown.
 * Le contenu est converti en Markdown à chaque modification (c'est ce qui est enregistré).
 * Les raccourcis Markdown restent possibles : « ## » + espace, « - » + espace, **gras**…
 */
export function NoteEditor({ initial, onChange, getRef, placeholder }: {
  initial: string;
  onChange: (md: string) => void;
  /** Lecture immédiate du Markdown courant (fermeture de l'éditeur). */
  getRef: MutableRefObject<(() => string) | null>;
  placeholder?: string;
}) {
  const html = useRef('');
  const timer = useRef<number>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        underline: false, // pas de souligné en Markdown
        link: { openOnClick: false, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      Placeholder.configure({ placeholder: placeholder ?? 'Écris ici…' }),
    ],
    content: markdownToEditorHtml(initial),
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'prose nt-rich', spellcheck: 'true' },
      // Texte brut en Markdown (bouton « Copier » de Claude) : collé mis en forme.
      handlePaste: (_view, event) => {
        const plain = event.clipboardData?.getData('text/plain') ?? '';
        const hasHtml = !!event.clipboardData?.getData('text/html');
        if (hasHtml || !looksLikeMarkdown(plain)) return false;
        editorRef.current?.chain().focus().insertContent(markdownToEditorHtml(plain)).run();
        return true;
      },
    },
    onCreate: ({ editor: e }) => { html.current = e.getHTML(); },
    onUpdate: ({ editor: e }) => {
      html.current = e.getHTML();
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => onChangeRef.current(editorHtmlToMarkdown(html.current)), 350);
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    getRef.current = () => editorHtmlToMarkdown(html.current || markdownToEditorHtml(initial));
    return () => { clearTimeout(timer.current); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null;
  return (
    <div className="nt-rich-wrap">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Btn({ on, title, run, children, disabled }: { on?: boolean; title: string; run: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button" className={`tb-btn ${on ? 'on' : ''}`} title={title} aria-label={title} aria-pressed={on} disabled={disabled}
      onMouseDown={e => e.preventDefault()} // garde la sélection dans l'éditeur
      onClick={run}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      p: e.isActive('paragraph'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), code: e.isActive('code'), link: e.isActive('link'),
      ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), task: e.isActive('taskList'),
      quote: e.isActive('blockquote'), pre: e.isActive('codeBlock'), table: e.isActive('table'),
      undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();

  const link = () => {
    if (s.link) { c().extendMarkRange('link').unsetLink().run(); return; }
    const url = prompt('Adresse du lien', 'https://');
    if (!url || url === 'https://') return;
    const href = /^(https?:|mailto:|#|\/)/i.test(url) ? url : 'https://' + url;
    if (editor.state.selection.empty) c().insertContent(`<a href="${href.replace(/"/g, '&quot;')}">${url}</a>`).run();
    else c().extendMarkRange('link').setLink({ href }).run();
  };

  return (
    <div className="nt-toolbar" role="toolbar" aria-label="Mise en forme">
      <div className="tb-group">
        <Btn on={s.p && !s.ul && !s.ol && !s.task && !s.quote} title="Texte normal" run={() => c().setParagraph().run()}><Pilcrow size={16} /></Btn>
        <Btn on={s.h1} title="Grand titre" run={() => c().toggleHeading({ level: 1 }).run()}><Heading1 size={17} /></Btn>
        <Btn on={s.h2} title="Titre de section" run={() => c().toggleHeading({ level: 2 }).run()}><Heading2 size={17} /></Btn>
        <Btn on={s.h3} title="Sous-titre" run={() => c().toggleHeading({ level: 3 }).run()}><Heading3 size={17} /></Btn>
      </div>
      <div className="tb-group">
        <Btn on={s.bold} title="Gras (Ctrl B)" run={() => c().toggleBold().run()}><Bold size={16} /></Btn>
        <Btn on={s.italic} title="Italique (Ctrl I)" run={() => c().toggleItalic().run()}><Italic size={16} /></Btn>
        <Btn on={s.strike} title="Barré" run={() => c().toggleStrike().run()}><Strikethrough size={16} /></Btn>
        <Btn on={s.code} title="Code dans le texte" run={() => c().toggleCode().run()}><Code size={16} /></Btn>
        <Btn on={s.link} title={s.link ? 'Retirer le lien' : 'Lien'} run={link}><Link2 size={16} /></Btn>
      </div>
      <div className="tb-group">
        <Btn on={s.ul} title="Liste à puces" run={() => c().toggleBulletList().run()}><List size={17} /></Btn>
        <Btn on={s.ol} title="Liste numérotée" run={() => c().toggleOrderedList().run()}><ListOrdered size={17} /></Btn>
        <Btn on={s.task} title="Cases à cocher" run={() => c().toggleTaskList().run()}><ListChecks size={17} /></Btn>
      </div>
      <div className="tb-group">
        <Btn on={s.quote} title="Citation" run={() => c().toggleBlockquote().run()}><Quote size={16} /></Btn>
        <Btn on={s.pre} title="Bloc de code" run={() => c().toggleCodeBlock().run()}><CodeXml size={16} /></Btn>
        <Btn title="Séparateur" run={() => c().setHorizontalRule().run()}><Minus size={17} /></Btn>
        <Btn on={s.table} title="Tableau" run={() => !s.table && c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={16} /></Btn>
      </div>
      {s.table && (
        <div className="tb-group tb-table">
          <button type="button" className="tb-text" onMouseDown={e => e.preventDefault()} onClick={() => c().addRowAfter().run()}>+ Ligne</button>
          <button type="button" className="tb-text" onMouseDown={e => e.preventDefault()} onClick={() => c().addColumnAfter().run()}>+ Colonne</button>
          <button type="button" className="tb-text" onMouseDown={e => e.preventDefault()} onClick={() => c().deleteRow().run()}>− Ligne</button>
          <button type="button" className="tb-text" onMouseDown={e => e.preventDefault()} onClick={() => c().deleteColumn().run()}>− Colonne</button>
          <button type="button" className="tb-text danger" onMouseDown={e => e.preventDefault()} onClick={() => c().deleteTable().run()}>Supprimer</button>
        </div>
      )}
      <span className="grow" />
      <div className="tb-group">
        <Btn title="Annuler (Ctrl Z)" run={() => c().undo().run()} disabled={!s.undo}><Undo2 size={16} /></Btn>
        <Btn title="Rétablir (Ctrl Y)" run={() => c().redo().run()} disabled={!s.redo}><Redo2 size={16} /></Btn>
      </div>
    </div>
  );
}
