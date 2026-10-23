import { useState } from 'react';
import { CalendarDays, ListChecks, Plus, Search, User } from 'lucide-react';
import { useEditors } from '../components/editors';
import { Empty, Pill } from '../components/ui';
import { useStore } from '../lib/store';
import { SUBJECT_STATUSES } from '../lib/types';
import { fmtDate, go } from '../lib/utils';

export function Subjects({ initialStatus }: { initialStatus?: string }) {
  const { db } = useStore();
  const { newSubject } = useEditors();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Toutes');
  const [status, setStatus] = useState(initialStatus || 'Tous');
  const cats = [...new Set(db.subjects.map(s => s.category).filter(Boolean))];
  const needle = q.toLowerCase();
  const items = db.subjects.filter(s =>
    (cat === 'Toutes' || s.category === cat) &&
    (status === 'Tous' || s.status === status) &&
    `${s.name} ${s.summary} ${s.people} ${s.category}`.toLowerCase().includes(needle),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Portefeuille des sujets</h2>
          <p className="hint">Dossiers IA, benchmarks, stratégie, rendez-vous et opérations.</p>
        </div>
        <button className="btn primary" onClick={newSubject}><Plus size={16} /> Nouveau sujet</button>
      </div>

      <div className="toolbar">
        <label className="search"><Search size={16} /><input aria-label="Rechercher un sujet" placeholder="Rechercher un sujet, une personne…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <select aria-label="Catégorie" value={cat} onChange={e => setCat(e.target.value)}><option>Toutes</option>{cats.map(c => <option key={c}>{c}</option>)}</select>
        <select aria-label="Statut" value={status} onChange={e => setStatus(e.target.value)}><option>Tous</option>{SUBJECT_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
      </div>

      {items.length ? (
        <div className="cards">
          {items.map(s => {
            const ts = db.tasks.filter(t => t.subject_id === s.id);
            const done = ts.filter(t => t.status === 'Terminé').length;
            return (
              <button key={s.id} className="card" style={{ ['--c' as string]: s.color }} onClick={() => go('sujets/' + s.id)}>
                <span className="card-top">
                  <span className="category">{s.category || 'Sans catégorie'}</span>
                  <Pill status={s.status} />
                </span>
                <span className="card-title">{s.name}</span>
                <span className="card-text">{s.summary}</span>
                {ts.length > 0 && <span className="progress"><span style={{ width: `${(done / ts.length) * 100}%` }} /></span>}
                <span className="card-foot">
                  <span className="meta-item"><User size={12} /> {s.people.split(';')[0] || '—'}</span>
                  <span className="meta-item"><ListChecks size={12} /> {done}/{ts.length}</span>
                  <span className="meta-item"><CalendarDays size={12} /> {fmtDate(s.due_date, 'À clarifier')}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : <Empty>Aucun sujet ne correspond aux filtres.</Empty>}
    </div>
  );
}
