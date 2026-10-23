import { useState } from 'react';
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEditors } from '../components/editors';
import { Empty } from '../components/ui';
import { useStore } from '../lib/store';
import { dayMonth, iso, MOBILE, timeRange, todayIso, useMedia } from '../lib/utils';

type Item = { key: string; date: string; time: string; sort: string; name: string; color?: string; kind: 'event' | 'task'; label: string; done?: boolean; open: () => void };

const longDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export function Calendar() {
  const { db, subject } = useStore();
  const { editEvent, editTask } = useEditors();
  const mobile = useMedia(MOBILE);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [showTasks, setShowTasks] = useState(true);
  const today = todayIso();
  // Sur téléphone, toucher un jour le sélectionne (agenda du jour) au lieu d'ouvrir un formulaire.
  const [selected, setSelected] = useState<string | null>(today);
  const y = month.getFullYear();
  const m = month.getMonth();
  const start = (new Date(y, m, 1).getDay() + 6) % 7;
  const weeks = Math.ceil((start + new Date(y, m + 1, 0).getDate()) / 7);

  const items: Item[] = [
    ...db.events.map(e => ({ key: e.id, date: e.date, time: timeRange(e.start_time, e.end_time), sort: e.start_time ?? '', name: e.name, color: subject(e.subject_id)?.color, kind: 'event' as const, label: e.kind, open: () => editEvent(e) })),
    ...(showTasks ? db.tasks.filter(t => t.due_date).map(t => ({
      key: t.id, date: t.due_date!, time: '', sort: '99', name: t.name, color: subject(t.subject_id)?.color, kind: 'task' as const, label: 'Échéance d’action', done: t.status === 'Terminé', open: () => editTask(t),
    })) : []),
  ];
  const byDay = new Map<string, Item[]>();
  for (const it of [...items].sort((a, b) => a.sort.localeCompare(b.sort))) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);

  const cells = Array.from({ length: weeks * 7 }, (_, i) => new Date(y, m, i - start + 1));
  const monthPrefix = iso(month).slice(0, 7);
  const sel = selected && selected.startsWith(monthPrefix) ? selected : null;
  const agenda = (sel ? byDay.get(sel) ?? [] : items.filter(it => it.date.startsWith(monthPrefix)))
    .sort((a, b) => (a.date + a.sort).localeCompare(b.date + b.sort));
  const shift = (n: number) => { setMonth(new Date(y, m + n, 1)); setSelected(null); };
  const goToday = () => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(today); };
  const pickDay = (key: string) => (mobile ? setSelected(key) : editEvent(null, { date: key }));

  return (
    <div className="page">
      <div className="page-head cal-head">
        <div>
          <h2 className="month-title">{month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</h2>
          <p className="hint desktop-only">Clique un jour pour ajouter un événement · dates théoriques signalées dans leur intitulé</p>
        </div>
        <div className="cal-nav">
          <div className="cal-arrows">
            <button className="icon-btn bordered" onClick={() => shift(-1)} aria-label="Mois précédent"><ChevronLeft size={18} /></button>
            <button className="btn" onClick={goToday}>Aujourd'hui</button>
            <button className="icon-btn bordered" onClick={() => shift(1)} aria-label="Mois suivant"><ChevronRight size={18} /></button>
          </div>
          <label className="toggle"><input type="checkbox" checked={showTasks} onChange={e => setShowTasks(e.target.checked)} /> Échéances des actions</label>
          <button className="btn primary desktop-only" onClick={() => editEvent(null, { date: today })}><CalendarPlus size={16} /> Événement</button>
        </div>
      </div>

      <div className="calendar" role="group" aria-label={`Calendrier ${month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`}>
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => <div key={d} className="dow" aria-hidden="true">{d}</div>)}
        {cells.map(d => {
          const key = iso(d);
          const list = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              aria-pressed={mobile ? sel === key : undefined}
              aria-label={`${longDay(key)}${list.length ? `, ${list.length} élément${list.length > 1 ? 's' : ''}` : ''}${mobile ? '' : ', ajouter un événement'}`}
              className={`day ${d.getMonth() !== m ? 'other' : ''} ${key === today ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'weekend' : ''} ${mobile && sel === key ? 'selected' : ''}`}
              onClick={() => pickDay(key)}
              onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickDay(key); } }}
            >
              <span className="daynum">{d.getDate()}</span>
              {mobile ? (
                list.length > 0 && (
                  <span className="day-dots" aria-hidden="true">
                    {list.slice(0, 3).map(it => <i key={it.key} className={it.kind} style={{ ['--c' as string]: it.color }} />)}
                    {list.length > 3 && <small>+{list.length - 3}</small>}
                  </span>
                )
              ) : list.map(it => (
                <button
                  key={it.key}
                  className={`evt ${it.kind} ${it.done ? 'is-done' : ''}`}
                  style={{ ['--c' as string]: it.color }}
                  title={it.time ? `${it.time} · ${it.name}` : it.name}
                  onClick={e => { e.stopPropagation(); it.open(); }}
                >
                  {it.kind === 'task' && <Check size={11} strokeWidth={3} />}
                  {it.time && <b className="evt-time">{it.time.split('–')[0]}</b>}
                  <span>{it.name}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <section className="panel agenda" aria-live="polite">
        <div className="panel-head">
          <h3>{sel ? <span className="cap">{longDay(sel)}</span> : 'Agenda du mois'}</h3>
          {sel
            ? <button className="link" onClick={() => setSelected(null)}>Tout le mois</button>
            : <span className="count">{agenda.length}</span>}
        </div>
        {agenda.length ? agenda.map(it => {
          const d = dayMonth(it.date);
          return (
            <button key={it.key} className="date-row" style={{ ['--c' as string]: it.color }} onClick={it.open}>
              <span className="datebox">
                {sel && it.time ? <><b className="time">{it.time.split('–')[0]}</b><small>{it.time.split('–')[1] ?? ''}</small></> : <><b>{d.day}</b><small>{d.weekday}</small></>}
              </span>
              <span className="subject-row-main">
                <span className="row-title">{it.name}</span>
                <span className="meta">{!sel && it.time && `${it.time} · `}{it.label}</span>
              </span>
            </button>
          );
        }) : <Empty>{sel ? 'Rien ce jour-là.' : 'Rien ce mois-ci.'}</Empty>}
        <button className="add-row" onClick={() => editEvent(null, { date: sel ?? today })}>
          <Plus size={16} /> Ajouter un événement{sel ? ` le ${new Date(sel + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : ''}
        </button>
      </section>

      <p className="hint foot-hint">Le 17 novembre (Moon) et le 1er décembre (Edison) sont des dates indicatives, non des dates contractuellement vérifiées. Les réunions mensuelles doivent être confrontées aux semaines de cours.</p>
    </div>
  );
}
