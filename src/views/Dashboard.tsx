import { ArrowRight, CircleDot, Compass, FolderKanban, GraduationCap, ListChecks, Plus, TriangleAlert } from 'lucide-react';
import { useEditors } from '../components/editors';
import { TaskRow } from '../components/TaskRow';
import { Dot, Empty, Pill } from '../components/ui';
import { useStore } from '../lib/store';
import { dayMonth, daysFrom, fmtShort, go, relative, timeRange, todayIso } from '../lib/utils';

const prioRank = (p: string) => ({ P1: 0, P2: 1, P3: 2 } as Record<string, number>)[p] ?? 3;

export function Dashboard() {
  const { db, subject } = useStore();
  const { editTask } = useEditors();
  const today = todayIso();
  const open = db.tasks.filter(t => t.status !== 'Terminé');
  const late = open.filter(t => t.due_date && t.due_date < today);
  const next = [...open].sort((a, b) =>
    prioRank(a.priority) - prioRank(b.priority) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.position - b.position,
  ).slice(0, 7);

  const future = db.events.filter(e => e.date >= today).sort((a, b) => (a.date + (a.start_time ?? '')).localeCompare(b.date + (b.start_time ?? '')));
  // Les jours de cours sont résumés à part pour ne pas noyer les échéances.
  const upcoming = future.filter(e => e.kind !== 'Cours').slice(0, 7);
  const nextCourses = (() => {
    const first = future.find(e => e.kind === 'Cours');
    if (!first) return null;
    const block = [first];
    for (const e of future.filter(x => x.kind === 'Cours' && x.date > first.date)) {
      if (daysFrom(e.date) - daysFrom(block.at(-1)!.date) > 3) break;
      block.push(e);
    }
    return { from: block[0].date, to: block.at(-1)!.date, count: block.length };
  })();

  const progress = (id: string) => {
    const ts = db.tasks.filter(t => t.subject_id === id);
    return { done: ts.filter(t => t.status === 'Terminé').length, total: ts.length };
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Votre espace de pilotage IA</h2>
          <p className="hint">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Vue consolidée issue de la réunion Direction du 21 octobre 2026.</p>
        </div>
        <button className="btn primary" onClick={() => editTask(null)}><Plus size={16} /> Nouvelle action</button>
      </div>

      <div className="stats">
        <button className="stat" onClick={() => go('sujets')}>
          <span className="stat-ico"><FolderKanban size={18} /></span>
          <span className="stat-label">Sujets suivis</span>
          <span className="stat-num">{db.subjects.length}</span>
          <span className="stat-sub">Tous types de sujets</span>
        </button>
        <button className="stat" onClick={() => go('actions')}>
          <span className="stat-ico"><ListChecks size={18} /></span>
          <span className="stat-label">Actions ouvertes</span>
          <span className="stat-num">{open.length}</span>
          <span className="stat-sub">{open.filter(t => t.priority === 'P1').length} recommandées P1{late.length > 0 && <b className="late-text"> · {late.length} en retard</b>}</span>
        </button>
        <button className="stat" onClick={() => go('sujets?statut=En cours')}>
          <span className="stat-ico"><CircleDot size={18} /></span>
          <span className="stat-label">Dossiers en cours</span>
          <span className="stat-num">{db.subjects.filter(s => s.status === 'En cours').length}</span>
          <span className="stat-sub">Statuts issus des notes</span>
        </button>
        <button className="stat" onClick={() => go('sujets?statut=À cadrer')}>
          <span className="stat-ico warn"><TriangleAlert size={18} /></span>
          <span className="stat-label">À clarifier</span>
          <span className="stat-num">{db.subjects.filter(s => s.status === 'À cadrer').length}</span>
          <span className="stat-sub">Sujets au périmètre incertain</span>
        </button>
      </div>

      <div className="notice">
        Les niveaux P1/P2/P3 sont des recommandations de priorisation, pas des décisions de la Direction. La date Edison au 1er décembre est un repère visuel pour « début décembre », non une échéance au jour près.
      </div>

      <div className="grid-2">
        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h3>Prochaines actions</h3>
              <button className="link" onClick={() => go('actions')}>Toutes les actions <ArrowRight size={14} /></button>
            </div>
            {next.length ? next.map(t => <TaskRow key={t.id} t={t} />) : <Empty>Tout est fait 🎉</Empty>}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Dossiers à suivre</h3>
              <button className="link" onClick={() => go('sujets')}>Tous les sujets <ArrowRight size={14} /></button>
            </div>
            {db.subjects.map(s => {
              const p = progress(s.id);
              return (
                <button key={s.id} className="subject-row" style={{ ['--c' as string]: s.color }} onClick={() => go('sujets/' + s.id)}>
                  <Dot color={s.color} size={10} />
                  <span className="subject-row-main">
                    <span className="row-title">{s.name}</span>
                    <span className="meta">{s.category} · {s.next_step || 'Prochaine étape à définir'}</span>
                  </span>
                  {p.total > 0 && (
                    <span className="mini-progress" title={`${p.done}/${p.total} actions terminées`}>
                      <span style={{ width: `${(p.done / p.total) * 100}%` }} />
                    </span>
                  )}
                  <Pill status={s.status} />
                </button>
              );
            })}
          </section>
        </div>

        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h3>Dates repères</h3>
              <button className="link" onClick={() => go('calendrier')}>Calendrier <ArrowRight size={14} /></button>
            </div>
            {upcoming.length ? upcoming.map(e => {
              const d = dayMonth(e.date);
              const s = subject(e.subject_id);
              return (
                <button key={e.id} className="date-row" style={{ ['--c' as string]: s?.color }} onClick={() => go(s ? 'sujets/' + s.id : 'calendrier')}>
                  <span className="datebox"><b>{d.day}</b><small>{d.month}</small></span>
                  <span className="subject-row-main">
                    <span className="row-title">{e.name}</span>
                    <span className="meta">{e.start_time && `${timeRange(e.start_time, e.end_time)} · `}{e.kind} · {relative(e.date)}</span>
                  </span>
                </button>
              );
            }) : <Empty>Aucune date à venir.</Empty>}
            {nextCourses && (
              <button className="courses-next" style={{ ['--c' as string]: subject('cours')?.color }} onClick={() => go('calendrier')}>
                <GraduationCap size={16} />
                <span>Prochains cours : <b>{fmtShort(nextCourses.from)}{nextCourses.count > 1 && ` → ${fmtShort(nextCourses.to)}`}</b> · {relative(nextCourses.from)}</span>
              </button>
            )}
          </section>

          <section className="panel vision">
            <h3><Compass size={17} /> Vision stratégique</h3>
            <p>Développer le positionnement de Sapaudia comme opérateur de solutions IA. Les références citées sont Limova, Edison IA et Lumina.ai — leur rôle exact reste à qualifier.</p>
            {subject('strategy') && <button className="btn" onClick={() => go('sujets/strategy')}>Ouvrir la fiche stratégie <ArrowRight size={14} /></button>}
          </section>
        </div>
      </div>
    </div>
  );
}
