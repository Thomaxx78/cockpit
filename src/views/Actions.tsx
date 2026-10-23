import { useState } from 'react';
import { Download, Plus, Search } from 'lucide-react';
import { useEditors } from '../components/editors';
import { TaskRow } from '../components/TaskRow';
import { Empty, SubjectFilter } from '../components/ui';
import { useStore } from '../lib/store';
import { isActive, PRIORITIES, TASK_STATUSES } from '../lib/types';
import { download } from '../lib/utils';

const VIEWS = ['Ouvertes', ...TASK_STATUSES, 'Toutes'] as const;

export function Actions() {
  const { db, subject } = useStore();
  const { editTask } = useEditors();
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState<(typeof VIEWS)[number]>('Ouvertes');
  const [prio, setPrio] = useState('Toutes');
  const [q, setQ] = useState('');

  const needle = q.toLowerCase();
  const list = db.tasks
    .filter(t =>
      (filter === 'all' || t.subject_id === filter) &&
      (view === 'Toutes' || (view === 'Ouvertes' ? isActive(t.status) : t.status === view)) &&
      (prio === 'Toutes' || t.priority === prio) &&
      `${t.name} ${t.owner}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(a.status === 'Terminé') - Number(b.status === 'Terminé') || a.priority.localeCompare(b.priority) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const open = db.tasks.filter(t => isActive(t.status)).length;

  const exportCSV = () => {
    const rows = [['Action', 'Sujet', 'Statut', 'Priorité recommandée', 'Interlocuteur', 'Échéance'],
      ...db.tasks.map(t => [t.name, subject(t.subject_id)?.name ?? '', t.status, t.priority, t.owner, t.due_date ?? ''])];
    const csv = '﻿' + rows.map(r => r.map(x => '"' + String(x).replaceAll('"', '""') + '"').join(';')).join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'sapaudia-actions.csv');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Plan d’action</h2>
          <p className="hint">{open} actions ouvertes sur {db.tasks.length} · coche pour terminer, clique pour modifier.</p>
        </div>
        <div className="row-gap">
          <button className="btn" onClick={exportCSV}><Download size={16} /> CSV</button>
          <button className="btn primary" onClick={() => editTask(null, filter !== 'all' ? { subject_id: filter } : {})}><Plus size={16} /> Nouvelle action</button>
        </div>
      </div>

      <SubjectFilter value={filter} onChange={setFilter} />

      <div className="toolbar">
        <div className="segmented">
          {VIEWS.map(v => <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}
        </div>
        <select aria-label="Priorité" value={prio} onChange={e => setPrio(e.target.value)}><option value="Toutes">Toutes priorités</option>{PRIORITIES.map(p => <option key={p} value={p}>Priorité {p}</option>)}</select>
        <label className="search"><Search size={16} /><input aria-label="Rechercher une action" placeholder="Rechercher…" value={q} onChange={e => setQ(e.target.value)} /></label>
      </div>

      <section className="panel flush">
        {list.length ? list.map(t => <TaskRow key={t.id} t={t} showStatus />) : <Empty>Aucune action dans cette vue.</Empty>}
      </section>
    </div>
  );
}
