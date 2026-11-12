import { Check, CalendarDays } from 'lucide-react';
import { useStore } from '../lib/store';
import { isActive, type Task } from '../lib/types';
import { cleanOwner, daysFrom, fmtDate, fmtShort, relative } from '../lib/utils';
import { useEditors } from './editors';
import { Pill, Prio, SubjectTag } from './ui';

/** Échéance : relative quand elle est proche ou passée, sinon la date courte. */
export function DueBadge({ date, done }: { date: string | null; done?: boolean }) {
  if (!date) return null;
  const n = daysFrom(date);
  const tone = done ? '' : n < 0 ? 'late' : n <= 3 ? 'soon' : '';
  return (
    <span className={`due ${tone}`} title={fmtDate(date)}>
      <CalendarDays size={12} /> {!done && n < 7 ? relative(date) : fmtShort(date)}
    </span>
  );
}

export function TaskRow({ t, showSubject = true, showStatus = false }: { t: Task; showSubject?: boolean; showStatus?: boolean }) {
  const { saveTask, toast } = useStore();
  const { editTask } = useEditors();
  const done = t.status === 'Terminé';
  const owner = cleanOwner(t.owner);
  return (
    <div
      className={`task-row ${done ? 'is-done' : ''}`}
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
          <DueBadge date={t.due_date} done={!isActive(t.status)} />
          {owner && <span className="meta-item meta-owner">{owner}</span>}
        </div>
      </div>
      {showStatus && <Pill status={t.status} />}
      <Prio p={t.priority} />
    </div>
  );
}
