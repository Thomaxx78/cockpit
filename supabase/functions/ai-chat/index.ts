// Edge Function « ai-chat » : assistant IA du Cockpit.
//
// Sécurité :
// - le jeton de l'utilisateur est vérifié, puis public.is_owner() doit renvoyer true ;
// - toutes les requêtes passent par le client de l'utilisateur (RLS active, aucune clé service_role) ;
// - le modèle ne fait que proposer des appels d'outils, validés et exécutés ici ;
// - suppressions et opérations groupées : proposition persistée (ai_proposals) + confirmation explicite ;
// - la clé GROQ_API_KEY reste dans les secrets Supabase, jamais côté navigateur.
//
// Variables (secrets) : GROQ_API_KEY (obligatoire), AI_MODEL, AI_BASE_URL, AI_MAX_TOKENS,
// AI_REASONING_EFFORT, AI_RATE_PER_MINUTE, AI_RATE_PER_DAY.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { cancelProposal, checkRateLimit, confirmProposal, runAgent } from './agent.ts';
import { LLMError, openAICompatible } from './llm.ts';
import { supabaseRepo } from './repo-supabase.ts';

const env = (k: string) => Deno.env.get(k) || undefined;
const num = (k: string, d: number) => {
  const n = Number(env(k));
  return Number.isFinite(n) && n > 0 ? n : d;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } });
const fail = (status: number, code: string, message: string, extra?: Record<string, string>) =>
  json(status, { error: { code, message } }, extra);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'method', 'Méthode non autorisée.');

  // 1. Authentification
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return fail(401, 'unauthorized', 'Connexion requise.');
  const sb = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await sb.auth.getUser(authHeader.slice(7));
  if (authError || !auth?.user) return fail(401, 'unauthorized', 'Session expirée, reconnecte-toi.');

  // 2. Autorisation : même règle que la RLS des tables
  const { data: isOwner, error: ownerError } = await sb.rpc('is_owner');
  if (ownerError) return fail(500, 'server', 'Vérification des droits impossible.');
  if (isOwner !== true) return fail(403, 'forbidden', 'Ce compte n’est pas autorisé à utiliser le Cockpit.');

  // 3. Lecture de la requête
  const raw = await req.text();
  if (raw.length > 40_000) return fail(413, 'too_large', 'Requête trop volumineuse.');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object') throw new Error();
  } catch {
    return fail(400, 'bad_request', 'Requête invalide.');
  }

  const repo = supabaseRepo(sb, auth.user.id);
  try {
    // Confirmation / annulation : aucun appel au modèle, l'id renvoie à une proposition persistée.
    if (body.action === 'confirm') return json(200, await confirmProposal(repo, body.proposal_id, body.refs));
    if (body.action === 'cancel') return json(200, await cancelProposal(repo, body.proposal_id, body.refs));
    if (typeof body.message !== 'string') return fail(400, 'bad_request', 'Message manquant.');

    const apiKey = env('GROQ_API_KEY') ?? env('AI_API_KEY');
    if (!apiKey) return fail(503, 'not_configured', 'L’assistant n’est pas configuré : ajoute le secret GROQ_API_KEY dans Supabase.');

    // 4. Limitation de débit par utilisateur
    const rate = await checkRateLimit(repo, { perMinute: num('AI_RATE_PER_MINUTE', 8), perDay: num('AI_RATE_PER_DAY', 200) });
    if (!rate.ok) return fail(429, 'rate_limited', rate.message, { 'Retry-After': String(rate.retryAfter) });
    await repo.logRequest();

    // 5. Agent
    const llm = openAICompatible({
      apiKey,
      baseUrl: env('AI_BASE_URL'),
      model: env('AI_MODEL') ?? env('GROQ_MODEL'),
      maxTokens: num('AI_MAX_TOKENS', 1200),
      reasoningEffort: env('AI_REASONING_EFFORT'),
    });
    const out = await runAgent(llm, repo, { message: body.message, history: body.history, refs: body.refs });
    return json(200, { ...out, model: llm.model });
  } catch (e) {
    if (e instanceof LLMError) {
      const status = e.code === 'rate_limited' ? 429 : e.code === 'timeout' ? 504 : 502;
      const extra = e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : undefined;
      return fail(status, e.code === 'rate_limited' ? 'quota' : e.code, e.message + (e.retryAfter ? ` Réessaie dans ${e.retryAfter} s.` : ''), extra);
    }
    console.error('ai-chat', e);
    return fail(500, 'server', 'Erreur interne de l’assistant.');
  }
});
