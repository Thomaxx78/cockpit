import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './backend';

/** Contrat de l'Edge Function ai-chat (voir supabase/functions/ai-chat/agent.ts). */
export type AIRef = { type: 'task' | 'subject' | 'event'; id: string };
export type AIOpResult = { ok: boolean; kind: 'insert' | 'update' | 'delete'; table: string; id: string; text: string };
export type AIProposal = { id: string; items: string[]; more: number; expires_at: string };
export type AIResponse = {
  reply: string;
  ops?: AIOpResult[];
  proposal?: AIProposal;
  refs: AIRef[];
  changed: boolean;
  model?: string;
};
export type AIHistoryItem = { role: 'user' | 'assistant'; content: string };

export class AIError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const aiAvailable = () => !!supabase;

async function call(body: Record<string, unknown>): Promise<AIResponse> {
  if (!supabase) throw new AIError('local', 'L’assistant IA nécessite Supabase (mode local actif).');
  const { data, error } = await supabase.functions.invoke('ai-chat', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      const payload = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
      if (res.status === 404 && !payload?.error) throw new AIError('not_deployed', 'La fonction ai-chat n’est pas encore déployée sur Supabase.');
      throw new AIError(payload?.error?.code ?? `http_${res.status}`, payload?.error?.message ?? `Erreur du serveur (${res.status}).`);
    }
    if (error instanceof FunctionsFetchError) throw new AIError('network', 'Assistant injoignable. Vérifie ta connexion ou le déploiement de la fonction ai-chat.');
    throw new AIError('unknown', error.message);
  }
  return data as AIResponse;
}

export const askAI = (message: string, history: AIHistoryItem[], refs: AIRef[]) => call({ message, history, refs });
export const confirmAI = (proposalId: string, refs: AIRef[]) => call({ action: 'confirm', proposal_id: proposalId, refs });
export const cancelAI = (proposalId: string, refs: AIRef[]) => call({ action: 'cancel', proposal_id: proposalId, refs });
