import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, FileText, ListChecks, NotebookPen, Plus, Search } from 'lucide-react';
import { newId, useStore } from '../lib/store';
import { fmtShort, go, relative } from '../lib/utils';
import { parseQuickTask } from '../lib/quickAdd';
import { useEditors } from './editors';
import { Dot } from './ui';
import { useInert } from '../lib/presence';

type Result = {
  key: string; label: string; hint: string; color?: string; icon: 'page' | 'subject' | 'task' | 'note' | 'add'; run: () => void;
  /** Maj+Entrée : ouvrir la fiche au lieu de créer directement (saisie rapide). */
  detail?: () => void;
};

export function Palette({ onClose, pages, closing = false }: { onClose: () => void; pages: [string, string][]; closing?: boolean }) {
  const { db, subject, saveTask, toast } = useStore();
  const { editTask } = useEditors();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Sortie animée : App la garde affichée (usePresence) le temps de la classe .leaving.
  const rootRef = useRef<HTMLDivElement>(null);
  useInert(rootRef, closing);

  const results = useMemo<Result[]>(() => {
    const n = q.trim().toLowerCase();
    const match = (s: string) => s.toLowerCase().includes(n);
    // Saisie rapide : la phrase tapée devient une action (date, priorité, #sujet, @responsable).
    const quick = n ? parseQuickTask(q, db.subjects) : null;
    const add: Result | null = quick && quick.name ? (() => {
      const fields = {
        name: quick.name, due_date: quick.due_date, subject_id: quick.subject_id,
        ...(quick.priority ? { priority: quick.priority } : {}), ...(quick.owner ? { owner: quick.owner } : {}),
      };
      const parts = [
        quick.due_date && `${relative(quick.due_date)} (${fmtShort(quick.due_date)})`,
        quick.priority, subject(quick.subject_id)?.name, quick.owner && '@' + quick.owner,
      ].filter(Boolean);
      return {
        key: 'add', label: `Créer « ${quick.name} »`, hint: parts.join(' · ') || 'Nouvelle action',
        color: subject(quick.subject_id)?.color, icon: 'add',
        run: () => {
          saveTask({
            id: newId('t'), status: 'À faire', priority: 'P2', owner: '',
            position: Math.max(0, ...db.tasks.map(x => x.position)) + 1, ...fields,
          });
          toast(`Action créée : ${quick.name}`);
        },
        detail: () => editTask(null, fields),
      };
    })() : null;
    const found: Result[] = [
      ...pages.filter(([, l]) => match(l)).map(([p, l]) => ({ key: 'p' + p, label: l, hint: 'Page', icon: 'page' as const, run: () => go(p) })),
      ...db.subjects.filter(s => match(`${s.name} ${s.category} ${s.people}`)).map(s => ({
        key: s.id, label: s.name, hint: s.category, color: s.color, icon: 'subject' as const, run: () => go('sujets/' + s.id),
      })),
      ...(n ? db.notes.filter(x => x.kind === 'file' && match(`${x.name} ${x.content}`)).map(x => ({
        key: x.id, label: x.name, hint: 'Note', icon: 'note' as const, run: () => go('notes/' + x.id),
      })) : []),
      ...(n ? db.tasks.filter(t => match(`${t.name} ${t.owner}`)).map(t => ({
        key: t.id, label: t.name, hint: subject(t.subject_id)?.name ?? 'Action', color: subject(t.subject_id)?.color, icon: 'task' as const, run: () => editTask(t),
      })) : []),
    ].slice(0, 30);
    if (!add) return found;
    // En tête si on l'a clairement demandé (« + », date, #sujet…) ou si rien d'autre ne correspond.
    return /^\s*\+/.test(q) || quick!.smart || !found.length ? [add, ...found] : [...found, add];
  }, [q, db, pages, subject, editTask, saveTask, toast]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const pick = (r?: Result, detail = false) => { if (!r) return; onClose(); (detail && r.detail ? r.detail : r.run)(); };

  return (
    <div ref={rootRef} className={`backdrop palette-back${closing ? ' leaving' : ''}`} onMouseDown={e => !closing && e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <label className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Chercher… ou « Relancer Paul vendredi P1 #sujet »"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); pick(results[sel], e.shiftKey); }
              if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" ref={listRef}>
          {results.map((r, i) => (
            <button key={r.key} className={i === sel ? 'on' : ''} onMouseMove={() => setSel(i)} onClick={() => pick(r)}>
              {r.icon === 'add' ? <Plus size={15} /> : r.icon === 'page' ? <FileText size={15} /> : r.icon === 'note' ? <NotebookPen size={15} /> : r.icon === 'task' ? <ListChecks size={15} /> : <Dot color={r.color} size={10} />}
              <span className="palette-label">{r.label}</span>
              <span className="palette-hint">{r.hint}</span>
              {i === sel && (r.detail ? <kbd className="palette-keys" title="Entrée : créer · Maj+Entrée : compléter la fiche">↵ · ⇧↵</kbd> : <CornerDownLeft size={14} />)}
            </button>
          ))}
          {!results.length && <div className="empty">Aucun résultat</div>}
        </div>
      </div>
    </div>
  );
}
