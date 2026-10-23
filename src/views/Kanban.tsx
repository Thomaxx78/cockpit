import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, User } from 'lucide-react';
import { useEditors } from '../components/editors';
import { DueBadge } from '../components/TaskRow';
import { Prio, SubjectFilter, SubjectTag } from '../components/ui';
import { useStore } from '../lib/store';
import { isActive, TASK_STATUSES, type Task } from '../lib/types';
import { statusClass } from '../lib/utils';

type Cols = Record<string, string[]>;

function Card({ t, overlay }: { t: Task; overlay?: boolean }) {
  const { subject } = useStore();
  return (
    <div className={`kcard ${overlay ? 'overlay' : ''} ${t.status === 'Terminé' ? 'is-done' : ''}`} style={{ ['--c' as string]: subject(t.subject_id)?.color }}>
      <div className="kcard-top"><SubjectTag id={t.subject_id} /><Prio p={t.priority} /></div>
      <div className="kcard-name">{t.name}</div>
      <div className="meta">
        {t.owner && <span className="meta-item"><User size={12} /> {t.owner}</span>}
        <DueBadge date={t.due_date} done={!isActive(t.status)} />
      </div>
    </div>
  );
}

function SortableCard({ t }: { t: Task }) {
  const { editTask } = useEditors();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
      onClick={() => editTask(t)}
    >
      <Card t={t} />
    </div>
  );
}

function Column({ status, ids, byId }: { status: string; ids: string[]; byId: Map<string, Task> }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const { editTask } = useEditors();
  return (
    <section id={'kcol-' + statusClass(status)} className={`kcol ${isOver ? 'over' : ''}`} aria-label={`Colonne ${status}, ${ids.length} carte${ids.length > 1 ? 's' : ''}`}>
      <header className="kcol-head">
        <span className={`kcol-dot ${statusClass(status)}`} />
        {status}
        <span className="count">{ids.length}</span>
      </header>
      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="kcol-body">
          {ids.map(id => byId.get(id) && <SortableCard key={id} t={byId.get(id)!} />)}
          <button className="kadd" onClick={() => editTask(null, { status })}><Plus size={15} /> Ajouter</button>
        </div>
      </SortableContext>
    </section>
  );
}

export function Kanban() {
  const { db, moveTask } = useStore();
  const [filter, setFilter] = useState('all');
  const [drag, setDrag] = useState<Cols | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Sur téléphone, on arrive sur « À faire » : le backlog (souvent vide) reste à gauche, accessible en glissant.
  useLayoutEffect(() => {
    const board = boardRef.current;
    const todo = document.getElementById('kcol-todo');
    if (board && todo && board.scrollWidth > board.clientWidth) board.scrollLeft = todo.offsetLeft - board.offsetLeft - 16;
  }, []);

  const byId = useMemo(() => new Map(db.tasks.map(t => [t.id, t])), [db.tasks]);
  const base = useMemo<Cols>(() => {
    const cols: Cols = Object.fromEntries(TASK_STATUSES.map(s => [s, []]));
    [...db.tasks]
      .filter(t => filter === 'all' || t.subject_id === filter)
      .sort((a, b) => a.position - b.position)
      .forEach(t => (cols[t.status] ?? cols['À faire']).push(t.id));
    return cols;
  }, [db.tasks, filter]);
  const cols = drag ?? base;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const containerOf = (c: Cols, id: string) => (id in c ? id : Object.keys(c).find(k => c[k].includes(id)));

  const onStart = (e: DragStartEvent) => { setActiveId(String(e.active.id)); setDrag(base); };

  const onOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDrag(c => {
      if (!c) return c;
      const from = containerOf(c, String(active.id));
      const to = containerOf(c, String(over.id));
      if (!from || !to || from === to) return c;
      const dest = c[to];
      const overIdx = dest.indexOf(String(over.id));
      const idx = overIdx < 0 ? dest.length : overIdx;
      return {
        ...c,
        [from]: c[from].filter(x => x !== active.id),
        [to]: [...dest.slice(0, idx), String(active.id), ...dest.slice(idx)],
      };
    });
  };

  const onEnd = ({ active, over }: DragEndEvent) => {
    const c = drag;
    setActiveId(null);
    setDrag(null);
    if (!c || !over) return;
    const id = String(active.id);
    const to = containerOf(c, id)!;
    let list = c[to];
    const overIdx = list.indexOf(String(over.id));
    const curIdx = list.indexOf(id);
    if (overIdx >= 0 && overIdx !== curIdx) list = arrayMove(list, curIdx, overIdx);
    const i = list.indexOf(id);
    const prev = byId.get(list[i - 1])?.position;
    const next = byId.get(list[i + 1])?.position;
    const pos = prev !== undefined && next !== undefined ? (prev + next) / 2 : prev !== undefined ? prev + 1 : next !== undefined ? next - 1 : 0;
    moveTask(id, to, pos);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Avancement des actions</h2>
          <p className="hint">Glisse les cartes entre colonnes. Chaque couleur correspond à un sujet — clique une puce pour filtrer.</p>
        </div>
      </div>
      <SubjectFilter value={filter} onChange={setFilter} />
      <nav className="kcol-tabs" aria-label="Colonnes">
        {TASK_STATUSES.map(s => (
          <button key={s} onClick={() => document.getElementById('kcol-' + statusClass(s))?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })}>
            <span className={`kcol-dot ${statusClass(s)}`} />{s}<b>{cols[s].length}</b>
          </button>
        ))}
      </nav>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onStart}
        onDragOver={onOver}
        onDragEnd={onEnd}
        onDragCancel={() => { setDrag(null); setActiveId(null); }}
      >
        <div className="kanban" ref={boardRef}>
          {TASK_STATUSES.map(s => <Column key={s} status={s} ids={cols[s]} byId={byId} />)}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {activeId && byId.get(activeId) ? <Card t={byId.get(activeId)!} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
