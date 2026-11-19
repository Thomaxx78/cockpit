import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  ArrowLeft, CalendarDays, Check, ChevronRight, ClipboardPaste, Clock, Copy, Download, FileCode2, FilePlus2, FileText, Folder, FolderOpen,
  FolderPlus, Link2, ListPlus, NotebookPen, Pencil, Pin, PinOff, Trash2, Type,
} from 'lucide-react';
import { useEditors } from '../components/editors';
import { AutoTextarea } from '../components/ui';
import { features, noteDescendants } from '../lib/backend';
import { clipboardToMarkdown, firstHeading, readClipboard, renderMarkdown, withoutTitle } from '../lib/markdown';
import { checkboxes, linkTickets, newNote, openInEdit, plainText, UNTITLED, type Checkbox } from '../lib/notes';
import { newId, useStore } from '../lib/store';
import { isActive, type Note, type Task } from '../lib/types';
import { download, go, MOBILE, useMedia } from '../lib/utils';
import '../styles/notes.css';

// Éditeur visuel (Tiptap) chargé seulement quand on modifie une note.
const NoteEditor = lazy(() => import('./NoteEditor').then(m => ({ default: m.NoteEditor })));
const MODE_KEY = 'cockpit-notes-mode';
type Mode = 'rich' | 'md';
const readMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === 'md' ? 'md' : 'rich'; } catch { return 'rich'; } };

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
  useEffect(() => { import('./NoteEditor').catch(() => {}); }, []); // éditeur prêt avant le premier « Modifier »

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

  const create = (kind: Note['kind'], parent: string | null, content = '') => {
    const n = newNote(notes, { parent_id: parent, kind, content, name: kind === 'folder' ? 'Nouveau dossier' : firstHeading(content) ?? UNTITLED });
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

  const files = notes.filter(n => n.kind === 'file');
  const pinned = files.filter(n => n.pinned).sort(sortNotes);
  // Récentes : utile seulement quand il y a de quoi chercher.
  const recent = files.length > 4
    ? files.filter(n => !n.pinned && n.updated_at).sort((a, b) => b.updated_at!.localeCompare(a.updated_at!)).slice(0, 4)
    : [];

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
      <QuickList title="Épinglées" icon={<Pin size={12} />} items={pinned} current={current} />
      <QuickList title="Récentes" icon={<Clock size={12} />} items={recent} current={current} />
      <div className="nt-tree" role="tree">
        {(pinned.length > 0 || recent.length > 0) && <div className="nt-quick-title">Dossiers</div>}
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

function QuickList({ title, icon, items, current }: { title: string; icon: ReactNode; items: Note[]; current?: Note }) {
  if (!items.length) return null;
  return (
    <div className="nt-quick">
      <div className="nt-quick-title">{icon}{title}</div>
      {items.map(n => (
        <button key={n.id} className={`nt-quick-row ${current?.id === n.id ? 'active' : ''}`} onClick={() => go('notes/' + n.id)}>
          <FileText size={14} /><span>{n.name}</span>
        </button>
      ))}
    </div>
  );
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
              {n.pinned && <Pin size={12} className="nt-pinned" aria-label="Épinglée" />}
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
  const { db, saveNote, saveTasks, toast } = useStore();
  const { editTask, editEvent } = useEditors();
  // null : lecture ; texte : en cours de modification. Une note vide (ou un compte rendu tout juste créé) s'ouvre en écriture.
  const [draft, setDraft] = useState<string | null>(() => {
    if (openInEdit.delete(note.id) || !note.content.trim()) return note.content;
    return null;
  });
  const [mode, setModeState] = useState<Mode>(readMode);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const getRich = useRef<(() => string) | null>(null);
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
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** Markdown en cours : lu directement dans l'éditeur visuel (pas d'attente de sa temporisation). */
  const current = useCallback(() => {
    if (draftRef.current === null) return null;
    return modeRef.current === 'rich' && getRich.current ? getRich.current() : draftRef.current;
  }, []);
  // Enregistre ce qui reste à la fermeture de la note.
  useEffect(() => () => { const t = current(); if (t !== null) flush(t); }, [flush, current]);

  const change = (text: string) => {
    draftRef.current = text;
    setDraft(text);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(text), 700);
  };
  const startEdit = () => { draftRef.current = note.content; setDraft(note.content); };
  const finish = () => {
    const t = current();
    if (t !== null) flush(t);
    getRich.current = null;
    setDraft(null);
  };
  const switchMode = () => {
    const t = current() ?? note.content;
    const next: Mode = mode === 'rich' ? 'md' : 'rich';
    getRich.current = null;
    draftRef.current = t;
    setDraft(t);
    setModeState(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* stockage indisponible */ }
  };

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
      getRich.current = null;
      setDraft(null);
      toast('Note mise à jour');
    } catch { toast('Accès au presse-papier refusé : utilise Ctrl V', 'error'); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(current() ?? note.content); toast('Markdown copié'); }
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

  /* ----- Cases à cocher ⇄ tickets ----- */
  const boxes = useMemo(() => checkboxes(note.content), [note.content]);
  const pending = boxes.filter(b => !b.checked && !b.ticket && plainText(b.text));
  const event = note.event_id ? db.events.find(e => e.id === note.event_id) : undefined;
  const task = note.task_id ? db.tasks.find(t => t.id === note.task_id) : undefined;

  const makeTickets = (items: Checkbox[]) => {
    if (!items.length) return;
    const base = Math.max(0, ...db.tasks.map(t => t.position));
    const subject_id = event?.subject_id ?? task?.subject_id ?? null;
    const created: Task[] = items.map((b, i) => ({
      id: newId('t'), name: plainText(b.text).slice(0, 200), subject_id, status: 'À faire', priority: 'P2', owner: '', due_date: null, position: base + i + 1,
    }));
    saveTasks(created);
    saveNote({ ...latest.current, content: linkTickets(latest.current.content, items.map((b, i) => ({ line: b.line, ticket: created[i].id }))) });
    toast(created.length > 1 ? `${created.length} tickets créés dans le Kanban` : 'Ticket créé dans le Kanban');
  };
  const toggleBox = (b: Checkbox, checked: boolean) => {
    const lines = latest.current.content.split('\n');
    lines[b.line] = lines[b.line].replace(/\[( |x|X)\]/, checked ? '[x]' : '[ ]');
    saveNote({ ...latest.current, content: lines.join('\n') });
    const t = b.ticket ? db.tasks.find(x => x.id === b.ticket) : undefined;
    if (t && (t.status === 'Terminé') !== checked) saveTasks([{ ...t, status: checked ? 'Terminé' : 'À faire' }]);
  };
  const actions = useRef({ makeTickets, toggleBox });
  actions.current = { makeTickets, toggleBox };

  // Cases cliquables, pastilles de ticket (statut en direct) et bouton « → Ticket » sur chaque case libre.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const inputs = root.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"], li > p > input[type="checkbox"]');
    inputs.forEach((inp, i) => {
      const b = boxes[i];
      const li = inp.closest('li');
      if (!b || !li) return;
      const t = b.ticket ? db.tasks.find(x => x.id === b.ticket) : undefined;
      inp.disabled = false;
      inp.checked = b.checked || t?.status === 'Terminé';
      inp.onchange = () => actions.current.toggleBox(b, inp.checked);
      li.classList.toggle('md-done', inp.checked);
      const chip = li.querySelector<HTMLAnchorElement>(':scope > a.md-ticket, :scope > p > a.md-ticket');
      if (chip) {
        chip.textContent = t ? t.status : 'Ticket supprimé';
        chip.dataset.status = t ? t.status : 'gone';
        chip.title = t ? `Ouvrir le ticket « ${t.name} »` : 'Ce ticket n’existe plus';
      }
      let btn = li.querySelector<HTMLButtonElement>(':scope > .md-to-ticket, :scope > p > .md-to-ticket');
      if (b.ticket || b.checked || !plainText(b.text)) { btn?.remove(); return; }
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-to-ticket';
        btn.textContent = '→ Ticket';
        btn.title = 'Créer un ticket Kanban à partir de cette ligne';
        (inp.parentElement === li ? li : inp.parentElement!).appendChild(btn);
      }
      btn.onclick = () => actions.current.makeTickets([b]);
    });
  }, [html, draft, boxes, db.tasks]);

  const onArticleClick = (e: ReactMouseEvent) => {
    const chip = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.md-ticket');
    if (!chip) return;
    e.preventDefault();
    const t = db.tasks.find(x => x.id === chip.dataset.ticket);
    if (t) editTask(t); else toast('Ce ticket n’existe plus', 'error');
  };

  /* ----- Export ----- */
  const fileName = (note.name.trim() || 'note').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  const exportAs = (kind: 'pdf' | 'word' | 'md') => {
    const md = current() ?? note.content;
    if (kind === 'md') return download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), fileName + '.md');
    if (kind === 'word') {
      const body = renderMarkdown(withoutTitle(md, note.name)).html;
      const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escapeHtml(note.name)}</title><style>${WORD_CSS}</style></head><body><h1>${escapeHtml(note.name)}</h1>${body}</body></html>`;
      return download(new Blob(['\ufeff', doc], { type: 'application/msword' }), fileName + '.doc');
    }
    // PDF : impression de la note seule (choisir « Enregistrer au format PDF »).
    if (draft !== null) finish();
    setTimeout(() => {
      document.body.classList.add('print-note');
      const done = () => { document.body.classList.remove('print-note'); removeEventListener('afterprint', done); };
      addEventListener('afterprint', done);
      window.print();
    }, 80);
  };

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
  const tasks = [...db.tasks].sort((a, b) => Number(!isActive(a.status)) - Number(!isActive(b.status)) || collator.compare(a.name, b.name));
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
          {draft !== null && (
            <button className="btn ghost nt-mode" onClick={switchMode} title={mode === 'rich' ? 'Voir et modifier le Markdown brut' : 'Revenir à l’éditeur visuel'}>
              {mode === 'rich' ? <><FileCode2 size={15} /> <span className="hide-sm">Markdown</span></> : <><Type size={15} /> <span className="hide-sm">Visuel</span></>}
            </button>
          )}
          {draft === null
            ? <button className="btn" onClick={startEdit}><Pencil size={15} /> <span className="hide-sm">Modifier</span></button>
            : <button className="btn primary" onClick={finish}><Check size={15} /> Terminé</button>}
          {draft === null && pending.length > 0 && (
            <button className="btn nt-make-tickets" title="Créer un ticket Kanban pour chaque case non cochée" onClick={() => {
              if (confirm(`Créer ${pending.length} ticket${pending.length > 1 ? 's' : ''} dans le Kanban ?\n\n${pending.map(b => '• ' + plainText(b.text)).join('\n')}`)) makeTickets(pending);
            }}>
              <ListPlus size={15} /> <span className="hide-sm">{pending.length} ticket{pending.length > 1 ? 's' : ''}</span>
            </button>
          )}
          <button className={`icon-btn bordered ${note.pinned ? 'on' : ''}`} title={note.pinned ? 'Désépingler' : 'Épingler en haut de la liste'} aria-label={note.pinned ? 'Désépingler' : 'Épingler'} aria-pressed={note.pinned} onClick={() => saveNote({ ...note, pinned: !note.pinned })}>
            {note.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          <ExportMenu onPick={exportAs} />
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
            {event && (
              <button type="button" className="nt-field linked nt-event" onClick={() => editEvent(event)} title="Ouvrir la réunion">
                <CalendarDays size={14} />
                <b>Réunion du {new Date(event.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}{event.start_time ? ' · ' + event.start_time.slice(0, 5) : ''}</b>
              </button>
            )}
          </div>

          {draft !== null && mode === 'rich' ? (
            <div onKeyDown={e => e.key === 'Escape' && finish()}>
              <Suspense fallback={<div className="nt-rich-loading">Chargement de l’éditeur…</div>}>
                <NoteEditor
                  initial={draft} onChange={change} getRef={getRich}
                  placeholder="Écris ici, ou colle une réponse de Claude (Ctrl V). Les boutons ci-dessus mettent en forme : titres, gras, listes, tableaux…"
                />
              </Suspense>
            </div>
          ) : draft !== null ? (
            <AutoTextarea
              className="nt-editor" autoFocus value={draft} spellCheck
              placeholder={'# Titre\n\nÉcris ou colle du Markdown…'}
              onChange={e => change(e.target.value)} onPaste={pasteInEditor}
              onKeyDown={e => e.key === 'Escape' && finish()}
            />
          ) : (
            <article
              ref={articleRef} className="prose" title="Double-clic pour modifier" onClick={onArticleClick}
              onDoubleClick={e => { if (!(e.target as HTMLElement).closest('a, pre, button, input')) startEdit(); }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
        {toc && <Toc headings={headings} />}
      </div>
    </section>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** Mise en page du fichier Word : simple et lisible, indépendante du thème. */
const WORD_CSS = `body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1f2433}
h1{font-size:22pt;color:#141a29;margin:0 0 12pt}h2{font-size:15pt;color:#141a29;border-bottom:1px solid #dde1e7;padding-bottom:3pt;margin:18pt 0 6pt}
h3{font-size:12.5pt;color:#141a29;margin:14pt 0 4pt}a{color:#5048e5}code{font-family:Consolas,monospace;background:#f1f3f6;font-size:10pt}
pre{font-family:Consolas,monospace;background:#f6f7f9;border:1px solid #e3e6eb;padding:8pt;font-size:9.5pt}
blockquote{border-left:3px solid #5048e5;margin:8pt 0;padding-left:10pt;color:#5c6474}
table{border-collapse:collapse;margin:8pt 0}th,td{border:1px solid #d5d9e0;padding:4pt 8pt;vertical-align:top}th{background:#f1f3f6}
.md-alert{border:1px solid #c9c6f7;background:#f0f0fe;padding:6pt 10pt;margin:8pt 0}.md-alert-title{font-weight:bold;color:#5048e5;margin:0}
.md-ticket{display:none}`;

function ExportMenu({ onPick }: { onPick: (k: 'pdf' | 'word' | 'md') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', close);
    addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', esc); };
  }, [open]);
  const items: { k: 'pdf' | 'word' | 'md'; label: string; hint: string }[] = [
    { k: 'pdf', label: 'PDF', hint: 'Imprimer → Enregistrer au format PDF' },
    { k: 'word', label: 'Word', hint: 'Fichier .doc mis en forme' },
    { k: 'md', label: 'Markdown', hint: 'Fichier .md brut' },
  ];
  return (
    <div className="new-menu nt-export" ref={ref}>
      <button className="icon-btn bordered" title="Exporter" aria-label="Exporter" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(o => !o)}><Download size={16} /></button>
      {open && (
        <div className="menu" role="menu">
          {items.map(it => (
            <button key={it.k} role="menuitem" onClick={() => { setOpen(false); onPick(it.k); }}>
              <span className="menu-ico"><Download size={16} /></span>
              <span className="menu-text"><b>{it.label}</b><small>{it.hint}</small></span>
            </button>
          ))}
        </div>
      )}
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
