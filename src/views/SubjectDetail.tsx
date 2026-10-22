import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarPlus, Check, Plus, Trash2 } from 'lucide-react';
import { ColorPicker, useEditors } from '../components/editors';
import { TaskRow } from '../components/TaskRow';
import { AutoTextarea, Empty } from '../components/ui';
import { newId, useStore } from '../lib/store';
import { SUBJECT_STATUSES, type Subject } from '../lib/types';
import { dayMonth, go, relative, statusClass, timeRange } from '../lib/utils';

/** Champ éditable sur place, sauvegardé automatiquement (pause de frappe ou sortie du champ). */
function Inline({ value, onSave, placeholder, className, multiline = true }: {
  value: string; onSave: (v: string) => void; placeholder?: string; className?: string; multiline?: boolean;
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
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; flush(draft); },
  };
  return multiline
    ? <AutoTextarea {...common} onChange={e => change(e.target.value)} />
    : <input {...common} onChange={e => change(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function SubjectDetail({ id }: { id: string }) {
  const { db, subject, saveSubject, deleteSubject, saveTask, toast, saving } = useStore();
  const { editEvent } = useEditors();
  const s = subject(id);
  const latest = useRef(s);
  latest.current = s;
  const [quick, setQuick] = useState('');
  const [showColors, setShowColors] = useState(false);

  if (!s) return <div className="page"><Empty>Ce sujet n'existe plus. <button className="link" onClick={() => go('sujets')}>Retour aux sujets</button></Empty></div>;

  const set = (p: Partial<Subject>) => latest.current && saveSubject({ ...latest.current, ...p });
  const tasks = db.tasks.filter(t => t.subject_id === id).sort((a, b) => Number(a.status === 'Terminé') - Number(b.status === 'Terminé') || a.position - b.position);
  const events = db.events.filter(e => e.subject_id === id).sort((a, b) => (a.date + (a.start_time ?? '')).localeCompare(b.date + (b.start_time ?? '')));
  const done = tasks.filter(t => t.status === 'Terminé').length;

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
    ['next_step', 'Prochaine étape', 'Prochaine étape concrète…'],
  ];

  return (
    <div className="page" style={{ ['--c' as string]: s.color }}>
      <button className="btn ghost back" onClick={() => go('sujets')}><ArrowLeft size={16} /> Tous les sujets</button>

      <section className="hero">
        <div className="hero-top">
          <Inline className="category-input" multiline={false} value={s.category} onSave={v => set({ category: v })} placeholder="Catégorie" />
          <div className="hero-actions">
            <button className="color-btn" style={{ background: s.color }} onClick={() => setShowColors(v => !v)} aria-label="Couleur" />
            <select className={`pill-select ${statusClass(s.status)}`} value={s.status} onChange={e => set({ status: e.target.value })}>
              {SUBJECT_STATUSES.map(x => <option key={x}>{x}</option>)}
            </select>
          </div>
        </div>
        {showColors && <ColorPicker value={s.color} onChange={color => { set({ color }); setShowColors(false); }} />}
        <Inline className="title-input" value={s.name} onSave={v => v.trim() && set({ name: v.trim() })} placeholder="Nom du sujet" />
        <Inline className="summary-input" value={s.summary} onSave={v => set({ summary: v })} placeholder="Résumé du sujet…" />
        <div className="hero-meta">
          <span>Origine : <Inline className="meta-input" multiline={false} value={s.origin} onSave={v => set({ origin: v })} placeholder="—" /></span>
          <span>Échéance : <input type="date" className="inline meta-input" value={s.due_date ?? ''} onChange={e => set({ due_date: e.target.value || null })} /></span>
          {tasks.length > 0 && <span>{done}/{tasks.length} actions terminées</span>}
          <span className="autosave">{saving ? 'Enregistrement…' : <><Check size={13} /> Enregistré</>}</span>
        </div>
      </section>

      <div className="grid-2 detail">
        <div className="col">
          <section className="panel">
            <h3>Contexte & cadrage</h3>
            {blocks.map(([k, label, ph]) => (
              <div key={k} className="fact">
                <h4>{label}</h4>
                <Inline value={String(s[k] ?? '')} onSave={v => set({ [k]: v })} placeholder={ph} />
              </div>
            ))}
          </section>
          <section className="panel">
            <h3>Notes complémentaires</h3>
            <Inline className="notes" value={s.notes} onSave={v => set({ notes: v })} placeholder="Saisir les informations apprises lors des prochains échanges…" />
          </section>
        </div>

        <div className="col">
          <section className="panel">
            <h3>Interlocuteurs</h3>
            <Inline value={s.people} onSave={v => set({ people: v })} placeholder="Noms, rôles…" />
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Actions liées</h3><span className="count">{tasks.length}</span></div>
            {tasks.map(t => <TaskRow key={t.id} t={t} showSubject={false} />)}
            <div className="quick-add">
              <Plus size={16} />
              <input value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => e.key === 'Enter' && addQuick()} placeholder="Ajouter une action puis Entrée" />
            </div>
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
                    <span className="meta">{e.start_time && `${timeRange(e.start_time, e.end_time)} · `}{e.kind} · {relative(e.date)}</span>
                  </span>
                </button>
              );
            }) : <p className="hint">Aucune date liée.</p>}
          </section>

          <button className="btn danger ghost" onClick={() => {
            if (confirm(`Supprimer le sujet « ${s.name} » ?\nSes actions et événements sont conservés (sans sujet).`)) {
              deleteSubject(id); toast('Sujet supprimé'); go('sujets');
            }
          }}><Trash2 size={15} /> Supprimer ce sujet</button>
        </div>
      </div>
    </div>
  );
}
