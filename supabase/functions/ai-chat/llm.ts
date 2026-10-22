// Client LLM générique « compatible OpenAI » (Groq par défaut).
// Pour changer de fournisseur : AI_BASE_URL + clé + AI_MODEL, sans toucher au reste du code.

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type LLMReply = {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export interface LLM {
  model: string;
  chat(messages: ChatMessage[], tools: unknown[]): Promise<LLMReply>;
}

export type LLMErrorCode = 'rate_limited' | 'timeout' | 'auth' | 'unavailable' | 'bad_response';

export class LLMError extends Error {
  code: LLMErrorCode;
  retryAfter?: number;
  constructor(code: LLMErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export type LLMConfig = {
  apiKey: string;
  baseUrl?: string;        // défaut : Groq
  model?: string;          // défaut : openai/gpt-oss-120b
  maxTokens?: number;      // plafond de tokens générés par appel
  reasoningEffort?: string; // modèles gpt-oss : low | medium | high
  timeoutMs?: number;
  /** Sur 429 avec Retry-After ≤ cette durée (s), on attend puis on réessaie une fois. 0 = jamais. */
  maxRetryWaitS?: number;
  fetchImpl?: typeof fetch;
};

export function openAICompatible(cfg: LLMConfig): LLM {
  const base = (cfg.baseUrl ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const model = cfg.model ?? 'openai/gpt-oss-120b';
  const doFetch = cfg.fetchImpl ?? fetch;
  const once = async (messages: ChatMessage[], tools: unknown[]): Promise<LLMReply> => {
    const body: Record<string, unknown> = {
      model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.2,
      max_completion_tokens: cfg.maxTokens ?? 1200,
    };
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = cfg.reasoningEffort ?? 'low';

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 25_000);
    let res: Response;
    try {
      res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw new LLMError('timeout', 'Le modèle IA met trop de temps à répondre.');
      throw new LLMError('unavailable', 'Service IA injoignable.');
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      throw new LLMError('rate_limited', 'Quota gratuit du service IA atteint pour le moment.', Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : undefined);
    }
    if (res.status === 401 || res.status === 403) throw new LLMError('auth', 'Clé API du service IA invalide ou absente.');
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new LLMError('unavailable', `Service IA indisponible (HTTP ${res.status}). ${detail}`);
    }

    const json = await res.json().catch(() => null) as
      | { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]; usage?: LLMReply['usage'] }
      | null;
    const msg = json?.choices?.[0]?.message;
    if (!msg) throw new LLMError('bad_response', 'Réponse inattendue du service IA.');
    return { content: msg.content ?? null, toolCalls: msg.tool_calls ?? [], usage: json?.usage };
  };

  return {
    model,
    async chat(messages, tools) {
      try {
        return await once(messages, tools);
      } catch (e) {
        // Quota par minute : une courte attente suffit souvent, mieux vaut patienter que d'afficher une erreur.
        const wait = e instanceof LLMError && e.code === 'rate_limited' ? e.retryAfter : undefined;
        if (!wait || wait > (cfg.maxRetryWaitS ?? 20)) throw e;
        await new Promise(r => setTimeout(r, wait * 1000 + 300));
        return once(messages, tools);
      }
    },
  };
}
