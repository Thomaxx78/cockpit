import { useState } from 'react';
import { Download, Plus, Search, X } from 'lucide-react';
import { useEditors } from '../components/editors';
import { TaskRow } from '../components/TaskRow';
import { Empty } from '../components/ui';
import { useStore } from '../lib/store';
import { isActive, PRIORITIES, type Task } from '../lib/types';
import { daysFrom, download } from '../lib/utils';

const VIEWS = ['Ouvertes', 'Backlog', 'Terminées', 'Toutes'] as const;
const OPEN_STATUSES = ['À faire', 'En cours', 'En attente'];

/** Regroupe les actions ouvertes par horizon d'échéance. */
const GROUPS: [string, (t: Task) => boolean, string?][] = [
  ['En retard', t => !!t.due_date && daysFrom(t.due_date) < 0, 'late'],
  ['Cette semaine', t => !!t.due_date && daysFrom(t.due_date) >= 0 && daysFrom(t.due_date) <= 7],
  ['Plus tard', t => !!t.due_date && daysFrom(t.due_date) > 7],
  ['Sans date', t => !t.due_date],
];

export function Actions() {
  const { db, subject } = useStore();
  const { editTask } = useEditors();
  const [subj, setSubj] = useState('all');
  const [view, setView] = useState<(typeof VIEWS)[number]>('Ouvertes');
  const [status, setStatus] = useState('all');
  const [prio, setPrio] = useState('all');
  const [q, setQ] = useState('');
  const activeFilters = [q.trim(), subj !== 'all', prio !== 'all', status !== 'all'].filter(Boolean).length;
  const reset = () => { setQ(''); setSubj('all'); setPrio('all'); setStatus('all'); };

  const inView = (t: Task) =>
    view === 'Toutes' ? true
    : view === 'Ouvertes' ? isActive(t.status) && (status === 'all' || t.status === status)
    : view === 'Backlog' ? t.status === 'Backlog'
    : t.status === 'Terminé';

  const needle = q.trim().toLowerCase();
  const list = db.tasks
    .filter(t =>
      (subj === 'all' || (subj === 'none' ? !t.subject_id : t.subject_id === subj)) &&
      inView(t) &&
      (prio === 'all' || t.priority === prio) &&
      (!needle || `${t.name} ${t.owner} ${subject(t.subject_id)?.name ?? ''}`.toLowerCase().includes(needle)))
    .sort((a, b) => Number(a.status === 'Terminé') - Number(b.status === 'Terminé') || a.priority.localeCompare(b.priority) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const open = db.tasks.filter(t => isActive(t.status)).length;

  const exportCSV = () => {
    const rows = [['Action', 'Sujet', 'Statut', 'Priorité recommandée', 'Interlocuteur', 'Échéance'],
      ...db.tasks.map(t => [t.name, subject(t.subject_id)?.name ?? '', t.status, t.priority, t.owner, t.due_date ?? ''])];
    const csv = '﻿' + rows.map(r => r.map(x => '"' + String(x).replaceAll('"', '""') + '"').join(';')).join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'sapaudia-actions.csv');
  };

  const rows = (ts: Task[]) => ts.map(t => <TaskRow key={t.id} t={t} showStatus={view !== 'Terminées' && view !== 'Backlog'} />);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Actions</h2>
          <p className="hint">{open} ouverte{open > 1 ? 's' : ''}</p>
        </div>
        <div className="row-gap">
          <button className="btn ghost" onClick={exportCSV} title="Exporter en CSV"><Download size={16} /> CSV</button>
          <button className="btn" onClick={() => editTask(null, subj !== 'all' && subj !== 'none' ? { subject_id: subj } : {})}><Plus size={16} /> Nouvelle action</button>
        </div>
      </div>

      <div className="segmented">
        {VIEWS.map(v => <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}
      </div>

      <div className="filters" role="search" aria-label="Filtrer les actions">
        <label className="search filter-search">
          <Search size={16} />
          <input aria-label="Rechercher une action" placeholder="Rechercher…" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <select aria-label="Sujet" className={subj !== 'all' ? 'on' : ''} value={subj} onChange={e => setSubj(e.target.value)}>
          <option value="all">Tous les sujets</option>
          {db.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="none">Sans sujet</option>
        </select>
        {view === 'Ouvertes' && (
          <select aria-label="Statut" className={status !== 'all' ? 'on' : ''} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">Statut</option>
            {OPEN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select aria-label="Priorité" className={prio !== 'all' ? 'on' : ''} value={prio} onChange={e => setPrio(e.target.value)}>
          <option value="all">Priorité</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {activeFilters > 0 && <button className="btn ghost filter-reset" onClick={reset}><X size={15} /> Effacer ({activeFilters})</button>}
      </div>

      <section className="panel flush">
        {!list.length ? <Empty>Aucune action dans cette vue.</Empty>
          : view === 'Ouvertes' ? GROUPS.map(([label, match, tone]) => {
            const ts = list.filter(match);
            return ts.length ? (
              <div key={label} className="group">
                <h4 className={`group-title ${tone ?? ''}`}>{label} <span>{ts.length}</span></h4>
                {rows(ts)}
              </div>
            ) : null;
          })
          : rows(list)}
      </section>
    </div>
  );
}
