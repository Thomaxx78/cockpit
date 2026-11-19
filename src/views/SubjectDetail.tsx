import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRightLeft, CalendarCheck2, CalendarPlus, Check, CheckCircle2, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { ColorPicker, useEditors } from '../components/editors';
import { TaskRow } from '../components/TaskRow';
import { AutoTextarea, Empty } from '../components/ui';
import { newId, useStore } from '../lib/store';
import { isPastMeeting, SUBJECT_STATUSES, type Activity, type CalEvent, type Subject } from '../lib/types';
import { dayMonth, fmtShort, go, iso, relative, statusClass, timeRange, todayIso } from '../lib/utils';
import '../styles/history.css';

type HistoryEntry = { key: string; sort: string; day: string; icon: ReactNode; tone?: 'done' | 'deleted'; prefix: string; text: string; eventId?: string };

/** Historique d'un sujet, du plus récent au plus ancien : statuts, actions, réunions passées. */
function subjectHistory(id: string, activity: Activity[], events: CalEvent[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const local = (at: string) => { const d = new Date(at); return { day: iso(d), sort: iso(d) + 'T' + d.toTimeString().slice(0, 8) }; };
  for (const a of activity) {
    if (a.subject_id !== id) continue;
    const { day, sort } = local(a.at);
    const base = { key: 'a' + a.id, day, sort };
    if (a.entity === 'subject') {
      if (a.kind === 'created') out.push({ ...base, icon: <Sparkles size={14} />, prefix: 'Sujet créé', text: '' });
      else if (a.kind === 'status') out.push({ ...base, icon: <ArrowRightLeft size={14} />, prefix: 'Statut :', text: `${a.from_status ?? '—'} → ${a.to_status ?? '—'}` });
    } else if (a.entity === 'task') {
      if (a.kind === 'created') out.push({ ...base, icon: <Plus size={14} />, prefix: 'Action créée :', text: a.label });
      else if (a.kind === 'deleted') out.push({ ...base, icon: <Trash2 size={14} />, tone: 'deleted', prefix: 'Action supprimée :', text: a.label });
      else if (a.to_status === 'Terminé') out.push({ ...base, icon: <CheckCircle2 size={14} />, tone: 'done', prefix: 'Action terminée :', text: a.label });
      else if (a.from_status === 'Terminé') out.push({ ...base, icon: <RotateCcw size={14} />, prefix: 'Action rouverte :', text: a.label });
    }
  }
  const today = todayIso();
  for (const e of events) {
    if (e.subject_id !== id || !isPastMeeting(e, today)) continue;
    out.push({ key: 'e' + e.id, day: e.date, sort: e.date + 'T' + (e.start_time ?? '00:00'), icon: <CalendarCheck2 size={14} />, prefix: 'Réunion :', text: e.name, eventId: e.id });
  }
  return out.sort((a, b) => b.sort.localeCompare(a.sort));
}

/** Champ éditable sur place, sauvegardé automatiquement (pause de frappe ou sortie du champ). */
function Inline({ value, onSave, placeholder, className, multiline = true, label, autoFocus }: {
  value: string; onSave: (v: string) => void; placeholder?: string; className?: string; multiline?: boolean; label?: string; autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<number>();
  const latest = useRef({ value, onSave });
  latest.current = { value, onSave };
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  const flush = (v: string) => { clearTimeout(timer.current); if (v !== latest.current.value) latest.current.onSave(v); };
  const change = (v: string) => {
    setDraft(v);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(v), 800);
  };
  const common = {
    className: `inline ${className ?? ''}`,
    value: draft,
    placeholder,
    'aria-label': label ?? placeholder,
    autoFocus,
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; flush(draft); },
  };
  return multiline
    ? <AutoTextarea {...common} onChange={e => change(e.target.value)} />
    : <input {...common} onChange={e => change(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function SubjectDetail({ id }: { id: string }) {
  const { db, activity, subject, saveSubject, deleteSubject, saveTask, toast, saving } = useStore();
  const { editEvent } = useEditors();
  const s = subject(id);
  const latest = useRef(s);
  latest.current = s;
  const [quick, setQuick] = useState('');
  const [showColors, setShowColors] = useState(false);
  const [opened, setOpened] = useState<(keyof Subject)[]>([]);
  const [allHistory, setAllHistory] = useState(false);

  if (!s) return <div className="page"><Empty>Ce sujet n'existe plus. <button className="link" onClick={() => go('')}>Retour au calendrier</button></Empty></div>;

  const set = (p: Partial<Subject>) => latest.current && saveSubject({ ...latest.current, ...p });
  const tasks = db.tasks.filter(t => t.subject_id === id).sort((a, b) => Number(a.status === 'Terminé') - Number(b.status === 'Terminé') || a.position - b.position);
  const events = db.events.filter(e => e.subject_id === id).sort((a, b) => (a.date + (a.start_time ?? '')).localeCompare(b.date + (b.start_time ?? '')));
  const done = tasks.filter(t => t.status === 'Terminé').length;
  const history = subjectHistory(id, activity, db.events);
  const HISTORY_SHORT = 6;

  const addQuick = () => {
    const name = quick.trim();
    if (!name) return;
    saveTask({ id: newId('t'), name, subject_id: id, status: 'À faire', priority: 'P2', owner: '', due_date: null, position: Math.max(0, ...db.tasks.map(t => t.position)) + 1 });
    setQuick('');
    toast('Action ajoutée');
  };

  const blocks: [keyof Subject, string, string][] = [
    ['confirmed', 'Confirmé', 'Ce qui est acquis…'],
    ['hypothesis', 'Hypothèses', 'Ce qui reste supposé…'],
    ['questions', 'À clarifier', 'Questions ouvertes…'],
  ];
  // Un bloc vide est replié en simple lien « + Ajouter » tant qu'on ne l'ouvre pas.
  const shown = (k: keyof Subject) => !!String(s[k] ?? '').trim() || opened.includes(k);

  return (
    <div className="page" style={{ ['--c' as string]: s.color }}>
      <button className="btn ghost back" onClick={() => (window.history.length > 1 ? window.history.back() : go(''))}><ArrowLeft size={16} /> Retour</button>

      <section className="hero">
        <div className="hero-top">
          <Inline className="category-input" multiline={false} value={s.category} onSave={v => set({ category: v })} placeholder="Catégorie" />
          <div className="hero-actions">
            <button className="color-btn" style={{ background: s.color }} onClick={() => setShowColors(v => !v)} aria-label="Couleur" />
            <select aria-label="Statut du sujet" className={`pill-select ${statusClass(s.status)}`} value={s.status} onChange={e => set({ status: e.target.value })}>
              {SUBJECT_STATUSES.map(x => <option key={x}>{x}</option>)}
            </select>
          </div>
        </div>
        {showColors && <ColorPicker value={s.color} onChange={color => { set({ color }); setShowColors(false); }} />}
        <Inline className="title-input" value={s.name} onSave={v => v.trim() && set({ name: v.trim() })} placeholder="Nom du sujet" />
        <Inline className="summary-input" value={s.summary} onSave={v => set({ summary: v })} placeholder="Résumé du sujet…" />
        <div className="hero-meta">
          <span>Échéance : <input type="date" aria-label="Échéance du sujet" className="inline meta-input" value={s.due_date ?? ''} onChange={e => set({ due_date: e.target.value || null })} /></span>
          {tasks.length > 0 && (
            <span className="hero-progress" title={`${done}/${tasks.length} actions terminées`}>
              <span className="progress"><span style={{ width: `${(done / tasks.length) * 100}%` }} /></span>
              {done}/{tasks.length}
            </span>
          )}
          <span className="autosave">{saving ? 'Enregistrement…' : <><Check size={13} /> Enregistré</>}</span>
        </div>
      </section>

      <div className="grid-2 detail">
        <div className="col">
          <section className="panel">
            <div className="panel-head"><h3>Actions</h3><span className="count">{tasks.length}</span></div>
            {tasks.map(t => <TaskRow key={t.id} t={t} showSubject={false} />)}
            <div className="quick-add">
              <Plus size={16} />
              <input value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => e.key === 'Enter' && addQuick()} placeholder="Ajouter une action puis Entrée" />
            </div>
          </section>

          <section className="panel">
            <h3>Contexte & cadrage</h3>
            {blocks.filter(([k]) => shown(k)).map(([k, label, ph]) => (
              <div key={k} className="fact">
                <h4>{label}</h4>
                <Inline value={String(s[k] ?? '')} onSave={v => set({ [k]: v })} placeholder={ph} label={label} autoFocus={opened.includes(k)} />
              </div>
            ))}
            {blocks.some(([k]) => !shown(k)) && (
              <div className="fact-add">
                {blocks.filter(([k]) => !shown(k)).map(([k, label]) => (
                  <button key={k} className="link" onClick={() => setOpened(o => [...o, k])}><Plus size={13} /> {label}</button>
                ))}
              </div>
            )}
            <div className="fact origin">
              <span>Origine :</span>
              <Inline className="meta-input" multiline={false} value={s.origin} onSave={v => set({ origin: v })} placeholder="—" label="Origine" />
            </div>
          </section>

          <section className="panel">
            <h3>Notes</h3>
            <Inline className="notes" value={s.notes} label="Notes" onSave={v => set({ notes: v })} placeholder="Informations apprises lors des échanges…" />
          </section>
        </div>

        <div className="col">
          <section className="panel next-step">
            <h3>Prochaine étape</h3>
            <Inline value={s.next_step} onSave={v => set({ next_step: v })} placeholder="Prochaine étape concrète…" label="Prochaine étape" />
          </section>

          <section className="panel">
            <h3>Interlocuteurs</h3>
            <Inline value={s.people} onSave={v => set({ people: v })} placeholder="Noms, rôles…" label="Interlocuteurs" />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Dates</h3>
              <button className="link" onClick={() => editEvent(null, { subject_id: id })}><CalendarPlus size={14} /> Ajouter</button>
            </div>
            {events.length ? events.map(e => {
              const d = dayMonth(e.date);
              return (
                <button key={e.id} className="date-row" onClick={() => editEvent(e)}>
                  <span className="datebox"><b>{d.day}</b><small>{d.month}</small></span>
                  <span className="subject-row-main">
                    <span className="row-title">{e.name}</span>
                    <span className="meta">{[e.start_time && timeRange(e.start_time, e.end_time), relative(e.date), /Échéance|Hypothèse/.test(e.kind) && e.kind].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              );
            }) : <p className="hint">Aucune date liée.</p>}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Historique</h3>
              {history.length > 0 && <span className="count">{history.length}</span>}
            </div>
            {history.length ? (
              <>
                <ul className="hist-feed">
                  {(allHistory ? history : history.slice(0, HISTORY_SHORT)).map(h => {
                    const ev = h.eventId ? db.events.find(e => e.id === h.eventId) : undefined;
                    return (
                      <li key={h.key} className="hist-entry">
                        <span className="hist-date">{fmtShort(h.day)}</span>
                        <span className={`hist-ico ${h.tone ?? ''}`} aria-hidden="true">{h.icon}</span>
                        {ev
                          ? <button className="hist-text" onClick={() => editEvent(ev)}><b>{h.prefix}</b> {h.text}</button>
                          : <span className="hist-text"><b>{h.prefix}</b> {h.text}</span>}
                      </li>
                    );
                  })}
                </ul>
                {history.length > HISTORY_SHORT && (
                  <button className="link hist-more" onClick={() => setAllHistory(v => !v)} aria-expanded={allHistory}>
                    {allHistory ? 'Réduire' : `Tout voir (${history.length})`}
                  </button>
                )}
              </>
            ) : <p className="hint">Les changements de ce sujet s'afficheront ici au fil de l'eau.</p>}
          </section>
        </div>
      </div>

      <button className="btn danger ghost delete-subject" onClick={() => {
        if (confirm(`Supprimer le sujet « ${s.name} » ?\nSes actions et événements sont conservés (sans sujet).`)) {
          deleteSubject(id); toast('Sujet supprimé'); go('');
        }
      }}><Trash2 size={15} /> Supprimer ce sujet</button>
    </div>
  );
}
