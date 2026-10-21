import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { backend, clean } from './backend';
import type { CalEvent, DB, Subject, Table, Task } from './types';
import { SEED } from './seed';

type Toast = { id: number; text: string; tone?: 'error' };

type Store = {
  db: DB;
  ready: boolean;
  loadError: string | null;
  saving: number;
  saveError: boolean;
  backendKind: 'supabase' | 'local';
  subject: (id: string | null | undefined) => Subject | undefined;
  saveSubject: (s: Subject) => void;
  deleteSubject: (id: string) => void;
  saveTask: (t: Task) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, status: string, position: number) => void;
  saveEvent: (e: CalEvent) => void;
  deleteEvent: (id: string) => void;
  importDB: (data: DB) => Promise<void>;
  reload: () => Promise<void>;
  toast: (text: string, tone?: 'error') => void;
  toasts: Toast[];
};

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

export const newId = (prefix: string) =>
  prefix + (globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10));

const upsertIn = <T extends { id: string }>(list: T[], row: T) => {
  const i = list.findIndex(x => x.id === row.id);
  if (i < 0) return [...list, row];
  const copy = list.slice();
  copy[i] = row;
  return copy;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>({ subjects: [], tasks: [], events: [] });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone?: 'error') => {
    const id = ++toastId.current;
    setToasts(t => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);

  const reload = useCallback(async () => {
    try {
      setDb(await backend.load());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    reload();
    return backend.subscribe(({ table, type, row }) => {
      setDb(d => ({
        ...d,
        [table]: type === 'delete' ? (d[table] as { id: string }[]).filter(x => x.id !== row.id) : upsertIn(d[table] as { id: string }[], row),
      }));
    });
  }, [reload]);

  /** Exécute une écriture distante ; l'état local est déjà à jour (optimiste). */
  const persist = useCallback((op: () => Promise<void>) => {
    setSaving(n => n + 1);
    op()
      .then(() => setSaveError(false))
      .catch(e => {
        setSaveError(true);
        toast('Échec de sauvegarde : ' + (e?.message ?? e), 'error');
        reload();
      })
      .finally(() => setSaving(n => n - 1));
  }, [toast, reload]);

  const write = useCallback(<T extends Table>(table: T, row: DB[T][number]) => {
    const r = clean(table, row as Record<string, unknown>);
    setDb(d => ({ ...d, [table]: upsertIn(d[table] as { id: string }[], r) }));
    persist(() => backend.upsert(table, [r]));
  }, [persist]);

  const remove = useCallback((table: Table, id: string) => {
    setDb(d => {
      const next = { ...d, [table]: (d[table] as { id: string }[]).filter(x => x.id !== id) } as DB;
      if (table === 'subjects') {
        next.tasks = next.tasks.map(t => (t.subject_id === id ? { ...t, subject_id: null } : t));
        next.events = next.events.map(e => (e.subject_id === id ? { ...e, subject_id: null } : e));
      }
      return next;
    });
    persist(() => backend.remove(table, id));
  }, [persist]);

  const store = useMemo<Store>(() => ({
    db, ready, loadError, saving, saveError, toasts, toast, reload,
    backendKind: backend.kind,
    subject: id => (id ? db.subjects.find(s => s.id === id) : undefined),
    saveSubject: s => write('subjects', s),
    deleteSubject: id => remove('subjects', id),
    saveTask: t => write('tasks', t),
    deleteTask: id => remove('tasks', id),
    moveTask: (id, status, position) => {
      const t = db.tasks.find(x => x.id === id);
      if (t && (t.status !== status || t.position !== position)) write('tasks', { ...t, status, position });
    },
    saveEvent: e => write('events', e),
    deleteEvent: id => remove('events', id),
    importDB: async data => {
      setSaving(n => n + 1);
      try {
        // Fusion : on ajoute / met à jour, on ne supprime jamais rien.
        await backend.upsert('subjects', data.subjects);
        await backend.upsert('tasks', data.tasks);
        await backend.upsert('events', data.events);
        await reload();
        toast(`Import terminé : ${data.subjects.length} sujets, ${data.tasks.length} actions, ${data.events.length} événements`);
      } catch (e) {
        toast('Import impossible : ' + (e instanceof Error ? e.message : String(e)), 'error');
      } finally {
        setSaving(n => n - 1);
      }
    },
  }), [db, ready, loadError, saving, saveError, toasts, toast, reload, write, remove]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** Accepte l'export de l'ancien cockpit (v1) comme celui du nouveau (v2). */
export function parseImport(raw: unknown): DB {
  const v = raw as Record<string, unknown[]> & { notes?: Record<string, string> };
  if (!Array.isArray(v?.subjects) || !Array.isArray(v?.tasks) || !Array.isArray(v?.events)) throw new Error('Structure incorrecte');
  const seedColor = (id: string) => SEED.subjects.find(s => s.id === id)?.color ?? '#8b94a7';
  const subjects = (v.subjects as Record<string, unknown>[]).map((s, i) => clean('subjects', {
    ...s,
    next_step: s.next_step ?? s.next ?? '',
    due_date: s.due_date ?? s.date ?? null,
    color: s.color ?? seedColor(String(s.id)),
    notes: s.notes ?? v.notes?.[String(s.id)] ?? '',
    position: s.position ?? i,
  }));
  const tasks = (v.tasks as Record<string, unknown>[]).map((t, i) => clean('tasks', {
    ...t,
    subject_id: t.subject_id ?? t.subject ?? null,
    due_date: t.due_date ?? t.date ?? null,
    position: t.position ?? i,
  }));
  const events = (v.events as Record<string, unknown>[]).map((e, i) => clean('events', {
    ...e,
    id: e.id ?? 'e' + (i + 1),
    subject_id: e.subject_id ?? e.subject ?? null,
  }));
  // Les champs texte non nuls attendus par la base
  for (const s of subjects) for (const k of ['category', 'status', 'summary', 'confirmed', 'hypothesis', 'questions', 'people', 'next_step', 'origin', 'notes'] as const) s[k] ??= '';
  for (const t of tasks) { t.owner ??= ''; t.priority ??= 'P2'; t.status ??= 'À faire'; }
  for (const e of events) e.kind ??= 'Événement';
  return { subjects, tasks, events };
}
