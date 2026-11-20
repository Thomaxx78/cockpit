import { useEffect, useState, type CSSProperties, type DragEvent } from 'react';
import { CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Plus } from 'lucide-react';
import { useEditors } from '../components/editors';
import { NextMeeting } from '../components/NextMeeting';
import { Empty } from '../components/ui';
import { useStore } from '../lib/store';
import { isActive, type Task } from '../lib/types';
import { dayMonth, iso, MOBILE, timeRange, todayIso, useMedia } from '../lib/utils';
import '../styles/motion-calendar.css';

type Item = {
  key: string; date: string; time: string; sort: string; name: string; color?: string; subject?: string;
  kind: 'event' | 'task'; label: string; done?: boolean;
  /** Créneau en minutes depuis minuit (null : journée entière ou échéance). */
  start: number | null; end: number | null;
  open: () => void;
};

const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
function slot(start: string | null, end: string | null): [number, number] | [null, null] {
  if (!start) return [null, null];
  const s = minutes(start);
  const e = end ? minutes(end) : s + 60; // sans heure de fin : 1h
  return [s, e > s ? e : s + 30];
}
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** Axe vertical des cases du mois : 8h (haut) → 20h (bas). */
const CELL_START = 8 * 60;
const CELL_END = 20 * 60;

type Placed = { it: Item; top: number; bottom: number; lane: number; lanes: number };
/**
 * Place les créneaux sur un axe vertical (en %). Hauteur minimale `minPct` pour garder le libellé lisible ;
 * les créneaux qui se chevauchent se partagent la largeur.
 */
function place(timed: Item[], from: number, to: number, minPct: number): Placed[] {
  const pct = (m: number) => Math.min(100, Math.max(0, ((m - from) / (to - from)) * 100));
  const blocks: Placed[] = timed
    .map(it => {
      const top = Math.min(pct(it.start!), 100 - minPct);
      return { it, top, bottom: Math.min(100, Math.max(pct(it.end!), top + minPct)), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let group: Placed[] = [];
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

const blockStyle = (b: Placed, gap: string) => ({
  ['--c' as string]: b.it.color,
  top: `${b.top}%`,
  height: `${b.bottom - b.top}%`,
  left: `${(b.lane / b.lanes) * 100}%`,
  width: `calc(${100 / b.lanes}% - ${gap})`,
});

/* ---------- Glisser-déposer des tickets (ordinateur) ----------
   Un ticket sans date se glisse sur un jour pour lui donner une échéance ; une échéance se déplace
   d'un jour à l'autre, ou se retire en la reposant dans « À planifier ». */
const DRAG_TYPE = 'application/x-cockpit-task';
const TRAY_KEY = 'cockpit-cal-tray';
const dragTask = (id: string) => (e: DragEvent) => {
  e.dataTransfer.setData(DRAG_TYPE, id);
  e.dataTransfer.setData('text/plain', id);
  e.dataTransfer.effectAllowed = 'move';
};
const isTaskDrag = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);

function Tray({ tasks, onDropBack, dragging }: { tasks: Task[]; onDropBack: (id: string) => void; dragging: boolean }) {
  const { subject } = useStore();
  const { editTask } = useEditors();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(TRAY_KEY) !== '0'; } catch { return true; } });
  const [over, setOver] = useState(false);
  const toggle = () => setOpen(o => { try { localStorage.setItem(TRAY_KEY, o ? '0' : '1'); } catch { /* stockage indisponible */ } return !o; });
  if (!tasks.length && !dragging) return null;
  return (
    <section
      className={`cal-tray ${over ? 'drop-over' : ''} ${dragging ? 'dragging' : ''}`}
      aria-label="Tickets à planifier"
      onDragOver={e => { if (isTaskDrag(e)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { setOver(false); const id = e.dataTransfer.getData(DRAG_TYPE); if (id) { e.preventDefault(); onDropBack(id); } }}
    >
      <button className="cal-tray-head" onClick={toggle} aria-expanded={open}>
        <ChevronDown size={15} className={`chev ${open ? '' : 'closed'}`} />
        <b>À planifier</b><span className="count">{tasks.length}</span>
        <span className="cal-tray-hint">Glisse un ticket sur un jour pour lui donner une échéance</span>
      </button>
      {open && (
        <div className="cal-tray-list">
          {tasks.map((t, i) => (
            <button
              key={t.id} className="cal-chip" draggable onDragStart={dragTask(t.id)} onClick={() => editTask(t)}
              style={{ ['--c' as string]: subject(t.subject_id)?.color, ['--i' as string]: Math.min(i, 10) }} title={`${t.name} — glisser sur un jour`}
            >
              <GripVertical size={12} className="grip" /><i className="evt-dot" /><span>{t.name}</span>
            </button>
          ))}
          {!tasks.length && <span className="cal-tray-empty">Dépose ici pour retirer l’échéance</span>}
        </div>
      )}
    </section>
  );
}

const longDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Vue d'une journée : heures en marge, réunions à leur place réelle, heure actuelle. */
function DayView({ day, items, today }: { day: string; items: Item[]; today: string }) {
  const timed = items.filter(it => it.start !== null);
  const untimed = items.filter(it => it.start === null);
  // Plage affichée : 8h–20h, élargie si une réunion déborde.
  const from = Math.min(CELL_START, ...timed.map(it => Math.floor(it.start! / 60) * 60));
  const to = Math.max(CELL_END, ...timed.map(it => Math.ceil(Math.min(it.end!, 24 * 60) / 60) * 60));
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from / 60 + i);
  const pct = (m: number) => ((m - from) / (to - from)) * 100;
  const now = nowMinutes();
  const showNow = day === today && now >= from && now <= to;

  if (!items.length) return <Empty>Rien ce jour-là.</Empty>;
  return (
    <div className="dayview">
      {untimed.length > 0 && (
        <div className="dv-allday">
          {untimed.map(it => (
            <button key={it.key} className={`dv-chip ${it.kind} ${it.done ? 'is-done' : ''}`} style={{ ['--c' as string]: it.color }} onClick={it.open}>
              {it.kind === 'task' ? <Check size={13} strokeWidth={3} /> : <i className="evt-dot" />}
              <span>{it.name}</span>
            </button>
          ))}
        </div>
      )}
      {timed.length > 0 && (
        <div className="dv-grid" style={{ height: hours.length * 44 - 44 }}>
          {hours.map(h => <div key={h} className="dv-hour" style={{ top: `${pct(h * 60)}%` }}><span>{h}h</span></div>)}
          <div className="dv-track">
            {place(timed, from, to, (30 / (to - from)) * 100).map((b, i) => (
              <button
                key={b.it.key}
                // Moins de 50 min : heure et nom sur une ligne ; moins de 1h30 : pas de sujet.
                className={`dv-block ${b.it.end! - b.it.start! < 50 ? 'short' : b.it.end! - b.it.start! < 90 ? 'compact' : ''}`}
                style={{ ...blockStyle(b, '4px'), ['--i' as string]: Math.min(i, 8) }}
                onClick={b.it.open}
                title={`${b.it.time} · ${b.it.name}`}
              >
                <b>{b.it.time}</b>
                <span>{b.it.name}</span>
                {b.it.subject && b.it.end! - b.it.start! >= 90 && <small>{b.it.subject}</small>}
              </button>
            ))}
            {showNow && <i className="dv-now" style={{ top: `${pct(now)}%` }} aria-label="Maintenant" />}
          </div>
        </div>
      )}
    </div>
  );
}

export function Calendar() {
  const { db, subject, saveTask, toast } = useStore();
  const { editEvent, editTask } = useEditors();
  const [overDay, setOverDay] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const setDue = (id: string, due: string | null) => {
    const t = db.tasks.find(x => x.id === id);
    if (!t || t.due_date === due) return;
    saveTask({ ...t, due_date: due });
    if (!showTasks && due) setShowTasks(true);
    toast(due ? `Échéance : ${new Date(due + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'Échéance retirée');
  };
  const unplanned = db.tasks.filter(t => !t.due_date && isActive(t.status)).sort((a, b) => a.priority.localeCompare(b.priority) || a.position - b.position);
  const mobile = useMedia(MOBILE);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [showTasks, setShowTasks] = useState(true);
  const today = todayIso();
  // Mouvement de la page (styles/motion-calendar.css) : « arrive » à l'ouverture, « next »/« prev »
  // quand on change de mois. Retiré après 1 s : seuls les éléments montés pendant ce court
  // instant s'animent ; une synchro des données ou un ticket déposé ne rejouent rien.
  // Un nouvel objet à chaque fois : deux clics « suivant » d'affilée relancent bien le minuteur.
  const [motion, setMotion] = useState<{ kind: 'arrive' | 'next' | 'prev' } | null>({ kind: 'arrive' });
  useEffect(() => {
    if (!motion) return;
    const id = setTimeout(() => setMotion(null), 1000);
    return () => clearTimeout(id);
  }, [motion]);
  // Sur téléphone, un jour est toujours sélectionné (vue de la journée sous la grille).
  // Sur ordinateur, la vue de la journée s'ouvre en cliquant le numéro du jour ou « +N ».
  const [selected, setSelected] = useState<string | null>(() => (mobile ? today : null));
  const y = month.getFullYear();
  const m = month.getMonth();
  const start = (new Date(y, m, 1).getDay() + 6) % 7;
  const weeks = Math.ceil((start + new Date(y, m + 1, 0).getDate()) / 7);

  const items: Item[] = [
    ...db.events.map(e => {
      const [s, en] = slot(e.start_time, e.end_time);
      const subj = subject(e.subject_id);
      return {
        key: e.id, date: e.date, time: timeRange(e.start_time, e.end_time), sort: e.start_time ?? '', name: e.name,
        color: subj?.color, subject: subj?.name, kind: 'event' as const, label: e.kind, start: s, end: en, open: () => editEvent(e),
      };
    }),
    ...(showTasks ? db.tasks.filter(t => t.due_date).map(t => ({
      key: t.id, date: t.due_date!, time: '', sort: '99', name: t.name, color: subject(t.subject_id)?.color, subject: subject(t.subject_id)?.name,
      kind: 'task' as const, label: 'Échéance d’action', done: t.status === 'Terminé', start: null, end: null, open: () => editTask(t),
    })) : []),
  ];
  const byDay = new Map<string, Item[]>();
  for (const it of [...items].sort((a, b) => a.sort.localeCompare(b.sort))) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);

  const cells = Array.from({ length: weeks * 7 }, (_, i) => new Date(y, m, i - start + 1));
  const monthPrefix = iso(month).slice(0, 7);
  const sel = selected && selected.startsWith(monthPrefix) ? selected : null;
  const agenda = items.filter(it => it.date.startsWith(monthPrefix)).sort((a, b) => (a.date + a.sort).localeCompare(b.date + b.sort));
  const shift = (n: number) => { setMonth(new Date(y, m + n, 1)); setSelected(null); setMotion({ kind: n > 0 ? 'next' : 'prev' }); };
  const goToday = () => {
    const d = new Date();
    const target = new Date(d.getFullYear(), d.getMonth(), 1);
    if (target.getTime() !== month.getTime()) setMotion({ kind: target > month ? 'next' : 'prev' });
    setMonth(target);
    setSelected(mobile ? today : null);
  };
  const MAX_TOP = 2;
  const pickDay = (key: string) => (mobile ? setSelected(key) : editEvent(null, { date: key }));
  const openDay = (key: string) => setSelected(s => (s === key && !mobile ? null : key));

  // Sur ordinateur, amène la vue de la journée à l'écran quand on l'ouvre.
  useEffect(() => {
    if (sel && !mobile) document.getElementById('day-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [sel, mobile]);

  const now = nowMinutes();
  const cellPct = (min: number) => ((min - CELL_START) / (CELL_END - CELL_START)) * 100;

  return (
    // Un glisser coupe l'arrivée : rien ne bouge sous le ticket ni sous les cases où on le dépose.
    <div className={`page cal-page${motion ? ` is-${motion.kind}` : ''}`} onDragStartCapture={() => setMotion(null)}>
      <div className="page-head cal-head">
        <div>
          <h2 key={monthPrefix} className="month-title">{month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</h2>
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

      <NextMeeting events={db.events} />

      {!mobile && <Tray tasks={unplanned} onDropBack={id => setDue(id, null)} dragging={dragging} />}

      <div
        // Clé du mois : la grille est remontée à chaque changement de mois, ses cases arrivent du bon côté.
        key={monthPrefix}
        className="calendar" role="group"
        onDragStart={() => setDragging(true)} onDragEnd={() => { setDragging(false); setOverDay(null); }} aria-label={`Calendrier ${month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`}>
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => <div key={d} className="dow" aria-hidden="true">{d}</div>)}
        {cells.map((d, i) => {
          const key = iso(d);
          const list = byDay.get(key) ?? [];
          const timed = list.filter(it => it.start !== null);
          const untimed = list.filter(it => it.start === null);
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              // Rang sur la diagonale (ligne + colonne) : la grille se remplit en vague depuis le coin haut gauche.
              style={{ '--k': Math.floor(i / 7) + (i % 7) } as CSSProperties}
              aria-pressed={mobile ? sel === key : undefined}
              aria-label={`${longDay(key)}${list.length ? `, ${list.length} élément${list.length > 1 ? 's' : ''}` : ''}${mobile ? '' : ', ajouter un événement'}`}
              className={`day ${d.getMonth() !== m ? 'other' : ''} ${key === today ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'weekend' : ''} ${sel === key ? 'selected' : ''} ${overDay === key ? 'drop-over' : ''}`}
              onClick={() => pickDay(key)}
              onDragOver={e => { if (!mobile && isTaskDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overDay !== key) setOverDay(key); } }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverDay(o => (o === key ? null : o)); }}
              onDrop={e => {
                const id = e.dataTransfer.getData(DRAG_TYPE);
                setOverDay(null);
                setDragging(false);
                if (id) { e.preventDefault(); setDue(id, key); }
              }}
              onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickDay(key); } }}
            >
              {mobile ? <>
                <span className="daynum">{d.getDate()}</span>
                {list.length > 0 && (
                  // Téléphone : une barre par réunion, d'autant plus haute qu'elle est longue ; un point pour le reste.
                  <span className="day-dots" aria-hidden="true">
                    {timed.slice(0, 3).map(it => (
                      <i key={it.key} className="bar" style={{ ['--c' as string]: it.color, height: `${Math.round(4 + Math.min(1, (it.end! - it.start!) / 480) * 12)}px` }} />
                    ))}
                    {untimed.slice(0, Math.max(0, 3 - timed.length)).map(it => <i key={it.key} className={it.kind} style={{ ['--c' as string]: it.color }} />)}
                    {list.length > 3 && <small>+{list.length - 3}</small>}
                  </span>
                )}
              </> : <>
                <button className="daynum" title="Voir la journée" aria-label={`Voir le ${longDay(key)}`} onClick={e => { e.stopPropagation(); openDay(key); }}>{d.getDate()}</button>
                {untimed.slice(0, untimed.length > MAX_TOP ? MAX_TOP - 1 : MAX_TOP).map(it => (
                  <button
                    key={it.key}
                    className={`evt ${it.kind} ${it.done ? 'is-done' : ''}`}
                    style={{ ['--c' as string]: it.color }}
                    title={it.kind === 'task' ? `${it.name} — glisser pour changer l’échéance` : it.name}
                    draggable={it.kind === 'task'}
                    onDragStart={it.kind === 'task' ? dragTask(it.key) : undefined}
                    onClick={e => { e.stopPropagation(); it.open(); }}
                  >
                    {it.kind === 'task' ? <Check size={11} strokeWidth={3} /> : <i className="evt-dot" />}
                    <span>{it.name}</span>
                  </button>
                ))}
                {untimed.length > MAX_TOP && (
                  <button className="evt-more" onClick={e => { e.stopPropagation(); openDay(key); }}>
                    +{untimed.length - (MAX_TOP - 1)} autres
                  </button>
                )}
                {(timed.length > 0 || key === today) && (
                  <div className="day-track">
                    {place(timed, CELL_START, CELL_END, 24).map(b => (
                      <button
                        key={b.it.key}
                        className="evt-block"
                        style={blockStyle(b, '2px')}
                        title={`${b.it.time} · ${b.it.name}`}
                        onClick={e => { e.stopPropagation(); b.it.open(); }}
                      >
                        <b>{b.it.time.split('–')[0]}</b> <span className="evt-name">{b.it.name}</span>
                      </button>
                    ))}
                    {key === today && now >= CELL_START && now <= CELL_END && <i className="now-line" style={{ top: `${cellPct(now)}%` }} />}
                  </div>
                )}
              </>}
            </div>
          );
        })}
      </div>

      <section id="day-panel" className={`panel agenda ${sel ? 'show' : ''}`} aria-live="polite">
        <div className="panel-head">
          {/* Clés : titre et contenu se remplacent en fondu quand on change de jour. */}
          <h3 key={sel ?? 'month'}>{sel ? <span className="cap">{longDay(sel)}</span> : 'Agenda du mois'}</h3>
          {sel
            ? <button className="link" onClick={() => setSelected(null)}>{mobile ? 'Tout le mois' : 'Fermer'}</button>
            : <span className="count">{agenda.length}</span>}
        </div>
        {sel ? <DayView key={sel} day={sel} items={byDay.get(sel) ?? []} today={today} />
          : agenda.length ? agenda.map((it, i) => {
            const d = dayMonth(it.date);
            return (
              <button key={it.key} className="date-row" style={{ ['--c' as string]: it.color, ['--i' as string]: Math.min(i, 8) }} onClick={it.open}>
                <span className="datebox"><b>{d.day}</b><small>{d.weekday}</small></span>
                <span className="subject-row-main">
                  <span className="row-title">{it.name}</span>
                  <span className="meta">{[it.time, it.label].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            );
          }) : <Empty>Rien ce mois-ci.</Empty>}
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
