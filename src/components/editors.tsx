import { createContext, useContext, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { features } from '../lib/backend';
import { newId, useStore } from '../lib/store';
import { EVENT_KINDS, PALETTE, PRIORITIES, SUBJECT_STATUSES, TASK_STATUSES, type CalEvent, type Subject, type Task } from '../lib/types';
import { go } from '../lib/utils';
import { Modal } from './ui';

type Editors = {
  editTask: (t: Task | null, defaults?: Partial<Task>) => void;
  editEvent: (e: CalEvent | null, defaults?: Partial<CalEvent>) => void;
  newSubject: () => void;
};
const Ctx = createContext<Editors | null>(null);
export const useEditors = () => useContext(Ctx)!;

type Open =
  | { kind: 'task'; row: Task; isNew: boolean }
  | { kind: 'event'; row: CalEvent; isNew: boolean }
  | { kind: 'subject'; row: Subject }
  | null;

export function EditorsProvider({ children }: { children: ReactNode }) {
  const { db } = useStore();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  const editors: Editors = {
    editTask: (t, d = {}) => setOpen({
      kind: 'task',
      isNew: !t,
      row: t ?? {
        id: newId('t'), name: '', subject_id: null, status: 'À faire', priority: 'P2', owner: '', due_date: null,
        position: Math.max(0, ...db.tasks.map(x => x.position)) + 1, ...d,
      },
    }),
    editEvent: (e, d = {}) => setOpen({
      kind: 'event',
      isNew: !e,
      row: e ?? { id: newId('e'), date: '', name: '', subject_id: null, kind: 'Événement', start_time: null, end_time: null, ...d },
    }),
    newSubject: () => setOpen({
      kind: 'subject',
      row: {
        id: newId('s'), name: '', category: '', status: 'À cadrer', summary: '', confirmed: '', hypothesis: '', questions: '',
        people: '', next_step: '', due_date: null, origin: '', notes: '',
        color: PALETTE[db.subjects.length % PALETTE.length],
        position: Math.max(0, ...db.subjects.map(x => x.position)) + 1,
      },
    }),
  };

  return (
    <Ctx.Provider value={editors}>
      {children}
      {open?.kind === 'task' && <TaskEditor initial={open.row} isNew={open.isNew} onClose={close} />}
      {open?.kind === 'event' && <EventEditor initial={open.row} isNew={open.isNew} onClose={close} />}
      {open?.kind === 'subject' && <SubjectCreator initial={open.row} onClose={close} />}
    </Ctx.Provider>
  );
}

function SubjectSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { db } = useStore();
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">— Sans sujet —</option>
      {db.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

function TaskEditor({ initial, isNew, onClose }: { initial: Task; isNew: boolean; onClose: () => void }) {
  const { saveTask, deleteTask, toast, subject } = useStore();
  const [t, setT] = useState(initial);
  const set = (p: Partial<Task>) => setT(x => ({ ...x, ...p }));
  const submit = () => {
    if (!t.name.trim()) return toast("Donne un nom à l'action", 'error');
    saveTask({ ...t, name: t.name.trim() });
    toast(isNew ? 'Action créée' : 'Action enregistrée');
    onClose();
  };
  return (
    <Modal
      title={isNew ? 'Nouvelle action' : "Modifier l'action"}
      accent={subject(t.subject_id)?.color}
      onClose={onClose}
      footer={<>
        {!isNew && <button className="btn danger ghost" onClick={() => { if (confirm('Supprimer cette action ?')) { deleteTask(t.id); toast('Action supprimée'); onClose(); } }}><Trash2 size={15} /> Supprimer</button>}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" onClick={submit}>Enregistrer</button>
      </>}
    >
      <form className="form" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label className="full">Action<input autoFocus value={t.name} onChange={e => set({ name: e.target.value })} placeholder="Ex. Relancer Dominique pour le bon de commande" /></label>
        <label className="full">Sujet<SubjectSelect value={t.subject_id} onChange={v => set({ subject_id: v })} /></label>
        <label>Statut<select value={t.status} onChange={e => set({ status: e.target.value })}>{TASK_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Priorité<select value={t.priority} onChange={e => set({ priority: e.target.value })}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></label>
        <label>Interlocuteur<input value={t.owner} onChange={e => set({ owner: e.target.value })} placeholder="À clarifier" /></label>
        <label>Échéance<input type="date" value={t.due_date ?? ''} onChange={e => set({ due_date: e.target.value || null })} /></label>
        <button hidden />
      </form>
    </Modal>
  );
}

function EventEditor({ initial, isNew, onClose }: { initial: CalEvent; isNew: boolean; onClose: () => void }) {
  const { saveEvent, deleteEvent, toast, subject } = useStore();
  const [e, setE] = useState(initial);
  const set = (p: Partial<CalEvent>) => setE(x => ({ ...x, ...p }));
  const submit = () => {
    if (!e.name.trim() || !e.date) return toast('Nom et date obligatoires', 'error');
    if (e.start_time && e.end_time && e.end_time < e.start_time) return toast('La fin doit être après le début', 'error');
    saveEvent({ ...e, name: e.name.trim() });
    toast(isNew ? 'Événement ajouté' : 'Événement enregistré');
    onClose();
  };
  return (
    <Modal
      title={isNew ? 'Nouvel événement' : "Modifier l'événement"}
      accent={subject(e.subject_id)?.color}
      onClose={onClose}
      footer={<>
        {!isNew && <button className="btn danger ghost" onClick={() => { if (confirm('Supprimer cet événement ?')) { deleteEvent(e.id); toast('Événement supprimé'); onClose(); } }}><Trash2 size={15} /> Supprimer</button>}
        {!isNew && e.subject_id && <button className="btn ghost" onClick={() => { onClose(); go('sujets/' + e.subject_id); }}>Ouvrir le sujet</button>}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" onClick={submit}>Enregistrer</button>
      </>}
    >
      <form className="form" onSubmit={ev => { ev.preventDefault(); submit(); }}>
        <label className="full">Intitulé<input autoFocus value={e.name} onChange={ev => set({ name: ev.target.value })} /></label>
        <label>Date<input type="date" value={e.date} onChange={ev => set({ date: ev.target.value })} /></label>
        {features.eventTimes ? (
          <div className="time-pair">
            <label>Début<input type="time" value={e.start_time ?? ''} onChange={ev => set({ start_time: ev.target.value || null })} /></label>
            <label>Fin<input type="time" value={e.end_time ?? ''} onChange={ev => set({ end_time: ev.target.value || null })} /></label>
          </div>
        ) : <p className="hint full">Pour ajouter des heures, exécute la dernière version de <code>supabase/schema.sql</code>.</p>}
        <label>Type<input list="event-kinds" value={e.kind} onChange={ev => set({ kind: ev.target.value })} />
          <datalist id="event-kinds">{EVENT_KINDS.map(k => <option key={k} value={k} />)}</datalist>
        </label>
        <label className="full">Sujet<SubjectSelect value={e.subject_id} onChange={v => set({ subject_id: v })} /></label>
        <button hidden />
      </form>
    </Modal>
  );
}

function SubjectCreator({ initial, onClose }: { initial: Subject; onClose: () => void }) {
  const { saveSubject, toast, db } = useStore();
  const [s, setS] = useState(initial);
  const set = (p: Partial<Subject>) => setS(x => ({ ...x, ...p }));
  const categories = [...new Set(db.subjects.map(x => x.category).filter(Boolean))];
  const submit = () => {
    if (!s.name.trim()) return toast('Donne un nom au sujet', 'error');
    saveSubject({ ...s, name: s.name.trim() });
    toast('Sujet créé');
    onClose();
    go('sujets/' + s.id);
  };
  return (
    <Modal title="Nouveau sujet" accent={s.color} onClose={onClose} footer={<>
      <span className="grow" />
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn primary" onClick={submit}>Créer le sujet</button>
    </>}>
      <form className="form" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label className="full">Nom<input autoFocus value={s.name} onChange={e => set({ name: e.target.value })} /></label>
        <label>Catégorie<input list="cats" value={s.category} onChange={e => set({ category: e.target.value })} />
          <datalist id="cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
        </label>
        <label>Statut<select value={s.status} onChange={e => set({ status: e.target.value })}>{SUBJECT_STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="full">Résumé<textarea value={s.summary} onChange={e => set({ summary: e.target.value })} /></label>
        <div className="full">
          <span className="label">Couleur</span>
          <ColorPicker value={s.color} onChange={color => set({ color })} />
        </div>
        <button hidden />
      </form>
    </Modal>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches">
      {PALETTE.map(c => (
        <button type="button" key={c} className={`swatch ${c === value ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
    </div>
  );
}
