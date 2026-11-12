import { AlertCircle, ArrowRight, CalendarClock, Compass, GraduationCap, ListChecks, TriangleAlert } from 'lucide-react';
import { TaskRow } from '../components/TaskRow';
import { Dot, Empty, Pill } from '../components/ui';
import { useStore } from '../lib/store';
import { isActive } from '../lib/types';
import { dayMonth, daysFrom, fmtShort, go, relative, timeRange, todayIso } from '../lib/utils';

const prioRank = (p: string) => ({ P1: 0, P2: 1, P3: 2 } as Record<string, number>)[p] ?? 3;
const FOLLOWED = ['En cours', 'En attente', 'À cadrer'];

export function Dashboard() {
  const { db, subject } = useStore();
  const today = todayIso();
  const open = db.tasks.filter(t => isActive(t.status));
  const backlog = db.tasks.filter(t => t.status === 'Backlog').length;
  const isLate = (d: string | null) => !!d && d < today;
  const late = open.filter(t => isLate(t.due_date));
  const thisWeek = open.filter(t => t.due_date && !isLate(t.due_date) && daysFrom(t.due_date) <= 7);
  const p1 = open.filter(t => t.priority === 'P1').length;
  const toScope = db.subjects.filter(s => s.status === 'À cadrer').length;
  // Retards d'abord, puis priorité, puis échéance.
  const next = [...open].sort((a, b) =>
    Number(isLate(b.due_date)) - Number(isLate(a.due_date)) ||
    prioRank(a.priority) - prioRank(b.priority) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.position - b.position,
  ).slice(0, 5);

  const future = db.events.filter(e => e.date >= today).sort((a, b) => (a.date + (a.start_time ?? '')).localeCompare(b.date + (b.start_time ?? '')));
  // Les jours de cours sont résumés à part pour ne pas noyer les échéances.
  const upcoming = future.filter(e => e.kind !== 'Cours').slice(0, 6);
  const nextCourses = (() => {
    const first = future.find(e => e.kind === 'Cours');
    if (!first) return null;
    const block = [first];
    for (const e of future.filter(x => x.kind === 'Cours' && x.date > first.date)) {
      if (daysFrom(e.date) - daysFrom(block.at(-1)!.date) > 3) break;
      block.push(e);
    }
    return { from: block[0].date, to: block.at(-1)!.date, count: block.length };
  })();

  const followed = db.subjects.filter(s => FOLLOWED.includes(s.status)).slice(0, 5);
  const progress = (id: string) => {
    const ts = db.tasks.filter(t => t.subject_id === id);
    return { done: ts.filter(t => t.status === 'Terminé').length, total: ts.length };
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Vue d’ensemble</h2>
          <p className="hint cap">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>

      <div className="stats">
        <button className={`stat ${late.length ? 'alert' : ''}`} onClick={() => go('actions')}>
          <span className="stat-ico"><AlertCircle size={18} /></span>
          <span className="stat-label">En retard</span>
          <span className="stat-num">{late.length}</span>
        </button>
        <button className="stat" onClick={() => go('actions')}>
          <span className="stat-ico"><ListChecks size={18} /></span>
          <span className="stat-label">Actions ouvertes</span>
          <span className="stat-num">{open.length}</span>
          {(p1 > 0 || backlog > 0) && <span className="stat-sub">{[p1 && `${p1} P1`, backlog && `${backlog} en backlog`].filter(Boolean).join(' · ')}</span>}
        </button>
        <button className="stat" onClick={() => go('kanban')}>
          <span className="stat-ico"><CalendarClock size={18} /></span>
          <span className="stat-label">Cette semaine</span>
          <span className="stat-num">{thisWeek.length}</span>
        </button>
        <button className="stat" onClick={() => go('sujets?statut=À cadrer')}>
          <span className="stat-ico"><TriangleAlert size={18} /></span>
          <span className="stat-label">Sujets à cadrer</span>
          <span className="stat-num">{toScope}</span>
        </button>
      </div>

      <div className="grid-2">
        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h3>Prochaines actions</h3>
              <button className="link" onClick={() => go('actions')}>Toutes <ArrowRight size={14} /></button>
            </div>
            {next.length ? next.map(t => <TaskRow key={t.id} t={t} />) : <Empty>Tout est fait 🎉</Empty>}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Dossiers actifs</h3>
              <button className="link" onClick={() => go('sujets')}>Tous les sujets <ArrowRight size={14} /></button>
            </div>
            {followed.length ? followed.map(s => {
              const p = progress(s.id);
              return (
                <button key={s.id} className="subject-row" style={{ ['--c' as string]: s.color }} onClick={() => go('sujets/' + s.id)}>
                  <Dot color={s.color} size={8} />
                  <span className="subject-row-main">
                    <span className="row-title">{s.name}</span>
                    {s.next_step && <span className="meta">{s.next_step}</span>}
                  </span>
                  {p.total > 0 && (
                    <span className="mini-progress" title={`${p.done}/${p.total} actions terminées`}>
                      <span style={{ width: `${(p.done / p.total) * 100}%` }} />
                    </span>
                  )}
                  <Pill status={s.status} />
                </button>
              );
            }) : <Empty>Aucun dossier actif.</Empty>}
          </section>
        </div>

        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h3>À venir</h3>
              <button className="link" onClick={() => go('calendrier')}>Calendrier <ArrowRight size={14} /></button>
            </div>
            {upcoming.length ? upcoming.map(e => {
              const d = dayMonth(e.date);
              const s = subject(e.subject_id);
              return (
                <button key={e.id} className="date-row" onClick={() => go(s ? 'sujets/' + s.id : 'calendrier')}>
                  <span className="datebox"><b>{d.day}</b><small>{d.month}</small></span>
                  <span className="subject-row-main">
                    <span className="row-title">{e.name}</span>
                    <span className="meta">
                      {s && <Dot color={s.color} size={7} />}
                      {[e.start_time && timeRange(e.start_time, e.end_time), relative(e.date), /Échéance|Hypothèse/.test(e.kind) && e.kind].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              );
            }) : <Empty>Aucune date à venir.</Empty>}
            {nextCourses && (
              <button className="courses-next" onClick={() => go('calendrier')}>
                <GraduationCap size={16} />
                <span>Prochains cours : <b>{fmtShort(nextCourses.from)}{nextCourses.count > 1 && ` → ${fmtShort(nextCourses.to)}`}</b> · {relative(nextCourses.from)}</span>
              </button>
            )}
          </section>

          {subject('strategy') && (
            <button className="vision-link" onClick={() => go('sujets/strategy')}>
              <Compass size={16} /> <span>Vision stratégique</span> <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
