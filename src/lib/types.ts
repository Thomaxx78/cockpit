export type Subject = {
  id: string;
  name: string;
  category: string;
  status: string;
  summary: string;
  confirmed: string;
  hypothesis: string;
  questions: string;
  people: string;
  next_step: string;
  due_date: string | null;
  origin: string;
  color: string;
  notes: string;
  position: number;
};

export type Task = {
  id: string;
  name: string;
  subject_id: string | null;
  status: string;
  priority: string;
  owner: string;
  due_date: string | null;
  position: number;
};

export type CalEvent = {
  id: string;
  date: string;
  name: string;
  subject_id: string | null;
  kind: string;
  start_time: string | null;
  end_time: string | null;
  /** Notes de la réunion (importées d'Outlook ou saisies à la main). */
  description?: string;
};

/** Entrée du journal d'historique (table public.activity, ou localStorage en mode local). */
export type Activity = {
  id: number;
  /** Horodatage ISO (timestamptz). */
  at: string;
  entity: 'task' | 'subject' | 'event';
  entity_id: string;
  /** Sujet concerné : le sujet lui-même, ou le sujet de l'action. */
  subject_id: string | null;
  kind: 'created' | 'status' | 'deleted';
  /** Nom de l'élément au moment du changement. */
  label: string;
  from_status: string | null;
  to_status: string | null;
};

export type DB = { subjects: Subject[]; tasks: Task[]; events: CalEvent[] };
export type Table = keyof DB;
export type Row<T extends Table> = DB[T][number];

export const TASK_STATUSES = ['Backlog', 'À faire', 'En cours', 'En attente', 'Terminé'] as const;
/** Action à traiter : ni terminée, ni mise de côté dans le backlog. */
export const isActive = (status: string) => status !== 'Terminé' && status !== 'Backlog';
/** Types d'événements qui ne sont pas des réunions (dates théoriques, échéances, cours). */
export const NOT_MEETING = ['Échéance', 'Hypothèse', 'Récurrence théorique', 'Cours'];
/** Réunion passée : jour écoulé, ou aujourd'hui et déjà commencée. `today` au format AAAA-MM-JJ (heure locale). */
export function isPastMeeting(e: CalEvent, today: string) {
  if (NOT_MEETING.includes(e.kind) || e.date > today) return false;
  if (e.date < today || !e.start_time) return true;
  const now = new Date();
  return e.start_time.slice(0, 5) <= `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
export const SUBJECT_STATUSES =['À cadrer', 'À faire', 'En cours', 'En attente', 'Terminé'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3'] as const;
export const PRIO_LABELS: Record<string, string> = { P1: 'P1 — Urgent', P2: 'P2 — Normal', P3: 'P3 — Plus tard' };
export const EVENT_KINDS = ['Événement', 'Action', 'Échéance', 'Hypothèse', 'Récurrence théorique', 'Rendez-vous'];
export const PALETTE = ['#8b5cf6', '#2563eb', '#0d9488', '#0369a1', '#db2777', '#64748b', '#0891b2', '#65a30d', '#a16207', '#7c3aed', '#4f46e5', '#059669'];
