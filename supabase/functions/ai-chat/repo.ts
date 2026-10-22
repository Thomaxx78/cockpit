import type { AnyRow, Table } from './domain.ts';

export type Proposal = { id: string; ops: Op[]; preview: string[]; expires_at: string };

/** Opération concrète et validée, prête à être exécutée (ou proposée). */
export type Op =
  | { kind: 'insert'; table: Table; row: Record<string, unknown>; label: string }
  | { kind: 'update'; table: Table; id: string; patch: Record<string, unknown>; label: string }
  | { kind: 'delete'; table: Table; id: string; label: string };

/**
 * Accès aux données. L'implémentation Supabase utilise le jeton de l'utilisateur :
 * la RLS (public.is_owner()) s'applique à chaque lecture / écriture.
 */
export interface Repo {
  list(table: Table): Promise<AnyRow[]>;
  get(table: Table, id: string): Promise<AnyRow | null>;
  insert(table: Table, row: Record<string, unknown>): Promise<AnyRow>;
  update(table: Table, id: string, patch: Record<string, unknown>): Promise<AnyRow>;
  remove(table: Table, id: string): Promise<void>;
  createProposal(ops: Op[], preview: string[]): Promise<Proposal>;
  /** Passe atomiquement une proposition « pending » non expirée en « executing ». */
  claimProposal(id: string): Promise<Proposal | null>;
  finishProposal(id: string, status: 'done' | 'cancelled', result?: unknown): Promise<void>;
  /** Nombre de requêtes IA de l'utilisateur depuis `since`. */
  countRequests(since: Date): Promise<number>;
  logRequest(): Promise<void>;
}

/** Implémentation en mémoire (tests). */
export function memoryRepo(seed: Partial<Record<Table, AnyRow[]>>, now = () => new Date()): Repo & { data: Record<Table, AnyRow[]>; proposals: Map<string, Proposal & { status: string }>; requests: Date[] } {
  const data = { tasks: [...(seed.tasks ?? [])], subjects: [...(seed.subjects ?? [])], events: [...(seed.events ?? [])] } as Record<Table, AnyRow[]>;
  const proposals = new Map<string, Proposal & { status: string }>();
  const requests: Date[] = [];
  let n = 0;
  return {
    data, proposals, requests,
    async list(t) { return data[t].map(r => ({ ...r })); },
    async get(t, id) { const r = data[t].find(x => x.id === id); return r ? { ...r } : null; },
    async insert(t, row) {
      if (data[t].some(x => x.id === row.id)) throw new Error('duplicate id');
      data[t].push(row as AnyRow);
      return { ...(row as AnyRow) };
    },
    async update(t, id, patch) {
      const r = data[t].find(x => x.id === id);
      if (!r) throw new Error('not found');
      Object.assign(r, patch);
      return { ...r };
    },
    async remove(t, id) { data[t] = data[t].filter(x => x.id !== id); },
    async createProposal(ops, preview) {
      const p = { id: 'p' + ++n, ops, preview, expires_at: new Date(now().getTime() + 600_000).toISOString(), status: 'pending' };
      proposals.set(p.id, p);
      return p;
    },
    async claimProposal(id) {
      const p = proposals.get(id);
      if (!p || p.status !== 'pending' || new Date(p.expires_at) <= now()) return null;
      p.status = 'executing';
      return p;
    },
    async finishProposal(id, status) { const p = proposals.get(id); if (p) p.status = status; },
    async countRequests(since) { return requests.filter(d => d >= since).length; },
    async logRequest() { requests.push(now()); },
  };
}
