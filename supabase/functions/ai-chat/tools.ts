import {
  color, date, fmtDate, id, isActive, oneOf, PALETTE, PRIORITIES, str, SUBJECT_STATUSES, TASK_STATUSES, time, ValidationError,
  type AnyRow, type CalEvent, type Subject, type Table, type Task,
} from './domain.ts';
import type { Op, Repo } from './repo.ts';

export type RefType = 'task' | 'subject' | 'event';
export type Ref = { type: RefType; id: string };

export type ToolCtx = {
  repo: Repo;
  today: string; // AAAA-MM-JJ (Europe/Paris)
  refs: Ref[];
  cache: Partial<Record<Table, AnyRow[]>>;
};

type Args = Record<string, unknown>;
export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mode: 'read' | 'write';
  /** Suppressions et opérations groupées : toujours soumises à confirmation. */
  needsConfirm?: boolean;
  run?: (args: Args, ctx: ToolCtx) => Promise<unknown>;
  prepare?: (args: Args, ctx: ToolCtx) => Promise<Op[]>;
};

const TABLE_OF: Record<RefType, Table> = { task: 'tasks', subject: 'subjects', event: 'events' };
const REF_OF: Record<Table, RefType> = { tasks: 'task', subjects: 'subject', events: 'event' };
const MAX_REFS = 15;

export async function rows<T extends AnyRow>(ctx: ToolCtx, table: Table): Promise<T[]> {
  if (!ctx.cache[table]) ctx.cache[table] = await ctx.repo.list(table);
  return ctx.cache[table] as T[];
}

export function addRefs(ctx: ToolCtx, table: Table, ids: string[]) {
  const type = REF_OF[table];
  for (const rid of ids) {
    ctx.refs = [{ type, id: rid }, ...ctx.refs.filter(r => !(r.type === type && r.id === rid))];
  }
  ctx.refs = ctx.refs.slice(0, MAX_REFS);
}

const newId = (prefix: string) => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const matches = (hay: string, q?: string) => !q || norm(q).split(/\s+/).filter(Boolean).every(w => norm(hay).includes(w));
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const prioRank = (p: string) => PRIORITIES.indexOf(p) < 0 ? 9 : PRIORITIES.indexOf(p);
const limitOf = (v: unknown, def: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.floor(v))) : def;
const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function mustGet<T extends AnyRow>(ctx: ToolCtx, table: Table, rawId: unknown, field: string): Promise<T> {
  const key = id(rawId, field);
  const found = (await rows<T>(ctx, table)).find(r => r.id === key);
  if (!found) throw new ValidationError(`« ${field} » : aucun élément avec l'identifiant ${key}. Utilise un outil de recherche pour trouver le bon id.`);
  return found;
}

async function optSubject(ctx: ToolCtx, v: unknown): Promise<string | null | undefined> {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return (await mustGet<Subject>(ctx, 'subjects', v, 'subject_id')).id;
}

async function subjectName(ctx: ToolCtx, sid: string | null) {
  if (!sid) return undefined;
  return (await rows<Subject>(ctx, 'subjects')).find(s => s.id === sid)?.name;
}

async function taskView(ctx: ToolCtx, t: Task) {
  return {
    id: t.id, name: t.name, status: t.status, priority: t.priority,
    owner: t.owner || undefined, due: t.due_date ?? undefined,
    overdue: !!t.due_date && t.due_date < ctx.today && isActive(t.status) ? true : undefined,
    subject: await subjectName(ctx, t.subject_id),
  };
}

const diff = (label: string, before: unknown, after: unknown) =>
  before === after ? null : `${label} ${before || '—'} → ${after || '—'}`;

// ---------------------------------------------------------------- Actions (tickets)

const listTasks: Tool = {
  name: 'list_tasks',
  mode: 'read',
  description: 'Cherche des actions (hors terminées et backlog par défaut). Filtres : query, status, priority, subject_id, owner, overdue, due_before, due_after, include_done, include_backlog.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Mots à chercher dans le nom, l’interlocuteur ou le sujet' },
      status: { type: 'string', enum: TASK_STATUSES },
      priority: { type: 'string', enum: PRIORITIES },
      subject_id: { type: 'string' },
      owner: { type: 'string', description: 'Interlocuteur / personne affectée (recherche partielle)' },
      overdue: { type: 'boolean', description: 'Uniquement les actions en retard' },
      due_before: { type: 'string', description: 'Échéance au plus tard ce jour (AAAA-MM-JJ)' },
      due_after: { type: 'string', description: 'Échéance au plus tôt ce jour (AAAA-MM-JJ)' },
      include_done: { type: 'boolean', description: 'Inclure les actions terminées' },
      include_backlog: { type: 'boolean', description: 'Inclure le backlog (tickets en réserve)' },
      limit: { type: 'integer', minimum: 1, maximum: 25 },
    },
  },
  async run(a, ctx) {
    const status = oneOf(a.status, 'status', TASK_STATUSES);
    const priority = oneOf(a.priority, 'priority', PRIORITIES);
    const before = date(a.due_before, 'due_before');
    const after = date(a.due_after, 'due_after');
    const owner = str(a.owner, 'owner', 100);
    const q = str(a.query, 'query', 120);
    const subj = a.subject_id ? id(a.subject_id, 'subject_id') : undefined;
    const includeDone = a.include_done === true || status === 'Terminé';
    const includeBacklog = a.include_backlog === true || status === 'Backlog';
    const subjects = await rows<Subject>(ctx, 'subjects');
    const nameOf = (sid: string | null) => subjects.find(s => s.id === sid)?.name ?? '';
    const list = (await rows<Task>(ctx, 'tasks'))
      .filter(t =>
        (includeDone || t.status !== 'Terminé') &&
        (includeBacklog || t.status !== 'Backlog') &&
        (!status || t.status === status) &&
        (!priority || t.priority === priority) &&
        (!subj || t.subject_id === subj) &&
        (!owner || matches(t.owner, owner)) &&
        (a.overdue !== true || (!!t.due_date && t.due_date < ctx.today && isActive(t.status))) &&
        (!before || (!!t.due_date && t.due_date <= before)) &&
        (!after || (!!t.due_date && t.due_date >= after)) &&
        matches(`${t.name} ${t.owner} ${nameOf(t.subject_id)}`, q))
      .sort((x, y) => prioRank(x.priority) - prioRank(y.priority) || (x.due_date ?? '9999').localeCompare(y.due_date ?? '9999') || x.position - y.position);
    const shown = list.slice(0, limitOf(a.limit, 15, 25));
    addRefs(ctx, 'tasks', shown.map(t => t.id).reverse());
    return { total: list.length, shown: shown.length, items: await Promise.all(shown.map(t => taskView(ctx, t))) };
  },
};

const getTask: Tool = {
  name: 'get_task',
  mode: 'read',
  description: 'Détail d’une action.',
  parameters: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  async run(a, ctx) {
    const t = await mustGet<Task>(ctx, 'tasks', a.task_id, 'task_id');
    addRefs(ctx, 'tasks', [t.id]);
    return { ...(await taskView(ctx, t)), subject_id: t.subject_id };
  },
};

const createTask: Tool = {
  name: 'create_task',
  mode: 'write',
  description: 'Crée une action.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      subject_id: { type: ['string', 'null'] },
      status: { type: 'string', enum: TASK_STATUSES },
      priority: { type: 'string', enum: PRIORITIES },
      owner: { type: 'string', description: 'Interlocuteur / personne affectée' },
      due_date: { type: ['string', 'null'], description: 'AAAA-MM-JJ' },
    },
    required: ['name'],
  },
  async prepare(a, ctx) {
    const tasks = await rows<Task>(ctx, 'tasks');
    const row: Task = {
      id: newId('t'),
      name: str(a.name, 'name', 200, { required: true })!,
      subject_id: (await optSubject(ctx, a.subject_id)) ?? null,
      status: oneOf(a.status, 'status', TASK_STATUSES) ?? 'À faire',
      priority: oneOf(a.priority, 'priority', PRIORITIES) ?? 'P2',
      owner: str(a.owner, 'owner', 100) ?? '',
      due_date: date(a.due_date, 'due_date') ?? null,
      position: Math.max(0, ...tasks.map(t => t.position)) + 1,
    };
    const sn = await subjectName(ctx, row.subject_id);
    const bits = [row.priority, row.status, row.owner && `pour ${row.owner}`, row.due_date && `échéance ${fmtDate(row.due_date)}`, sn && `sujet « ${sn} »`];
    return [{ kind: 'insert', table: 'tasks', row, label: `Nouvelle action « ${row.name} » · ${bits.filter(Boolean).join(' · ')}` }];
  },
};

async function taskPatch(a: Args, ctx: ToolCtx, t: Task) {
  const patch: Partial<Task> = {};
  const name = str(a.name, 'name', 200);
  if (name !== undefined) { if (!name) throw new ValidationError('« name » ne peut pas être vide'); patch.name = name; }
  const status = oneOf(a.status, 'status', TASK_STATUSES); if (status) patch.status = status;
  const priority = oneOf(a.priority, 'priority', PRIORITIES); if (priority) patch.priority = priority;
  const owner = str(a.owner, 'owner', 100); if (owner !== undefined) patch.owner = owner;
  const due = date(a.due_date, 'due_date'); if (due !== undefined) patch.due_date = due;
  const subj = await optSubject(ctx, a.subject_id); if (subj !== undefined) patch.subject_id = subj;
  for (const k of Object.keys(patch) as (keyof Task)[]) if (patch[k] === t[k]) delete patch[k];
  const changes = [
    patch.name !== undefined && `nom → « ${patch.name} »`,
    patch.status && diff('statut', t.status, patch.status),
    patch.priority && diff('priorité', t.priority, patch.priority),
    patch.owner !== undefined && diff('interlocuteur', t.owner, patch.owner),
    patch.due_date !== undefined && diff('échéance', t.due_date && fmtDate(t.due_date), patch.due_date && fmtDate(patch.due_date)),
    patch.subject_id !== undefined && diff('sujet', await subjectName(ctx, t.subject_id), await subjectName(ctx, patch.subject_id ?? null)),
  ].filter(Boolean);
  return { patch, label: `« ${t.name} » : ${changes.join(', ')}` };
}

const updateTask: Tool = {
  name: 'update_task',
  mode: 'write',
  description: 'Modifie une action (champs fournis seulement ; null efface).',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'string', enum: TASK_STATUSES },
      priority: { type: 'string', enum: PRIORITIES },
      owner: { type: 'string' },
      due_date: { type: ['string', 'null'] },
      subject_id: { type: ['string', 'null'] },
    },
    required: ['task_id'],
  },
  async prepare(a, ctx) {
    const t = await mustGet<Task>(ctx, 'tasks', a.task_id, 'task_id');
    const { patch, label } = await taskPatch(a, ctx, t);
    if (!Object.keys(patch).length) throw new ValidationError(`Aucune modification : « ${t.name} » a déjà ces valeurs.`);
    return [{ kind: 'update', table: 'tasks', id: t.id, patch, label }];
  },
};

const moveTask: Tool = {
  name: 'move_task',
  mode: 'write',
  description: 'Change la colonne Kanban d’une action (place: top/bottom).',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      status: { type: 'string', enum: TASK_STATUSES },
      place: { type: 'string', enum: ['top', 'bottom'] },
    },
    required: ['task_id', 'status'],
  },
  async prepare(a, ctx) {
    const t = await mustGet<Task>(ctx, 'tasks', a.task_id, 'task_id');
    const status = oneOf(a.status, 'status', TASK_STATUSES);
    if (!status) throw new ValidationError('« status » est obligatoire');
    const place = oneOf(a.place, 'place', ['top', 'bottom']) ?? 'bottom';
    const others = (await rows<Task>(ctx, 'tasks')).filter(x => x.status === status && x.id !== t.id).map(x => x.position);
    const position = !others.length ? t.position : place === 'top' ? Math.min(...others) - 1 : Math.max(...others) + 1;
    if (t.status === status && t.position === position) throw new ValidationError(`« ${t.name} » est déjà à cet endroit.`);
    return [{
      kind: 'update', table: 'tasks', id: t.id, patch: { status, position },
      label: `« ${t.name} » : colonne ${t.status} → ${status} (${place === 'top' ? 'en haut' : 'en bas'})`,
    }];
  },
};

const deleteTask: Tool = {
  name: 'delete_task',
  mode: 'write',
  needsConfirm: true,
  description: 'Supprime une action.',
  parameters: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  async prepare(a, ctx) {
    const t = await mustGet<Task>(ctx, 'tasks', a.task_id, 'task_id');
    return [{ kind: 'delete', table: 'tasks', id: t.id, label: `Suppression de l’action « ${t.name} »` }];
  },
};

const bulkUpdateTasks: Tool = {
  name: 'bulk_update_tasks',
  mode: 'write',
  needsConfirm: true,
  description: 'Mêmes changements sur plusieurs actions.',
  parameters: {
    type: 'object',
    properties: {
      task_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
      status: { type: 'string', enum: TASK_STATUSES },
      priority: { type: 'string', enum: PRIORITIES },
      owner: { type: 'string' },
      due_date: { type: ['string', 'null'] },
      subject_id: { type: ['string', 'null'] },
    },
    required: ['task_ids'],
  },
  async prepare(a, ctx) {
    if (!Array.isArray(a.task_ids) || !a.task_ids.length) throw new ValidationError('« task_ids » doit contenir au moins un id');
    if (a.task_ids.length > 50) throw new ValidationError('50 actions maximum par opération groupée');
    const { task_ids: ids, ...changes } = a;
    if (!Object.keys(changes).length) throw new ValidationError('Aucun changement demandé');
    const ops: Op[] = [];
    for (const tid of new Set(ids as unknown[])) {
      const t = await mustGet<Task>(ctx, 'tasks', tid, 'task_ids');
      const { patch, label } = await taskPatch(changes, ctx, t);
      if (Object.keys(patch).length) ops.push({ kind: 'update', table: 'tasks', id: t.id, patch, label });
    }
    if (!ops.length) throw new ValidationError('Aucune modification nécessaire : ces actions ont déjà ces valeurs.');
    return ops;
  },
};

const reorderByPriority: Tool = {
  name: 'reorder_tasks_by_priority',
  mode: 'write',
  needsConfirm: true,
  description: 'Trie le Kanban par priorité puis échéance.',
  parameters: { type: 'object', properties: { status: { type: 'string', enum: TASK_STATUSES } } },
  async prepare(a, ctx) {
    const only = oneOf(a.status, 'status', TASK_STATUSES);
    const tasks = await rows<Task>(ctx, 'tasks');
    const ops: Op[] = [];
    for (const st of only ? [only] : TASK_STATUSES) {
      const col = tasks.filter(t => t.status === st).sort((x, y) => x.position - y.position);
      const sorted = [...col].sort((x, y) =>
        prioRank(x.priority) - prioRank(y.priority) || (x.due_date ?? '9999').localeCompare(y.due_date ?? '9999') || x.position - y.position);
      // Positions réutilisées dans la colonne : l'ordre des autres colonnes n'est pas touché.
      const slots = col.map(t => t.position);
      sorted.forEach((t, i) => {
        if (t.position !== slots[i]) {
          ops.push({ kind: 'update', table: 'tasks', id: t.id, patch: { position: slots[i] }, label: `${st} · n°${i + 1} : « ${t.name} » (${t.priority})` });
        }
      });
    }
    if (!ops.length) throw new ValidationError('Le Kanban est déjà trié par priorité.');
    return ops;
  },
};

// ---------------------------------------------------------------- Sujets

const listSubjects: Tool = {
  name: 'list_subjects',
  mode: 'read',
  description: 'Cherche des sujets (dossiers/projets).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      status: { type: 'string', enum: SUBJECT_STATUSES },
      limit: { type: 'integer', minimum: 1, maximum: 25 },
    },
  },
  async run(a, ctx) {
    const q = str(a.query, 'query', 120);
    const status = oneOf(a.status, 'status', SUBJECT_STATUSES);
    const tasks = await rows<Task>(ctx, 'tasks');
    const list = (await rows<Subject>(ctx, 'subjects'))
      .filter(s => (!status || s.status === status) && matches(`${s.name} ${s.category} ${s.people}`, q))
      .sort((x, y) => x.position - y.position);
    const shown = list.slice(0, limitOf(a.limit, 15, 25));
    addRefs(ctx, 'subjects', shown.map(s => s.id).reverse());
    return {
      total: list.length,
      items: shown.map(s => ({
        id: s.id, name: s.name, category: s.category || undefined, status: s.status,
        next_step: s.next_step ? cut(s.next_step, 160) : undefined,
        summary: s.summary ? cut(s.summary, 200) : undefined,
        open_tasks: tasks.filter(t => t.subject_id === s.id && isActive(t.status)).length,
      })),
    };
  },
};

const createSubject: Tool = {
  name: 'create_subject',
  mode: 'write',
  description: 'Crée un sujet.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      category: { type: 'string' },
      status: { type: 'string', enum: SUBJECT_STATUSES },
      summary: { type: 'string' },
      color: { type: 'string', description: '#RRGGBB (facultatif)' },
    },
    required: ['name'],
  },
  async prepare(a, ctx) {
    const subjects = await rows<Subject>(ctx, 'subjects');
    const row: Subject = {
      id: newId('s'),
      name: str(a.name, 'name', 120, { required: true })!,
      category: str(a.category, 'category', 60) ?? '',
      status: oneOf(a.status, 'status', SUBJECT_STATUSES) ?? 'À cadrer',
      summary: str(a.summary, 'summary', 1000) ?? '',
      confirmed: '', hypothesis: '', questions: '', people: '', next_step: '', due_date: null,
      origin: `Assistant IA — ${ctx.today}`,
      color: color(a.color) ?? PALETTE[subjects.length % PALETTE.length],
      notes: '',
      position: Math.max(0, ...subjects.map(s => s.position)) + 1,
    };
    return [{ kind: 'insert', table: 'subjects', row, label: `Nouveau sujet « ${row.name} »${row.category ? ` · ${row.category}` : ''} · ${row.status}` }];
  },
};

const updateSubject: Tool = {
  name: 'update_subject',
  mode: 'write',
  description: 'Modifie un sujet (notes_append ajoute une note datée).',
  parameters: {
    type: 'object',
    properties: {
      subject_id: { type: 'string' },
      name: { type: 'string' },
      category: { type: 'string' },
      status: { type: 'string', enum: SUBJECT_STATUSES },
      summary: { type: 'string' },
      next_step: { type: 'string' },
      people: { type: 'string' },
      due_date: { type: ['string', 'null'] },
      notes_append: { type: 'string' },
    },
    required: ['subject_id'],
  },
  async prepare(a, ctx) {
    const s = await mustGet<Subject>(ctx, 'subjects', a.subject_id, 'subject_id');
    const patch: Partial<Subject> = {};
    const name = str(a.name, 'name', 120); if (name) patch.name = name;
    const category = str(a.category, 'category', 60); if (category !== undefined) patch.category = category;
    const status = oneOf(a.status, 'status', SUBJECT_STATUSES); if (status) patch.status = status;
    const summary = str(a.summary, 'summary', 1000); if (summary !== undefined) patch.summary = summary;
    const next = str(a.next_step, 'next_step', 500); if (next !== undefined) patch.next_step = next;
    const people = str(a.people, 'people', 300); if (people !== undefined) patch.people = people;
    const due = date(a.due_date, 'due_date'); if (due !== undefined) patch.due_date = due;
    const note = str(a.notes_append, 'notes_append', 1000);
    if (note) patch.notes = (s.notes ? s.notes + '\n' : '') + `[${ctx.today}] ${note}`;
    for (const k of Object.keys(patch) as (keyof Subject)[]) if (patch[k] === s[k]) delete patch[k];
    if (!Object.keys(patch).length) throw new ValidationError('Aucune modification demandée');
    const changes = [
      patch.name && `nom → « ${patch.name} »`, patch.status && diff('statut', s.status, patch.status),
      patch.category !== undefined && 'catégorie', patch.summary !== undefined && 'résumé', patch.next_step !== undefined && 'prochaine étape',
      patch.people !== undefined && 'interlocuteurs', patch.due_date !== undefined && diff('échéance', s.due_date && fmtDate(s.due_date), patch.due_date && fmtDate(patch.due_date)),
      note && 'note ajoutée',
    ].filter(Boolean);
    return [{ kind: 'update', table: 'subjects', id: s.id, patch, label: `Sujet « ${s.name} » : ${changes.join(', ')}` }];
  },
};

// ---------------------------------------------------------------- Événements

const listEvents: Tool = {
  name: 'list_events',
  mode: 'read',
  description: 'Événements entre from et to (défaut : 30 jours ; cours exclus sauf include_courses).',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'AAAA-MM-JJ (défaut : aujourd’hui)' },
      to: { type: 'string', description: 'AAAA-MM-JJ (défaut : from + 30 jours)' },
      query: { type: 'string' },
      subject_id: { type: 'string' },
      include_courses: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 25 },
    },
  },
  async run(a, ctx) {
    const from = date(a.from, 'from') ?? ctx.today;
    const to = date(a.to, 'to') ?? addDays(from, 30);
    const q = str(a.query, 'query', 120);
    const subj = a.subject_id ? id(a.subject_id, 'subject_id') : undefined;
    const list = (await rows<CalEvent>(ctx, 'events'))
      .filter(e => e.date >= from && e.date <= to && (a.include_courses === true || e.kind !== 'Cours') &&
        (!subj || e.subject_id === subj) && matches(`${e.name} ${e.kind}`, q))
      .sort((x, y) => (x.date + (x.start_time ?? '')).localeCompare(y.date + (y.start_time ?? '')));
    const shown = list.slice(0, limitOf(a.limit, 15, 25));
    addRefs(ctx, 'events', shown.map(e => e.id).reverse());
    return {
      from, to, total: list.length,
      items: await Promise.all(shown.map(async e => ({
        id: e.id, date: e.date, start: e.start_time?.slice(0, 5) ?? undefined, end: e.end_time?.slice(0, 5) ?? undefined,
        name: e.name, kind: e.kind, subject: await subjectName(ctx, e.subject_id),
      }))),
    };
  },
};

async function eventFields(a: Args, ctx: ToolCtx, base?: CalEvent) {
  const patch: Partial<CalEvent> = {};
  const name = str(a.name, 'name', 160); if (name !== undefined) { if (!name) throw new ValidationError('« name » ne peut pas être vide'); patch.name = name; }
  const d = date(a.date, 'date'); if (d === null) throw new ValidationError('« date » ne peut pas être effacée'); if (d) patch.date = d;
  const st = time(a.start_time, 'start_time'); if (st !== undefined) patch.start_time = st;
  const en = time(a.end_time, 'end_time'); if (en !== undefined) patch.end_time = en;
  const kind = str(a.kind, 'kind', 40); if (kind) patch.kind = kind;
  const subj = await optSubject(ctx, a.subject_id); if (subj !== undefined) patch.subject_id = subj;
  const start = patch.start_time !== undefined ? patch.start_time : base?.start_time ?? null;
  const end = patch.end_time !== undefined ? patch.end_time : base?.end_time ?? null;
  if (start && end && end.slice(0, 5) < start.slice(0, 5)) throw new ValidationError('L’heure de fin doit être après l’heure de début');
  if (end && !start) throw new ValidationError('Indique une heure de début si tu fixes une heure de fin');
  return patch;
}
const when = (e: Partial<CalEvent>) =>
  `${e.date ? fmtDate(e.date) : ''}${e.start_time ? ` ${e.start_time.slice(0, 5)}${e.end_time ? `–${e.end_time.slice(0, 5)}` : ''}` : ''}`.trim();

const createEvent: Tool = {
  name: 'create_event',
  mode: 'write',
  description: 'Ajoute un événement.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      date: { type: 'string', description: 'AAAA-MM-JJ' },
      start_time: { type: ['string', 'null'], description: 'HH:MM' },
      end_time: { type: ['string', 'null'], description: 'HH:MM' },
      kind: { type: 'string', description: 'Réunion, Rendez-vous, Échéance, Événement…' },
      subject_id: { type: ['string', 'null'] },
    },
    required: ['name', 'date'],
  },
  async prepare(a, ctx) {
    if (!a.name) throw new ValidationError('« name » est obligatoire');
    if (!a.date) throw new ValidationError('« date » est obligatoire');
    const f = await eventFields(a, ctx);
    const row: CalEvent = {
      id: newId('e'), name: f.name!, date: f.date!, kind: f.kind ?? 'Événement',
      start_time: f.start_time ?? null, end_time: f.end_time ?? null, subject_id: f.subject_id ?? null,
    };
    const sn = await subjectName(ctx, row.subject_id);
    return [{ kind: 'insert', table: 'events', row, label: `Nouvel événement « ${row.name} » · ${when(row)} · ${row.kind}${sn ? ` · sujet « ${sn} »` : ''}` }];
  },
};

const updateEvent: Tool = {
  name: 'update_event',
  mode: 'write',
  description: 'Modifie un événement.',
  parameters: {
    type: 'object',
    properties: {
      event_id: { type: 'string' },
      name: { type: 'string' },
      date: { type: 'string' },
      start_time: { type: ['string', 'null'] },
      end_time: { type: ['string', 'null'] },
      kind: { type: 'string' },
      subject_id: { type: ['string', 'null'] },
    },
    required: ['event_id'],
  },
  async prepare(a, ctx) {
    const e = await mustGet<CalEvent>(ctx, 'events', a.event_id, 'event_id');
    const patch = await eventFields(a, ctx, e);
    for (const k of Object.keys(patch) as (keyof CalEvent)[]) if ((patch[k] ?? null) === (e[k] ?? null)) delete patch[k];
    if (!Object.keys(patch).length) throw new ValidationError(`Aucune modification : « ${e.name} » a déjà ces valeurs.`);
    const after = { ...e, ...patch };
    const what = when(e) !== when(after) ? `${when(e)} → ${when(after)}` : 'détails modifiés';
    return [{ kind: 'update', table: 'events', id: e.id, patch, label: `Événement « ${after.name} » : ${what}` }];
  },
};

const deleteEvent: Tool = {
  name: 'delete_event',
  mode: 'write',
  needsConfirm: true,
  description: 'Supprime un événement.',
  parameters: { type: 'object', properties: { event_id: { type: 'string' } }, required: ['event_id'] },
  async prepare(a, ctx) {
    const e = await mustGet<CalEvent>(ctx, 'events', a.event_id, 'event_id');
    return [{ kind: 'delete', table: 'events', id: e.id, label: `Suppression de l’événement « ${e.name} » (${when(e)})` }];
  },
};

export const TOOLS: Tool[] = [
  listTasks, getTask, createTask, updateTask, moveTask, deleteTask, bulkUpdateTasks, reorderByPriority,
  listSubjects, createSubject, updateSubject,
  listEvents, createEvent, updateEvent, deleteEvent,
];
export const TOOL_BY_NAME = new Map(TOOLS.map(t => [t.name, t]));

/**
 * Schémas envoyés au modèle, compactés pour le quota gratuit (≈ tokens par appel) :
 * pas de description de champ, pas de bornes, enums longues retirées. Les valeurs autorisées
 * sont rappelées une seule fois dans l'invite système et toujours validées côté serveur.
 */
function compact(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(compact);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['description', 'minimum', 'maximum', 'minItems', 'maxItems'].includes(k)) continue;
    if (k === 'enum' && Array.isArray(v) && v.length > 3) continue;
    if (k === 'type' && Array.isArray(v)) { out[k] = v[0]; continue; } // ["string","null"] → "string" ("" ou null acceptés)
    if (k === 'properties') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) if (pk !== 'limit') props[pk] = compact(pv);
      out[k] = props;
      continue;
    }
    out[k] = compact(v);
  }
  return out;
}

export const toolSchemas = () =>
  TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: compact(t.parameters) } }));

// ---------------------------------------------------------------- Exécution

export type OpResult = { ok: boolean; kind: Op['kind']; table: Table; id: string; text: string };

/**
 * Exécute des opérations validées. Chaque opération est re-vérifiée au moment de l'exécution
 * (l'élément existe toujours, le sujet visé aussi) : une proposition confirmée plus tard reste sûre.
 */
export async function applyOps(repo: Repo, ops: Op[]): Promise<OpResult[]> {
  const out: OpResult[] = [];
  for (const op of ops) {
    const rid = op.kind === 'insert' ? String(op.row.id) : op.id;
    try {
      const target = op.kind === 'insert' ? op.row : op.kind === 'update' ? op.patch : {};
      const subj = target.subject_id;
      if (typeof subj === 'string' && !(await repo.get('subjects', subj))) throw new Error('le sujet visé n’existe plus');
      if (op.kind === 'insert') await repo.insert(op.table, op.row);
      else {
        if (!(await repo.get(op.table, op.id))) throw new Error('l’élément n’existe plus');
        if (op.kind === 'update') await repo.update(op.table, op.id, op.patch);
        else await repo.remove(op.table, op.id);
      }
      out.push({ ok: true, kind: op.kind, table: op.table, id: rid, text: op.label });
    } catch (e) {
      out.push({ ok: false, kind: op.kind, table: op.table, id: rid, text: `${op.label} — échec : ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return out;
}

export const refsFromResults = (results: OpResult[]): Ref[] =>
  results.filter(r => r.ok && r.kind !== 'delete').map(r => ({ type: REF_OF[r.table], id: r.id }));

/** Lignes « éléments récemment évoqués » pour résoudre « celui-là », « les trois précédents »… */
export async function describeRefs(ctx: ToolCtx, refs: Ref[]): Promise<string[]> {
  const lines: string[] = [];
  for (const r of refs.slice(0, MAX_REFS)) {
    if (!TABLE_OF[r.type] || !/^[\w-]{1,64}$/.test(r.id)) continue;
    const row = (await rows<AnyRow>(ctx, TABLE_OF[r.type])).find(x => x.id === r.id);
    if (!row) continue;
    if (r.type === 'task') { const t = row as Task; lines.push(`action ${t.id} « ${cut(t.name, 80)} » (${t.status}, ${t.priority})`); }
    else if (r.type === 'subject') lines.push(`sujet ${row.id} « ${cut((row as Subject).name, 80)} »`);
    else { const e = row as CalEvent; lines.push(`événement ${e.id} « ${cut(e.name, 80)} » (${e.date})`); }
  }
  return lines;
}
