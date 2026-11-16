import { useState } from 'react';
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEditors } from '../components/editors';
import { Empty } from '../components/ui';
import { useStore } from '../lib/store';
import { dayMonth, iso, MOBILE, timeRange, todayIso, useMedia } from '../lib/utils';

type Item = { key: string; date: string; time: string; sort: string; name: string; color?: string; kind: 'event' | 'task'; label: string; done?: boolean; span?: [number, number] | null; open: () => void };

/** Axe vertical de chaque case : la journée de 8h (haut) à 20h (bas). */
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
/** Hauteur minimale d'un bloc (en % de l'axe) pour que son libellé reste lisible. */
const MIN_PCT = 18;
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const pct = (m: number) => Math.min(100, Math.max(0, ((m - DAY_START) / (DAY_END - DAY_START)) * 100));

/** Position réelle du créneau sur l'axe de la journée, en % (début, fin). */
function daySpan(start: string | null, end: string | null): [number, number] | null {
  if (!start) return null;
  const s = minutes(start);
  let e = end ? minutes(end) : s + 60; // sans heure de fin : 1h
  if (e <= s) e = s + 30;
  return [pct(s), pct(e)];
}

type Block = { it: Item; top: number; bottom: number; lane: number; lanes: number };
/** Place les réunions sur l'axe vertical ; celles qui se chevauchent se partagent la largeur. */
function layoutDay(timed: Item[]): Block[] {
  const blocks: Block[] = timed
    .map(it => {
      const [from, to] = it.span!;
      const top = Math.min(from, 100 - MIN_PCT);
      return { it, top, bottom: Math.min(100, Math.max(to, top + MIN_PCT)), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let group: Block[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const close = () => { for (const b of group) b.lanes = laneEnds.length; group = []; laneEnds = []; };
  for (const b of blocks) {
    if (b.top >= groupEnd) { close(); groupEnd = -1; }
    let lane = laneEnds.findIndex(end => end <= b.top);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = b.bottom;
    b.lane = lane;
    groupEnd = Math.max(groupEnd, b.bottom);
    group.push(b);
  }
  close();
  return blocks;
}

const longDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export function Calendar() {
  const { db, subject } = useStore();
  const { editEvent, editTask } = useEditors();
  const mobile = useMedia(MOBILE);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [showTasks, setShowTasks] = useState(true);
  const today = todayIso();
  // Sur téléphone, toucher un jour le sélectionne (agenda du jour) au lieu d'ouvrir un formulaire.
  // Sur ordinateur, l'agenda du jour ne s'affiche que quand on clique « +N ».
  const [selected, setSelected] = useState<string | null>(() => (mobile ? today : null));
  const y = month.getFullYear();
  const m = month.getMonth();
  const start = (new Date(y, m, 1).getDay() + 6) % 7;
  const weeks = Math.ceil((start + new Date(y, m + 1, 0).getDate()) / 7);

  const items: Item[] = [
    ...db.events.map(e => ({ key: e.id, date: e.date, time: timeRange(e.start_time, e.end_time), sort: e.start_time ?? '', name: e.name, color: subject(e.subject_id)?.color, kind: 'event' as const, label: e.kind, span: daySpan(e.start_time, e.end_time), open: () => editEvent(e) })),
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
  const goToday = () => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(mobile ? today : null); };
  const MAX_TOP = 2;
  const pickDay = (key: string) => (mobile ? setSelected(key) : editEvent(null, { date: key }));

  return (
    <div className="page">
      <div className="page-head cal-head">
        <div>
          <h2 className="month-title">{month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</h2>
        </div>
        <div className="cal-nav">
          <div className="cal-arrows">
            <button className="icon-btn bordered" onClick={() => shift(-1)} aria-label="Mois précédent"><ChevronLeft size={18} /></button>
            <button className="btn" onClick={goToday}>Aujourd'hui</button>
            <button className="icon-btn bordered" onClick={() => shift(1)} aria-label="Mois suivant"><ChevronRight size={18} /></button>
          </div>
          <label className="toggle"><input type="checkbox" checked={showTasks} onChange={e => setShowTasks(e.target.checked)} /> Échéances des actions</label>
          <button className="btn desktop-only" onClick={() => editEvent(null, { date: today })}><CalendarPlus size={16} /> Événement</button>
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
              className={`day ${d.getMonth() !== m ? 'other' : ''} ${key === today ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'weekend' : ''} ${sel === key ? 'selected' : ''}`}
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
              ) : (() => {
                // Sans heure (journée entière, échéance) : étiquettes en haut. Avec heure : blocs sur l'axe 8h → 20h.
                const untimed = list.filter(it => !it.span);
                const timed = list.filter(it => it.span);
                const shown = untimed.length > MAX_TOP ? MAX_TOP - 1 : MAX_TOP;
                return <>
                  {untimed.slice(0, shown).map(it => (
                    <button
                      key={it.key}
                      className={`evt ${it.kind} ${it.done ? 'is-done' : ''}`}
                      style={{ ['--c' as string]: it.color }}
                      title={it.name}
                      onClick={e => { e.stopPropagation(); it.open(); }}
                    >
                      {it.kind === 'task' ? <Check size={11} strokeWidth={3} /> : <i className="evt-dot" />}
                      <span>{it.name}</span>
                    </button>
                  ))}
                  {untimed.length > shown && (
                    <button className="evt-more" onClick={e => { e.stopPropagation(); setSelected(key); }}>
                      +{untimed.length - shown} autre{untimed.length - shown > 1 ? 's' : ''}
                    </button>
                  )}
                  {timed.length > 0 && (
                    <div className="day-track">
                      {layoutDay(timed).map(({ it, top, bottom, lane, lanes }) => (
                        <button
                          key={it.key}
                          className="evt-block"
                          style={{
                            ['--c' as string]: it.color,
                            top: `${top}%`,
                            height: `${bottom - top}%`,
                            left: `${(lane / lanes) * 100}%`,
                            width: `calc(${100 / lanes}% - 2px)`,
                          }}
                          title={`${it.time} · ${it.name}`}
                          onClick={e => { e.stopPropagation(); it.open(); }}
                        >
                          <b>{it.time.split('–')[0]}</b> {it.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>;
              })()}
            </div>
          );
        })}
      </div>

      <section className={`panel agenda ${sel ? 'show' : ''}`} aria-live="polite">
        <div className="panel-head">
          <h3>{sel ? <span className="cap">{longDay(sel)}</span> : 'Agenda du mois'}</h3>
          {sel
            ? <button className="link" onClick={() => setSelected(null)}>{mobile ? 'Tout le mois' : 'Fermer'}</button>
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

      <details className="hint foot-hint">
        <summary>Notes sur les dates</summary>
        Le 17 novembre (Moon) et le 1er décembre (Edison) sont des dates indicatives, non des dates contractuellement vérifiées. Les réunions mensuelles doivent être confrontées aux semaines de cours.
      </details>
    </div>
  );
}
