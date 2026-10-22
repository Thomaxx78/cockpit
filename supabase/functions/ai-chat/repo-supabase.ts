import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { AnyRow, Table } from './domain.ts';
import type { Op, Proposal, Repo } from './repo.ts';

const ORDER: Record<Table, string> = { tasks: 'position', subjects: 'position', events: 'date' };

/**
 * Accès Supabase avec le client de l'utilisateur (jeton JWT transmis) :
 * aucune clé service_role, la RLS et public.is_owner() s'appliquent partout.
 */
export function supabaseRepo(sb: SupabaseClient, userId: string): Repo {
  const check = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    async list(table) {
      return check(await sb.from(table).select('*').order(ORDER[table]).limit(2000)) as AnyRow[];
    },
    async get(table, id) {
      return check(await sb.from(table).select('*').eq('id', id).maybeSingle()) as AnyRow | null;
    },
    async insert(table, row) {
      return check(await sb.from(table).insert(row).select().single()) as AnyRow;
    },
    async update(table, id, patch) {
      const rows = check(await sb.from(table).update(patch).eq('id', id).select()) as AnyRow[];
      if (!rows.length) throw new Error('élément introuvable ou accès refusé');
      return rows[0];
    },
    async remove(table, id) {
      check(await sb.from(table).delete().eq('id', id));
    },
    async createProposal(ops: Op[], preview: string[]) {
      const row = check(await sb.from('ai_proposals').insert({ user_id: userId, ops, preview }).select('id, expires_at').single()) as { id: string; expires_at: string };
      return { id: row.id, ops, preview, expires_at: row.expires_at };
    },
    async claimProposal(id) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
      // UPDATE … WHERE status = 'pending' AND non expirée : atomique, une proposition ne s'exécute qu'une fois.
      const rows = check(await sb.from('ai_proposals')
        .update({ status: 'executing' })
        .eq('id', id).eq('user_id', userId).eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .select('id, ops, preview, expires_at')) as Proposal[];
      return rows[0] ?? null;
    },
    async finishProposal(id, status, result) {
      check(await sb.from('ai_proposals').update({ status, result: result ?? null }).eq('id', id).eq('user_id', userId));
    },
    async countRequests(since) {
      const r = await sb.from('ai_requests').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since.toISOString());
      if (r.error) throw new Error(r.error.message);
      return r.count ?? 0;
    },
    async logRequest() {
      check(await sb.from('ai_requests').insert({ user_id: userId }));
    },
  };
}
