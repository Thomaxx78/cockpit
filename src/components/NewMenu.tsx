import { useEffect, useRef, useState } from 'react';
import { CalendarPlus, ChevronDown, FolderPlus, ListPlus, Plus } from 'lucide-react';
import { todayIso } from '../lib/utils';
import { useEditors } from './editors';

/** Bouton « + Nouveau » : action, événement ou sujet. Le sujet ouvert est pré-rempli. */
export function useCreate(subjectId?: string) {
  const { editTask, editEvent, newSubject } = useEditors();
  const pre = subjectId ? { subject_id: subjectId } : {};
  return {
    task: () => editTask(null, pre),
    event: () => editEvent(null, { date: todayIso(), ...pre }),
    subject: newSubject,
  };
}

export function NewMenu({ subjectId }: { subjectId?: string }) {
  const create = useCreate(subjectId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('mousedown', close);
    addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', close); removeEventListener('keydown', esc); };
  }, [open]);

  const items = [
    { icon: ListPlus, label: 'Action', hint: 'Ticket à faire', key: 'N', run: create.task },
    { icon: CalendarPlus, label: 'Événement', hint: 'Date, réunion, échéance', key: 'E', run: create.event },
    { icon: FolderPlus, label: 'Sujet', hint: 'Nouveau dossier ou projet', key: 'S', run: create.subject },
  ];

  return (
    <div className="new-menu" ref={ref}>
      <button className="btn primary" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Plus size={16} /> <span className="hide-sm">Nouveau</span> <ChevronDown size={14} className={`chev ${open ? 'up' : ''}`} />
      </button>
      {open && (
        <div className="menu">
          {items.map(({ icon: Icon, label, hint, key, run }) => (
            <button key={label} onClick={() => { setOpen(false); run(); }}>
              <span className="menu-ico"><Icon size={17} /></span>
              <span className="menu-text"><b>{label}</b><small>{hint}</small></span>
              <kbd>{key}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
