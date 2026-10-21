import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, FileText, ListChecks, Search } from 'lucide-react';
import { useStore } from '../lib/store';
import { go } from '../lib/utils';
import { useEditors } from './editors';
import { Dot } from './ui';

type Result = { key: string; label: string; hint: string; color?: string; icon: 'page' | 'subject' | 'task'; run: () => void };

export function Palette({ onClose, pages }: { onClose: () => void; pages: [string, string][] }) {
  const { db, subject } = useStore();
  const { editTask } = useEditors();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<Result[]>(() => {
    const n = q.trim().toLowerCase();
    const match = (s: string) => s.toLowerCase().includes(n);
    return [
      ...pages.filter(([, l]) => match(l)).map(([p, l]) => ({ key: 'p' + p, label: l, hint: 'Page', icon: 'page' as const, run: () => go(p) })),
      ...db.subjects.filter(s => match(`${s.name} ${s.category} ${s.people}`)).map(s => ({
        key: s.id, label: s.name, hint: s.category, color: s.color, icon: 'subject' as const, run: () => go('sujets/' + s.id),
      })),
      ...(n ? db.tasks.filter(t => match(`${t.name} ${t.owner}`)).map(t => ({
        key: t.id, label: t.name, hint: subject(t.subject_id)?.name ?? 'Action', color: subject(t.subject_id)?.color, icon: 'task' as const, run: () => editTask(t),
      })) : []),
    ].slice(0, 30);
  }, [q, db, pages, subject, editTask]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const pick = (r?: Result) => { if (!r) return; onClose(); r.run(); };

  return (
    <div className="backdrop palette-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <label className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Aller à un sujet, une action, une page…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
              if (e.key === 'Enter') pick(results[sel]);
              if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" ref={listRef}>
          {results.map((r, i) => (
            <button key={r.key} className={i === sel ? 'on' : ''} onMouseMove={() => setSel(i)} onClick={() => pick(r)}>
              {r.icon === 'page' ? <FileText size={15} /> : r.icon === 'task' ? <ListChecks size={15} /> : <Dot color={r.color} size={10} />}
              <span className="palette-label">{r.label}</span>
              <span className="palette-hint">{r.hint}</span>
              {i === sel && <CornerDownLeft size={14} />}
            </button>
          ))}
          {!results.length && <div className="empty">Aucun résultat</div>}
        </div>
      </div>
    </div>
  );
}
