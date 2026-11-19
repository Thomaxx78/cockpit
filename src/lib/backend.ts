import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Activity, DB, Note, Row, Table } from './types';
import { SEED } from './seed';

export type Change = { table: Table; type: 'upsert' | 'delete'; row: { id: string } & Record<string, unknown> };

export interface Backend {
  kind: 'supabase' | 'local';
  load(): Promise<DB>;
  upsert<T extends Table>(table: T, rows: Row<T>[]): Promise<void>;
  remove(table: Table, id: string): Promise<void>;
  subscribe(cb: (c: Change) => void): () => void;
  /** Historique depuis la date donnée (ISO), du plus récent au plus ancien. Jamais d'erreur : [] si indisponible. */
  loadActivity(sinceIso: string): Promise<Activity[]>;
  /** Nouvelles entrées d'historique (temps réel en Supabase, écritures locales sinon). */
  subscribeActivity(cb: (a: Activity) => void): () => void;
}

/** Identifiants d'un élément et de tout ce qu'il contient (suppression d'un dossier). */
export function noteDescendants(notes: Note[], id: string) {
  const ids = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of notes) if (n.parent_id && ids.has(n.parent_id) && !ids.has(n.id)) { ids.add(n.id); grew = true; }
  }
  return ids;
}

/** Nombre maximal d'entrées d'historique chargées / conservées. */
export const ACTIVITY_LIMIT = 2000;

const toActivity = (r: Record<string, unknown>): Activity => ({
  id: Number(r.id),
  at: String(r.at),
  entity: r.entity as Activity['entity'],
  entity_id: String(r.entity_id ?? ''),
  subject_id: (r.subject_id as string | null) ?? null,
  kind: r.kind as Activity['kind'],
  label: String(r.label ?? ''),
  from_status: (r.from_status as string | null) ?? null,
  to_status: (r.to_status as string | null) ?? null,
});

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

const TABLES: Table[] = ['subjects', 'tasks', 'events'];

/** Garde uniquement les colonnes connues (évite d'envoyer des champs parasites). */
const COLUMNS: Record<Table, string[]> = {
  subjects: ['id', 'name', 'category', 'status', 'summary', 'confirmed', 'hypothesis', 'questions', 'people', 'next_step', 'due_date', 'origin', 'color', 'notes', 'position'],
  tasks: ['id', 'name', 'subject_id', 'status', 'priority', 'owner', 'due_date', 'position'],
  events: ['id', 'date', 'name', 'subject_id', 'kind', 'start_time', 'end_time', 'description'],
  notes: ['id', 'parent_id', 'kind', 'name', 'content', 'task_id', 'event_id', 'pinned', 'position', 'updated_at'],
};
const TEXT_DEFAULTS: Record<string, string | boolean> = { description: '', content: '', pinned: false };
const NULLABLE = ['due_date', 'subject_id', 'start_time', 'end_time', 'parent_id', 'task_id', 'event_id', 'updated_at'];
/** Colonnes ajoutées aux notes après leur création (bases où schema.sql n'a pas été relancé). */
const NOTE_V2 = ['event_id', 'pinned'];
const TIME_COLUMNS = ['start_time', 'end_time'];

/** Faux tant que la migration des heures (supabase/schema.sql) n'a pas été exécutée. */
export const features = { eventTimes: true, eventDescription: true, notes: true, notesV2: true };

export function clean<T extends Table>(table: T, row: Record<string, unknown>): Row<T> {
  const out: Record<string, unknown> = {};
  for (const c of COLUMNS[table]) {
    let v = row[c] === '' && NULLABLE.includes(c) ? null : row[c] ?? TEXT_DEFAULTS[c] ?? null;
    if (TIME_COLUMNS.includes(c) && typeof v === 'string') v = v.slice(0, 5); // "15:30:00" → "15:30"
    out[c] = v;
  }
  return out as Row<T>;
}

const forDb = (table: Table, row: Record<string, unknown>) => {
  const r = clean(table, row) as Record<string, unknown>;
  if (table === 'events' && !features.eventTimes) for (const c of TIME_COLUMNS) delete r[c];
  if (table === 'events' && !features.eventDescription) delete r.description;
  if (table === 'notes' && !features.notesV2) for (const c of NOTE_V2) delete r[c];
  return r;
};

function supabaseBackend(sb: SupabaseClient): Backend {
  return {
    kind: 'supabase',
    async load() {
      const [s, t, e, n] = await Promise.all([
        sb.from('subjects').select('*').order('position'),
        sb.from('tasks').select('*').order('position'),
        sb.from('events').select('*').order('date'),
        sb.from('notes').select('*').order('position'),
      ]);
      // Table des notes absente tant que supabase/schema.sql n'a pas été relancé : le reste fonctionne.
      features.notes = !n.error;
      if (n.error) console.warn('Notes indisponibles :', n.error.message);
      if (n.data?.length && !('pinned' in n.data[0])) features.notesV2 = false;
      const err = s.error || t.error || e.error;
      if (err) throw err;
      if (e.data!.length && !('start_time' in e.data![0])) features.eventTimes = false;
      if (e.data!.length && !('description' in e.data![0])) features.eventDescription = false;
      return {
        subjects: s.data!.map(r => clean('subjects', r)),
        tasks: t.data!.map(r => clean('tasks', r)),
        events: e.data!.map(r => clean('events', r)),
        notes: (n.data ?? []).map(r => clean('notes', r)),
      };
    },
    async upsert(table, rows) {
      if (!rows.length) return;
      let { error } = await sb.from(table).upsert(rows.map(r => forDb(table, r)));
      if (error && table === 'events' && features.eventTimes && /start_time|end_time/.test(error.message)) {
        features.eventTimes = false; // colonnes absentes : on réessaie sans les heures
        ({ error } = await sb.from(table).upsert(rows.map(r => forDb(table, r))));
      }
      if (error && table === 'events' && features.eventDescription && /description/.test(error.message)) {
        features.eventDescription = false; // colonne absente : on réessaie sans la description
        ({ error } = await sb.from(table).upsert(rows.map(r => forDb(table, r))));
      }
      if (error && table === 'notes' && features.notesV2 && /event_id|pinned/.test(error.message)) {
        features.notesV2 = false; // colonnes absentes : on réessaie sans (épingle et lien réunion non enregistrés)
        ({ error } = await sb.from(table).upsert(rows.map(r => forDb(table, r))));
      }
      if (error) throw error;
    },
    async remove(table, id) {
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) throw error;
    },
    subscribe(cb) {
      const ch = sb.channel('cockpit');
      for (const table of TABLES) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, p => {
          if (p.eventType === 'DELETE') cb({ table, type: 'delete', row: p.old as Change['row'] });
          else cb({ table, type: 'upsert', row: clean(table, p.new) as Change['row'] });
        });
      }
      ch.subscribe();
      // Canal séparé pour les notes : une table absente ne gêne pas la synchronisation principale.
      const chNotes = sb.channel('cockpit-notes');
      chNotes.on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, p => {
        if (p.eventType === 'DELETE') cb({ table: 'notes', type: 'delete', row: p.old as Change['row'] });
        else cb({ table: 'notes', type: 'upsert', row: clean('notes', p.new) as Change['row'] });
      });
      chNotes.subscribe();
      return () => { sb.removeChannel(ch); sb.removeChannel(chNotes); };
    },
    async loadActivity(sinceIso) {
      try {
        const { data, error } = await sb.from('activity').select('*').gte('at', sinceIso).order('at', { ascending: false }).limit(ACTIVITY_LIMIT);
        // Table absente tant que supabase/schema.sql n'a pas été relancé : l'appli continue sans historique.
        if (error) { console.warn('Historique indisponible :', error.message); return []; }
        return (data ?? []).map(toActivity);
      } catch {
        return [];
      }
    },
    subscribeActivity(cb) {
      // Canal séparé : une table absente ne gêne pas la synchronisation principale.
      const ch = sb.channel('cockpit-activity');
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, p => cb(toActivity(p.new)));
      ch.subscribe();
      return () => { sb.removeChannel(ch); };
    },
  };
}

/** Mode hors-ligne : tout est stocké dans le navigateur (utile tant que Supabase n'est pas configuré). */
function localBackend(): Backend {
  const KEY = 'sapaudia-cockpit-v2';
  const read = (): DB => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v?.subjects) return { ...v, notes: v.notes ?? [] };
    } catch { /* stockage indisponible */ }
    return structuredClone(SEED);
  };
  const write = (db: DB) => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* stockage indisponible */ }
  };

  // Historique : même logique que les triggers SQL (création, changement de statut, suppression),
  // en comparant avec l'état enregistré avant l'écriture.
  const ACT_KEY = 'sapaudia-cockpit-activity';
  const listeners = new Set<(a: Activity) => void>();
  const readAct = (): Activity[] => {
    try {
      const v = JSON.parse(localStorage.getItem(ACT_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  };
  type Entry = Omit<Activity, 'id' | 'at'>;
  const log = (entries: Entry[]) => {
    if (!entries.length) return;
    const list = readAct();
    let id = list.reduce((m, a) => Math.max(m, a.id), 0);
    const at = new Date().toISOString();
    const added = entries.map(e => ({ ...e, id: ++id, at }));
    // Stocké du plus récent au plus ancien, plafonné.
    try { localStorage.setItem(ACT_KEY, JSON.stringify([...added.slice().reverse(), ...list].slice(0, ACTIVITY_LIMIT))); } catch { /* stockage indisponible */ }
    for (const a of added) listeners.forEach(cb => cb(a));
  };
  const entry = (table: Table, row: Record<string, unknown>, kind: Activity['kind'], from: unknown, to: unknown): Entry => ({
    entity: table === 'tasks' ? 'task' : 'subject',
    entity_id: String(row.id),
    subject_id: table === 'tasks' ? ((row.subject_id as string | null) ?? null) : String(row.id),
    kind,
    label: String(row.name ?? ''),
    from_status: (from as string | null) ?? null,
    to_status: (to as string | null) ?? null,
  });
  return {
    kind: 'local',
    async load() {
      const db = read();
      write(db);
      return db;
    },
    async upsert(table, rows) {
      const db = read();
      const list = db[table] as Row<typeof table>[];
      const acts: Entry[] = [];
      for (const r of rows) {
        const i = list.findIndex(x => x.id === r.id);
        if (table === 'tasks' || table === 'subjects') {
          const next = r as Record<string, unknown>;
          const prev = i >= 0 ? (list[i] as Record<string, unknown>) : null;
          if (!prev) acts.push(entry(table, next, 'created', null, next.status));
          else if (prev.status !== next.status) acts.push(entry(table, next, 'status', prev.status, next.status));
        }
        if (i >= 0) list[i] = r; else list.push(r);
      }
      write(db);
      log(acts);
    },
    async remove(table, id) {
      const db = read();
      const old = (db[table] as Record<string, unknown>[]).find(x => x.id === id);
      (db[table] as { id: string }[]) = db[table].filter(x => x.id !== id);
      if (table === 'subjects') {
        db.tasks.forEach(t => { if (t.subject_id === id) t.subject_id = null; });
        db.events.forEach(e => { if (e.subject_id === id) e.subject_id = null; });
      }
      if (table === 'tasks') db.notes.forEach(n => { if (n.task_id === id) n.task_id = null; });
      if (table === 'events') db.notes.forEach(n => { if (n.event_id === id) n.event_id = null; });
      if (table === 'notes') { const gone = noteDescendants(db.notes, id); db.notes = db.notes.filter(n => !gone.has(n.id)); }
      write(db);
      if (old && (table === 'tasks' || table === 'subjects')) log([entry(table, old, 'deleted', old.status, null)]);
    },
    subscribe() { return () => {}; },
    async loadActivity(sinceIso) {
      return readAct().filter(a => a.at >= sinceIso).slice(0, ACTIVITY_LIMIT);
    },
    subscribeActivity(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

export const backend: Backend = supabase ? supabaseBackend(supabase) : localBackend();
