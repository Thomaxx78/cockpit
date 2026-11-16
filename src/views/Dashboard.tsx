import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CalendarClock, Compass, GraduationCap, ListChecks, TriangleAlert, Video } from 'lucide-react';
import { useEditors } from '../components/editors';
import { TaskRow } from '../components/TaskRow';
import { Dot, Empty, Pill } from '../components/ui';
import { useStore } from '../lib/store';
import { type CalEvent, isActive } from '../lib/types';
import { dayMonth, daysFrom, fmtShort, fmtTime, go, meetingLink, relative, timeRange, todayIso, toMinutes, useMedia } from '../lib/utils';
import '../styles/join.css';

const prioRank = (p: string) => ({ P1: 0, P2: 1, P3: 2 } as Record<string, number>)[p] ?? 3;
const FOLLOWED = ['En cours', 'En attente', 'À cadrer'];

/** Minutes écoulées depuis minuit, rafraîchies chaque minute. */
function useNowMinutes() {
  const read = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setNow(read()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Carte « Prochaine réunion » : réunion du jour en cours ou à venir, avec bouton « Rejoindre » si un lien de visio existe. */
function NextMeeting({ events }: { events: CalEvent[] }) {
  const { subject } = useStore();
  const { editEvent } = useEditors();
  const now = useNowMinutes();
  const today = todayIso();
  // Sans heure de fin, on compte une heure.
  const end = (e: CalEvent) => (e.end_time ? toMinutes(e.end_time) : toMinutes(e.start_time!) + 60);
  const e = events
    .filter(x => x.date === today && x.start_time && x.kind !== 'Cours' && end(x) > now)
    .sort((a, b) => a.start_time!.localeCompare(b.start_time!))[0];
  if (!e) return null;

  const start = toMinutes(e.start_time!);
  const live = start <= now;
  const wait = start - now;
  const state = live ? 'En cours' : wait <= 60 ? `Dans ${wait} min` : `À ${fmtTime(e.start_time!.slice(0, 5))}`;
  const s = subject(e.subject_id);
  const link = meetingLink(e.description);

  return (
    <section className={`panel join-card${live ? ' live' : ''}`} aria-label="Prochaine réunion">
      <button className="join-main" onClick={() => editEvent(e)} title="Ouvrir la réunion">
        <span className="join-head">
          <span className="join-label">Prochaine réunion</span>
          <span className="join-state">{live && <span className="join-pulse" aria-hidden />}{state}</span>
        </span>
        <span className="join-title">
          {s && <Dot color={s.color} size={8} />}
          <span>{e.name}</span>
        </span>
        <span className="meta">{[timeRange(e.start_time!.slice(0, 5), e.end_time?.slice(0, 5)), s?.name].filter(Boolean).join(' · ')}</span>
      </button>
      {link && (
        <a className="btn primary join-btn" href={link.url} target="_blank" rel="noopener noreferrer" title={`Rejoindre sur ${link.provider === 'Meet' ? 'Google Meet' : link.provider}`}>
          <Video size={16} /> Rejoindre
        </a>
      )}
    </section>
  );
}

export function Dashboard() {
  const { db, subject } = useStore();
  const narrow = useMedia('(max-width: 1100px)'); // même seuil que le passage à une colonne (.grid-2)
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

      {/* Écran étroit (téléphone, tablette) : la prochaine réunion passe en tête, c'est l'info la plus urgente. */}
      {narrow && <NextMeeting events={db.events} />}

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
          {!narrow && <NextMeeting events={db.events} />}

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
