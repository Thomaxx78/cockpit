import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type ReactNode } from 'react';
import {
  ArrowLeft, Check, ChevronRight, ClipboardPaste, Copy, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Link2, NotebookPen,
  Pencil, Trash2,
} from 'lucide-react';
import { useEditors } from '../components/editors';
import { AutoTextarea } from '../components/ui';
import { features, noteDescendants } from '../lib/backend';
import { clipboardToMarkdown, firstHeading, readClipboard, renderMarkdown, withoutTitle } from '../lib/markdown';
import { newId, useStore } from '../lib/store';
import { isActive, type Note } from '../lib/types';
import { go, MOBILE, useMedia } from '../lib/utils';
import '../styles/notes.css';

const UNTITLED = 'Sans titre';
const OPEN_KEY = 'cockpit-notes-open';
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const sortNotes = (a: Note, b: Note) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1);

const readOpen = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** Chemin des dossiers parents (du plus haut au plus proche). */
function ancestors(notes: Note[], n: Note | undefined) {
  const out: Note[] = [];
  for (let p = n?.parent_id; p && out.length < 50;) {
    const f = notes.find(x => x.id === p);
    if (!f) break;
    out.unshift(f);
    p = f.parent_id;
  }
  return out;
}

const ago = (iso: string | null) => {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  if (min < 60 * 24) return `il y a ${Math.round(min / 60)} h`;
  return 'le ' + new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};

const typingTarget = (t: EventTarget | null) => t instanceof HTMLElement && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable);

export function Notes({ id }: { id?: string }) {
  const { db, saveNote, deleteNote, toast, backendKind } = useStore();
  const mobile = useMedia(MOBILE);
  const notes = db.notes;
  const current = id ? notes.find(n => n.id === id && n.kind === 'file') : undefined;
  const [open, setOpen] = useState<string[]>(readOpen);
  const [renaming, setRenaming] = useState<string | null>(null);

  const setOpenPersist = useCallback((f: (o: string[]) => string[]) => setOpen(o => {
    const next = f(o);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* stockage indisponible */ }
    return next;
  }), []);
  const toggle = (fid: string) => setOpenPersist(o => (o.includes(fid) ? o.filter(x => x !== fid) : [...o, fid]));

  // Dossiers de la note ouverte toujours dépliés.
  useEffect(() => {
    const path = ancestors(notes, current).map(f => f.id);
    if (path.some(p => !open.includes(p))) setOpenPersist(o => [...new Set([...o, ...path])]);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextPos = () => Math.max(0, ...notes.map(n => n.position)) + 1;

  const create = (kind: Note['kind'], parent: string | null, content = '') => {
    const n: Note = {
      id: newId('n'), parent_id: parent, kind, content, task_id: null, position: nextPos(), updated_at: null,
      name: kind === 'folder' ? 'Nouveau dossier' : firstHeading(content) ?? UNTITLED,
    };
    saveNote(n);
    if (parent) setOpenPersist(o => (o.includes(parent) ? o : [...o, parent]));
    if (kind === 'folder') setRenaming(n.id);
    else go('notes/' + n.id);
    return n;
  };
  /** Dossier où créer : celui de la note ouverte, sinon la racine. */
  const here = current?.parent_id ?? null;

  const createFromText = (md: string) => {
    if (!md.trim()) return toast('Le presse-papier est vide', 'error');
    create('file', here, md);
    toast('Note créée depuis le presse-papier');
  };
  const pasteNew = async () => {
    try { createFromText(await readClipboard()); }
    catch { toast('Accès au presse-papier refusé : utilise Ctrl V', 'error'); }
  };

  // Ctrl V sur la page (hors champ de saisie) : crée une note, ou remplit la note vide ouverte.
  const contentRef = useRef(current);
  contentRef.current = current;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (typingTarget(e.target) || document.querySelector('.backdrop')) return;
      const md = clipboardToMarkdown(e.clipboardData?.getData('text/plain') ?? '', e.clipboardData?.getData('text/html'));
      if (!md) return;
      e.preventDefault();
      const cur = contentRef.current;
      if (cur && !cur.content.trim()) {
        saveNote({ ...cur, content: md, name: cur.name === UNTITLED ? firstHeading(md) ?? UNTITLED : cur.name });
      } else createFromText(md);
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  });

  const remove = (n: Note) => {
    const inside = noteDescendants(notes, n.id).size - 1;
    const msg = n.kind === 'folder'
      ? `Supprimer le dossier « ${n.name} »${inside ? ` et les ${inside} éléments qu’il contient` : ''} ?`
      : `Supprimer la note « ${n.name} » ?`;
    if (!confirm(msg)) return;
    deleteNote(n.id);
    toast(n.kind === 'folder' ? 'Dossier supprimé' : 'Note supprimée');
    if (current && noteDescendants(notes, n.id).has(current.id)) go('notes');
  };

  const rename = (n: Note, name: string) => {
    setRenaming(null);
    const v = name.trim();
    if (v && v !== n.name) saveNote({ ...n, name: v });
  };

  if (backendKind === 'supabase' && !features.notes) {
    return (
      <div className="page"><div className="notice">
        Les notes ont besoin d’une nouvelle table : relance <code>supabase/schema.sql</code> dans Supabase &gt; SQL Editor, puis recharge la page.
      </div></div>
    );
  }

  const tree = (
    <aside className="nt-side" aria-label="Dossiers et notes">
      <div className="nt-side-head">
        <h2>Notes</h2>
        <div className="nt-side-actions">
          <button className="icon-btn" title="Nouvelle note" aria-label="Nouvelle note" onClick={() => create('file', here)}><FilePlus2 size={17} /></button>
          <button className="icon-btn" title="Nouveau dossier" aria-label="Nouveau dossier" onClick={() => create('folder', here)}><FolderPlus size={17} /></button>
        </div>
      </div>
      <button className="btn primary wide nt-paste" onClick={pasteNew}><ClipboardPaste size={16} /> Coller une note</button>
      <div className="nt-tree" role="tree">
        {notes.length
          ? <Branch parent={null} depth={0} {...{ notes, open, toggle, current, renaming, setRenaming, rename, create, remove }} />
          : <p className="nt-empty-tree">Aucune note pour l’instant. Copie une réponse de Claude, puis « Coller une note » ou <kbd>Ctrl V</kbd>.</p>}
      </div>
    </aside>
  );

  const doc = current
    ? <NoteDoc key={current.id} note={current} onDelete={() => remove(current)} mobile={mobile} />
    : <Welcome onPaste={pasteNew} onNew={() => create('file', null)} />;

  if (mobile) return <div className="notes">{id && current ? doc : tree}</div>;
  return <div className="notes">{tree}{doc}</div>;
}

type BranchProps = {
  parent: string | null; depth: number; notes: Note[]; open: string[]; toggle: (id: string) => void; current?: Note;
  renaming: string | null; setRenaming: (id: string | null) => void; rename: (n: Note, name: string) => void;
  create: (kind: Note['kind'], parent: string | null) => void; remove: (n: Note) => void;
};

function Branch(p: BranchProps) {
  const { db } = useStore();
  const items = p.notes.filter(n => n.parent_id === p.parent).sort(sortNotes);
  return <>
    {items.map(n => {
      const isOpen = p.open.includes(n.id);
      const folder = n.kind === 'folder';
      const task = n.task_id ? db.tasks.find(t => t.id === n.task_id) : undefined;
      const label = p.renaming === n.id
        ? <input
            className="nt-rename" autoFocus defaultValue={n.name} aria-label="Nom"
            onFocus={e => e.target.select()}
            onBlur={e => p.rename(n, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') p.setRenaming(null); }}
          />
        : <span className="nt-name">{n.name}</span>;
      return (
        <div key={n.id} role="treeitem" aria-expanded={folder ? isOpen : undefined} aria-selected={p.current?.id === n.id}>
          <div className={`nt-row ${p.current?.id === n.id ? 'active' : ''}`} style={{ ['--d' as string]: p.depth }}>
            <button
              className="nt-main"
              onClick={() => (folder ? p.toggle(n.id) : go('notes/' + n.id))}
              onDoubleClick={() => folder && p.setRenaming(n.id)}
            >
              {folder
                ? <><ChevronRight size={14} className={`nt-chev ${isOpen ? 'open' : ''}`} />{isOpen ? <FolderOpen size={16} className="nt-ico folder" /> : <Folder size={16} className="nt-ico folder" />}</>
                : <><span className="nt-chev-space" /><FileText size={16} className="nt-ico" /></>}
              {label}
              {task && <Link2 size={13} className="nt-linked" aria-label={`Liée au ticket ${task.name}`} />}
            </button>
            {folder && p.renaming !== n.id && (
              <span className="nt-row-actions">
                <button className="icon-btn" title="Nouvelle note ici" aria-label="Nouvelle note dans ce dossier" onClick={() => p.create('file', n.id)}><FilePlus2 size={15} /></button>
                <button className="icon-btn" title="Nouveau sous-dossier" aria-label="Nouveau sous-dossier" onClick={() => p.create('folder', n.id)}><FolderPlus size={15} /></button>
                <button className="icon-btn" title="Renommer" aria-label="Renommer le dossier" onClick={() => p.setRenaming(n.id)}><Pencil size={14} /></button>
                <button className="icon-btn" title="Supprimer" aria-label="Supprimer le dossier" onClick={() => p.remove(n)}><Trash2 size={14} /></button>
              </span>
            )}
          </div>
          {folder && isOpen && (
            p.notes.some(c => c.parent_id === n.id)
              ? <div role="group"><Branch {...p} parent={n.id} depth={p.depth + 1} /></div>
              : <div className="nt-row nt-empty-folder" style={{ ['--d' as string]: p.depth + 1 }}>Dossier vide</div>
          )}
        </div>
      );
    })}
  </>;
}

function Welcome({ onPaste, onNew }: { onPaste: () => void; onNew: () => void }) {
  return (
    <section className="nt-doc nt-welcome">
      <div className="nt-welcome-ico"><NotebookPen size={26} /></div>
      <h3>Tes notes, mises en forme automatiquement</h3>
      <p>Demande à Claude (ou à un autre assistant) de te rédiger une note, copie sa réponse, puis colle-la ici : titres, listes, tableaux et code s’affichent directement mis en forme.</p>
      <div className="row-gap">
        <button className="btn primary" onClick={onPaste}><ClipboardPaste size={16} /> Coller une note</button>
        <button className="btn" onClick={onNew}><FilePlus2 size={16} /> Note vide</button>
      </div>
      <p className="hint">Astuce : <kbd>Ctrl V</kbd> n’importe où sur cette page crée une note.</p>
    </section>
  );
}

function NoteDoc({ note, onDelete, mobile }: { note: Note; onDelete: () => void; mobile: boolean }) {
  const { db, saveNote, toast } = useStore();
  const { editTask } = useEditors();
  const [draft, setDraft] = useState<string | null>(null); // null : lecture ; texte : en cours de modification
  const [name, setName] = useState(note.name);
  const timer = useRef<number>();
  const latest = useRef(note);
  latest.current = note;
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => setName(note.name), [note.name]);

  const flush = useCallback((text: string) => {
    clearTimeout(timer.current);
    if (text !== latest.current.content) saveNote({ ...latest.current, content: text });
  }, [saveNote]);
  // Enregistre ce qui reste à la fermeture de la note.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => () => { if (draftRef.current !== null) flush(draftRef.current); }, [flush]);

  const change = (text: string) => {
    setDraft(text);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(text), 700);
  };
  const finish = () => { if (draft !== null) flush(draft); setDraft(null); };

  const saveName = () => {
    const v = name.trim() || UNTITLED;
    setName(v);
    if (v !== note.name) saveNote({ ...note, name: v });
  };

  const replaceFromClipboard = async () => {
    if (note.content.trim() && !confirm('Remplacer le contenu de la note par le presse-papier ?')) return;
    try {
      const md = await readClipboard();
      if (!md) return toast('Le presse-papier est vide', 'error');
      saveNote({ ...note, content: md, name: note.name === UNTITLED ? firstHeading(md) ?? UNTITLED : note.name });
      setDraft(null);
      toast('Note mise à jour');
    } catch { toast('Accès au presse-papier refusé : utilise Ctrl V', 'error'); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(draft ?? note.content); toast('Markdown copié'); }
    catch { toast('Copie impossible', 'error'); }
  };

  // Collage dans l'éditeur : une sélection HTML est convertie en Markdown au lieu de perdre sa mise en forme.
  const pasteInEditor = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');
    const md = clipboardToMarkdown(plain, html);
    if (!html || md === plain.trim()) return; // collage normal
    e.preventDefault();
    const el = e.currentTarget;
    const v = el.value.slice(0, el.selectionStart) + md + el.value.slice(el.selectionEnd);
    change(v);
  };

  const { html, headings } = useMemo(() => renderMarkdown(withoutTitle(note.content, note.name)), [note.content, note.name]);

  // Bouton « Copier » sur chaque bloc de code.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    root.querySelectorAll('pre').forEach(pre => {
      if (pre.querySelector('.md-copy')) return;
      const b = document.createElement('button');
      b.className = 'md-copy';
      b.type = 'button';
      b.textContent = 'Copier';
      b.onclick = async () => {
        try { await navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? ''); b.textContent = 'Copié ✓'; setTimeout(() => { b.textContent = 'Copier'; }, 1400); } catch { /* ignoré */ }
      };
      pre.appendChild(b);
    });
  }, [html, draft]);

  const path = ancestors(db.notes, note);
  const folders = db.notes.filter(n => n.kind === 'folder');
  const folderLabel = (f: Note) => [...ancestors(db.notes, f), f].map(x => x.name).join(' / ');
  const task = note.task_id ? db.tasks.find(t => t.id === note.task_id) : undefined;
  const tasks = [...db.tasks].sort((a, b) => Number(!isActive(a.status)) - Number(!isActive(b.status)) || collator.compare(a.name, b.name));
  const empty = !note.content.trim() && draft === null;
  const toc = !mobile && draft === null && headings.length >= 3;

  return (
    <section className="nt-doc">
      <div className="nt-doc-bar">
        {mobile && <button className="btn ghost back" onClick={() => go('notes')}><ArrowLeft size={16} /> Notes</button>}
        <nav className="nt-crumbs" aria-label="Emplacement">
          <span>Notes</span>
          {path.map(f => <span key={f.id}><ChevronRight size={13} />{f.name}</span>)}
        </nav>
        <span className="grow" />
        <div className="nt-tools">
          {draft === null
            ? <button className="btn" onClick={() => setDraft(note.content)}><Pencil size={15} /> <span className="hide-sm">Modifier</span></button>
            : <button className="btn primary" onClick={finish}><Check size={15} /> Terminé</button>}
          <button className="icon-btn bordered" title="Remplacer par le presse-papier" aria-label="Remplacer par le presse-papier" onClick={replaceFromClipboard}><ClipboardPaste size={16} /></button>
          <button className="icon-btn bordered" title="Copier le Markdown" aria-label="Copier le Markdown" onClick={copy}><Copy size={16} /></button>
          <button className="icon-btn bordered danger" title="Supprimer la note" aria-label="Supprimer la note" onClick={onDelete}><Trash2 size={16} /></button>
        </div>
      </div>

      <div className={`nt-paper ${toc ? 'with-toc' : ''}`}>
        <div className="nt-paper-main">
          <input
            className="nt-title" value={name} aria-label="Titre de la note" placeholder={UNTITLED}
            onChange={e => setName(e.target.value)} onBlur={saveName}
            onKeyDown={e => e.key === 'Enter' && (e.currentTarget.blur())}
          />
          <div className="nt-meta">
            {note.updated_at && <span>Modifiée {ago(note.updated_at)}</span>}
            <label className="nt-field">
              <Folder size={14} />
              <select value={note.parent_id ?? ''} onChange={e => saveNote({ ...note, parent_id: e.target.value || null })} aria-label="Dossier">
                <option value="">Racine</option>
                {folders.map(f => <option key={f.id} value={f.id}>{folderLabel(f)}</option>)}
              </select>
            </label>
            <label className={`nt-field ${task ? 'linked' : ''}`}>
              <Link2 size={14} />
              <select value={note.task_id ?? ''} onChange={e => saveNote({ ...note, task_id: e.target.value || null })} aria-label="Ticket lié">
                <option value="">Aucun ticket</option>
                {tasks.map(t => <option key={t.id} value={t.id}>{t.name}{isActive(t.status) ? '' : ` (${t.status.toLowerCase()})`}</option>)}
              </select>
            </label>
            {task && <button className="link" onClick={() => editTask(task)}>Ouvrir le ticket</button>}
          </div>

          {draft !== null ? (
            <AutoTextarea
              className="nt-editor" autoFocus value={draft} spellCheck
              placeholder={'# Titre\n\nÉcris ou colle du Markdown…'}
              onChange={e => change(e.target.value)} onPaste={pasteInEditor}
              onKeyDown={e => e.key === 'Escape' && finish()}
            />
          ) : empty ? (
            <PasteZone onPaste={replaceFromClipboard} onWrite={() => setDraft('')} />
          ) : (
            <article
              ref={articleRef} className="prose" title="Double-clic pour modifier"
              onDoubleClick={e => { if (!(e.target as HTMLElement).closest('a, pre, .md-copy')) setDraft(note.content); }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
        {toc && <Toc headings={headings} />}
      </div>
    </section>
  );
}

function PasteZone({ onPaste, onWrite }: { onPaste: () => void; onWrite: () => void }) {
  return (
    <div className="nt-pastezone">
      <ClipboardPaste size={28} />
      <p><b>Colle ici le texte généré par Claude</b><br />Appuie sur <kbd>Ctrl V</kbd> : la note s’affiche directement mise en forme.</p>
      <div className="row-gap">
        <button className="btn primary" onClick={onPaste}><ClipboardPaste size={15} /> Coller</button>
        <button className="btn" onClick={onWrite}><Pencil size={15} /> Écrire</button>
      </div>
    </div>
  );
}

function Toc({ headings }: { headings: { id: string; text: string; level: number }[] }): ReactNode {
  const min = Math.min(...headings.map(h => h.level));
  return (
    <nav className="nt-toc" aria-label="Sommaire">
      <div className="nt-toc-title">Sommaire</div>
      {headings.map(h => (
        <a key={h.id} href={'#'} style={{ ['--l' as string]: h.level - min }}
          onClick={e => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          {h.text}
        </a>
      ))}
    </nav>
  );
}
