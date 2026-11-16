import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRightLeft, CalendarCheck2, CheckCircle2, ChevronLeft, ChevronRight, ListPlus } from 'lucide-react';
import { useEditors } from '../components/editors';
import { Dot, Empty, Pill } from '../components/ui';
import { useStore } from '../lib/store';
import { isPastMeeting, type Activity } from '../lib/types';
import { iso, timeRange, todayIso } from '../lib/utils';
import '../styles/history.css';

/** Jour local (AAAA-MM-JJ) d'un horodatage. */
const dayOf = (at: string) => iso(new Date(at));

const parse = (d: string) => new Date(d + 'T12:00:00');
const addDays = (d: string, n: number) => { const x = parse(d); x.setDate(x.getDate() + n); return iso(x); };
const mondayOf = (d: string) => addDays(d, -((parse(d).getDay() + 6) % 7));
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => parse(d).toLocaleDateString('fr-FR', o);

/** « Semaine du 9 au 15 nov. », « Semaine du 27 oct. au 2 nov. » (+ année si ce n'est pas l'année en cours). */
function weekLabel(mon: string, sun: string) {
  const sameMonth = mon.slice(0, 7) === sun.slice(0, 7);
  const year = sun.slice(0, 4) !== todayIso().slice(0, 4) ? ' ' + sun.slice(0, 4) : '';
  const from = sameMonth ? fmt(mon, { day: 'numeric' }) : fmt(mon, { day: 'numeric', month: 'short' });
  return `Semaine du ${from} au ${fmt(sun, { day: 'numeric', month: 'short' })}${year}`;
}
/** « lun. 10 » */
const dayLabel = (d: string) => fmt(d, { weekday: 'short', day: 'numeric' });

type Item = { key: string; day: string; title: string; subjectId: string | null; extra?: ReactNode; onClick?: () => void };

export function History() {
  const { db, activity, subject } = useStore();
  const { editEvent, editTask } = useEditors();
  const [offset, setOffset] = useState(0);
  const today = todayIso();
  const mon = addDays(mondayOf(today), offset * 7);
  const sun = addDays(mon, 6);

  const data = useMemo(() => {
    const inWeek = (d: string) => d >= mon && d <= sun;
    const week = activity.filter(a => inWeek(dayOf(a.at))).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
    const taskName = (a: Activity) => db.tasks.find(t => t.id === a.entity_id)?.name || a.label;
    const openTask = (id: string) => { const t = db.tasks.find(x => x.id === id); return t ? () => editTask(t) : undefined; };

    // Dernier changement de statut de chaque action dans la semaine : terminée si elle a fini « Terminé ».
    const lastStatus = new Map<string, Activity>();
    for (const a of week) if (a.entity === 'task' && (a.kind === 'status' || (a.kind === 'created' && a.to_status === 'Terminé'))) lastStatus.set(a.entity_id, a);
    const done: Item[] = [...lastStatus.values()].filter(a => a.to_status === 'Terminé').map(a => ({
      key: 'd' + a.id, day: dayOf(a.at), title: taskName(a), subjectId: a.subject_id, onClick: openTask(a.entity_id),
    }));
    const created: Item[] = week.filter(a => a.entity === 'task' && a.kind === 'created').map(a => ({
      key: 'c' + a.id, day: dayOf(a.at), title: taskName(a), subjectId: a.subject_id, onClick: openTask(a.entity_id),
      extra: a.to_status && a.to_status !== 'À faire' ? <Pill status={a.to_status} /> : undefined,
    }));
    const subjects: Item[] = week.filter(a => a.entity === 'subject' && a.kind === 'status').map(a => ({
      key: 's' + a.id, day: dayOf(a.at), title: subject(a.entity_id)?.name || a.label, subjectId: a.entity_id,
      extra: <span className="hist-change">{a.from_status && <Pill status={a.from_status} />}<span aria-hidden="true">→</span>{a.to_status && <Pill status={a.to_status} />}</span>,
    }));
    const meetings: Item[] = db.events.filter(e => inWeek(e.date) && isPastMeeting(e, today))
      .sort((a, b) => (a.date + (a.start_time ?? '')).localeCompare(b.date + (b.start_time ?? '')))
      .map(e => ({
        key: 'e' + e.id, day: e.date, title: e.name, subjectId: e.subject_id, onClick: () => editEvent(e),
        extra: e.start_time ? <span className="hist-time">{timeRange(e.start_time, e.end_time)}</span> : undefined,
      }));
    return { done, created, subjects, meetings };
  }, [activity, db, mon, sun, today, subject, editTask, editEvent]);

  const stats = [
    { label: 'Actions terminées', n: data.done.length, icon: <CheckCircle2 size={18} /> },
    { label: 'Actions créées', n: data.created.length, icon: <ListPlus size={18} /> },
    { label: 'Réunions tenues', n: data.meetings.length, icon: <CalendarCheck2 size={18} /> },
    { label: 'Sujets ayant changé de statut', n: new Set(data.subjects.map(i => i.subjectId)).size, icon: <ArrowRightLeft size={18} /> },
  ];
  const sections: { title: string; items: Item[] }[] = [
    { title: 'Actions terminées', items: data.done },
    { title: 'Réunions', items: data.meetings },
    { title: 'Sujets', items: data.subjects },
    { title: 'Nouvelles actions', items: data.created },
  ].filter(s => s.items.length);

  return (
    <div className="page history">
      <div className="page-head">
        <div>
          <h2>Historique</h2>
          <p className="hint">{weekLabel(mon, sun)}</p>
        </div>
        <div className="hist-nav" role="group" aria-label="Choix de la semaine">
          <button className="icon-btn bordered" onClick={() => setOffset(o => o - 1)} aria-label="Semaine précédente" title="Semaine précédente"><ChevronLeft size={18} /></button>
          <button className="btn" onClick={() => setOffset(0)} disabled={offset === 0}>Cette semaine</button>
          <button className="icon-btn bordered" onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} aria-label="Semaine suivante" title="Semaine suivante"><ChevronRight size={18} /></button>
        </div>
      </div>

      {sections.length > 0 && (
        <div className="stats hist-stats">
          {stats.map(s => (
            <div key={s.label} className="stat">
              <span className="stat-ico">{s.icon}</span>
              <span className="stat-label">{s.label}</span>
              <span className="stat-num">{s.n}</span>
            </div>
          ))}
        </div>
      )}

      {sections.length ? (
        <div className="hist-grid">
          {sections.map(sec => (
            <section key={sec.title} className="panel">
              <div className="panel-head"><h3>{sec.title}</h3><span className="count">{sec.items.length}</span></div>
              <ul className="hist-list">
                {sec.items.map(it => {
                  const s = subject(it.subjectId);
                  const body = (
                    <>
                      <span className="hist-day">{dayLabel(it.day)}</span>
                      <span className="hist-main">
                        <span className="row-title">{it.title}</span>
                        <span className="meta">
                          <Dot color={s?.color} size={7} />
                          <span>{s?.name ?? 'Sans sujet'}</span>
                          {it.extra}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={it.key}>
                      {it.onClick ? <button className="hist-row" onClick={it.onClick}>{body}</button> : <div className="hist-row">{body}</div>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <section className="panel"><Empty>Rien d'enregistré cette semaine.</Empty></section>
      )}

      {activity.length === 0 && (
        <p className="hint hist-note">L'historique démarre à partir de maintenant : les changements sont enregistrés au fil de l'eau.</p>
      )}
    </div>
  );
}
