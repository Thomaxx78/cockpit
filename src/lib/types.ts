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
};

export type DB = { subjects: Subject[]; tasks: Task[]; events: CalEvent[] };
export type Table = keyof DB;
export type Row<T extends Table> = DB[T][number];

export const TASK_STATUSES = ['À faire', 'En cours', 'En attente', 'Terminé'] as const;
export const SUBJECT_STATUSES = ['À cadrer', 'À faire', 'En cours', 'En attente', 'Terminé'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3'] as const;
export const EVENT_KINDS = ['Événement', 'Action', 'Échéance', 'Hypothèse', 'Récurrence théorique', 'Rendez-vous'];
export const PALETTE = ['#8b5cf6', '#2563eb', '#0d9488', '#ea580c', '#db2777', '#64748b', '#0891b2', '#65a30d', '#a16207', '#dc2626', '#4f46e5', '#059669'];
