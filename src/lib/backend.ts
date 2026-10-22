import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DB, Row, Table } from './types';
import { SEED } from './seed';

export type Change = { table: Table; type: 'upsert' | 'delete'; row: { id: string } & Record<string, unknown> };

export interface Backend {
  kind: 'supabase' | 'local';
  load(): Promise<DB>;
  upsert<T extends Table>(table: T, rows: Row<T>[]): Promise<void>;
  remove(table: Table, id: string): Promise<void>;
  subscribe(cb: (c: Change) => void): () => void;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

const TABLES: Table[] = ['subjects', 'tasks', 'events'];

/** Garde uniquement les colonnes connues (évite d'envoyer des champs parasites). */
const COLUMNS: Record<Table, string[]> = {
  subjects: ['id', 'name', 'category', 'status', 'summary', 'confirmed', 'hypothesis', 'questions', 'people', 'next_step', 'due_date', 'origin', 'color', 'notes', 'position'],
  tasks: ['id', 'name', 'subject_id', 'status', 'priority', 'owner', 'due_date', 'position'],
  events: ['id', 'date', 'name', 'subject_id', 'kind', 'start_time', 'end_time'],
};
const NULLABLE = ['due_date', 'subject_id', 'start_time', 'end_time'];
const TIME_COLUMNS = ['start_time', 'end_time'];

/** Faux tant que la migration des heures (supabase/schema.sql) n'a pas été exécutée. */
export const features = { eventTimes: true };

export function clean<T extends Table>(table: T, row: Record<string, unknown>): Row<T> {
  const out: Record<string, unknown> = {};
  for (const c of COLUMNS[table]) {
    let v = row[c] === '' && NULLABLE.includes(c) ? null : row[c] ?? null;
    if (TIME_COLUMNS.includes(c) && typeof v === 'string') v = v.slice(0, 5); // "15:30:00" → "15:30"
    out[c] = v;
  }
  return out as Row<T>;
}

const forDb = (table: Table, row: Record<string, unknown>) => {
  const r = clean(table, row) as Record<string, unknown>;
  if (table === 'events' && !features.eventTimes) for (const c of TIME_COLUMNS) delete r[c];
  return r;
};

function supabaseBackend(sb: SupabaseClient): Backend {
  return {
    kind: 'supabase',
    async load() {
      const [s, t, e] = await Promise.all([
        sb.from('subjects').select('*').order('position'),
        sb.from('tasks').select('*').order('position'),
        sb.from('events').select('*').order('date'),
      ]);
      const err = s.error || t.error || e.error;
      if (err) throw err;
      if (e.data!.length && !('start_time' in e.data![0])) features.eventTimes = false;
      return {
        subjects: s.data!.map(r => clean('subjects', r)),
        tasks: t.data!.map(r => clean('tasks', r)),
        events: e.data!.map(r => clean('events', r)),
      };
    },
    async upsert(table, rows) {
      if (!rows.length) return;
      let { error } = await sb.from(table).upsert(rows.map(r => forDb(table, r)));
      if (error && table === 'events' && features.eventTimes && /start_time|end_time/.test(error.message)) {
        features.eventTimes = false; // colonnes absentes : on réessaie sans les heures
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
      if (v?.subjects) return v;
    } catch { /* stockage indisponible */ }
    return structuredClone(SEED);
  };
  const write = (db: DB) => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* stockage indisponible */ }
  };
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
      for (const r of rows) {
        const i = list.findIndex(x => x.id === r.id);
        if (i >= 0) list[i] = r; else list.push(r);
      }
      write(db);
    },
    async remove(table, id) {
      const db = read();
      (db[table] as { id: string }[]) = db[table].filter(x => x.id !== id);
      if (table === 'subjects') {
        db.tasks.forEach(t => { if (t.subject_id === id) t.subject_id = null; });
        db.events.forEach(e => { if (e.subject_id === id) e.subject_id = null; });
      }
      write(db);
    },
    subscribe() { return () => {}; },
  };
}

export const backend: Backend = supabase ? supabaseBackend(supabase) : localBackend();
