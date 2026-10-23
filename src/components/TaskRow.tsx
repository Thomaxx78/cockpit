import { Check, CalendarDays, User } from 'lucide-react';
import { useStore } from '../lib/store';
import type { Task } from '../lib/types';
import { daysFrom, fmtShort, relative } from '../lib/utils';
import { useEditors } from './editors';
import { Pill, Prio, SubjectTag } from './ui';

export function DueBadge({ date, done }: { date: string | null; done?: boolean }) {
  if (!date) return null;
  const n = daysFrom(date);
  const tone = done ? '' : n < 0 ? 'late' : n <= 3 ? 'soon' : '';
  return (
    <span className={`due ${tone}`} title={fmtShort(date)}>
      <CalendarDays size={12} /> {fmtShort(date)} · {relative(date)}
    </span>
  );
}

export function TaskRow({ t, showSubject = true, showStatus = false }: { t: Task; showSubject?: boolean; showStatus?: boolean }) {
  const { saveTask, subject, toast } = useStore();
  const { editTask } = useEditors();
  const done = t.status === 'Terminé';
  return (
    <div
      className={`task-row ${done ? 'is-done' : ''}`}
      style={{ ['--c' as string]: subject(t.subject_id)?.color }}
      role="button"
      tabIndex={0}
      aria-label={`${t.name}, ${t.priority}, ${t.status}. Modifier`}
      onClick={() => editTask(t)}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editTask(t); } }}
    >
      <button
        className={`check ${done ? 'on' : ''}`}
        aria-label={done ? 'Rouvrir' : 'Terminer'}
        onClick={e => {
          e.stopPropagation();
          saveTask({ ...t, status: done ? 'À faire' : 'Terminé' });
          toast(done ? 'Action rouverte' : 'Action terminée ✓');
        }}
      >
        <Check size={13} strokeWidth={3} />
      </button>
      <div className="task-main">
        <div className="task-name">{t.name}</div>
        <div className="meta">
          {showSubject && <SubjectTag id={t.subject_id} />}
          {t.owner && <span className="meta-item"><User size={12} /> {t.owner}</span>}
          <DueBadge date={t.due_date} done={done} />
        </div>
      </div>
      {showStatus && <Pill status={t.status} />}
      <Prio p={t.priority} />
    </div>
  );
}
