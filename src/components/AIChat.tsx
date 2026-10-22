import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Check, CircleAlert, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import {
  aiAvailable, AIError, askAI, cancelAI, confirmAI,
  type AIOpResult, type AIProposal, type AIRef, type AIResponse,
} from '../lib/aiClient';
import { useStore } from '../lib/store';
import { go } from '../lib/utils';
import { useEditors } from './editors';

type Msg = {
  id: number;
  role: 'user' | 'assistant' | 'error';
  text: string;
  ops?: AIOpResult[];
  proposal?: AIProposal & { state: 'pending' | 'confirmed' | 'cancelled' | 'expired' };
};

const SUGGESTIONS: { label: string; prompt: string; send?: boolean }[] = [
  { label: 'Créer un ticket', prompt: 'Crée un ticket : ', send: false },
  { label: 'Mes actions urgentes', prompt: 'Quelles sont mes actions urgentes (P1) ?' },
  { label: 'Actions en retard', prompt: 'Quelles actions sont en retard ?' },
  { label: 'Organiser mon Kanban', prompt: 'Organise mon Kanban par priorité.' },
  { label: 'Résumé de mes projets', prompt: 'Fais-moi un résumé de mes sujets en cours.' },
];

const STORAGE_KEY = 'cockpit-ai-chat';
type Saved = { msgs: Msg[]; refs: AIRef[] };
const load = (): Saved => {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(v?.msgs)) return v;
  } catch { /* stockage indisponible */ }
  return { msgs: [], refs: [] };
};

/** Mini-rendu : paragraphes, listes à puces / numérotées, **gras**. Aucun HTML injecté. */
function RichText({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(<Tag key={blocks.length}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>);
    list = null;
  };
  for (const line of text.split('\n')) {
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const ordered = !!num;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1]);
    } else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

export function AIChat() {
  const { db, reload } = useStore();
  const { editTask, editEvent } = useEditors();
  const [open, setOpen] = useState(false);
  const [{ msgs, refs }, setState] = useState<Saved>(load);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<null | 'thinking' | 'executing'>(null);
  const [model, setModel] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(Date.now());
  const available = aiAvailable();

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ msgs: msgs.slice(-60), refs })); } catch { /* stockage indisponible */ }
  }, [msgs, refs]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.backdrop') && setOpen(false);
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [open]);

  useLayoutEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, open]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [input, open]);

  const push = (m: Omit<Msg, 'id'>) => setState(s => ({ ...s, msgs: [...s.msgs, { ...m, id: ++nextId.current }] }));
  const patchMsg = (id: number, p: Partial<Msg>) => setState(s => ({ ...s, msgs: s.msgs.map(m => (m.id === id ? { ...m, ...p } : m)) }));

  const handle = async (res: AIResponse) => {
    if (res.model) setModel(res.model);
    setState(s => ({ ...s, refs: res.refs ?? s.refs }));
    push({ role: 'assistant', text: res.reply, ops: res.ops, proposal: res.proposal && { ...res.proposal, state: 'pending' } });
    if (res.changed) await reload();
  };
  const handleError = (e: unknown) =>
    push({ role: 'error', text: e instanceof AIError ? e.message : 'Une erreur inattendue est survenue.' });

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    const history = msgs
      .filter(m => m.role !== 'error')
      .slice(-8)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.text + (m.ops?.length ? '\n' + m.ops.map(o => `- ${o.ok ? 'fait' : 'échec'} : ${o.text}`).join('\n') : '') }));
    push({ role: 'user', text });
    setBusy('thinking');
    try { await handle(await askAI(text, history, refs)); }
    catch (e) { handleError(e); }
    finally { setBusy(null); }
  };

  const decide = async (m: Msg, accept: boolean) => {
    if (!m.proposal || busy) return;
    if (new Date(m.proposal.expires_at) < new Date()) { patchMsg(m.id, { proposal: { ...m.proposal, state: 'expired' } }); return; }
    setBusy(accept ? 'executing' : 'thinking');
    try {
      const res = await (accept ? confirmAI : cancelAI)(m.proposal.id, refs);
      const state = accept ? (res.ops ? 'confirmed' : 'expired') : 'cancelled';
      patchMsg(m.id, { proposal: { ...m.proposal, state } });
      await handle(res);
    } catch (e) { handleError(e); }
    finally { setBusy(null); }
  };

  const openResult = (o: AIOpResult) => {
    if (!o.ok || o.kind === 'delete') return;
    if (o.table === 'tasks') { const t = db.tasks.find(x => x.id === o.id); if (t) editTask(t); }
    else if (o.table === 'events') { const e = db.events.find(x => x.id === o.id); if (e) editEvent(e); }
    else if (o.table === 'subjects') { go('sujets/' + o.id); setOpen(false); }
  };

  const clear = () => { setState({ msgs: [], refs: [] }); setInput(''); };
  const OpIcon = ({ kind }: { kind: AIOpResult['kind'] }) => kind === 'insert' ? <Plus size={13} /> : kind === 'delete' ? <Trash2 size={13} /> : <Pencil size={13} />;

  return (
    <>
      {!open && (
        <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Ouvrir l’assistant IA" title="Assistant IA">
          <Sparkles size={22} />
          {msgs.length > 0 && <span className="ai-fab-dot" />}
        </button>
      )}

      {open && (
        <section className="ai-panel" role="dialog" aria-label="Assistant IA">
          <header className="ai-head">
            <span className="ai-avatar"><Sparkles size={17} /></span>
            <div className="ai-title">
              <b>Assistant</b>
              <small>{available ? (model ? `Groq · ${model.replace(/^.*\//, '')}` : 'Agit directement sur tes données') : 'Indisponible en mode local'}</small>
            </div>
            <button className="icon-btn" onClick={clear} disabled={!msgs.length || !!busy} title="Vider la conversation" aria-label="Vider la conversation"><Trash2 size={16} /></button>
            <button className="icon-btn" onClick={() => setOpen(false)} title="Fermer (Échap)" aria-label="Fermer"><X size={18} /></button>
          </header>

          <div className="ai-list" ref={listRef}>
            {!available ? (
              <div className="ai-empty">
                <CircleAlert size={28} />
                <p><b>Assistant indisponible</b></p>
                <p className="hint">L’assistant IA fonctionne uniquement avec Supabase. Configure <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code> pour l’activer.</p>
              </div>
            ) : !msgs.length ? (
              <div className="ai-empty">
                <span className="ai-avatar big"><Sparkles size={24} /></span>
                <p><b>Que veux-tu faire ?</b></p>
                <p className="hint">Je peux créer, modifier, déplacer ou retrouver tes actions, sujets et événements. Les suppressions et changements groupés te sont toujours soumis avant d’être appliqués.</p>
                <div className="ai-suggest wrap">
                  {SUGGESTIONS.map(s => (
                    <button key={s.label} onClick={() => (s.send === false ? (setInput(s.prompt), inputRef.current?.focus()) : send(s.prompt))}>{s.label}</button>
                  ))}
                </div>
              </div>
            ) : msgs.map(m => (
              <div key={m.id} className={`ai-msg ${m.role}`}>
                {m.role === 'error' && <CircleAlert size={15} className="ai-err-ico" />}
                <div className="ai-bubble">
                  {m.role === 'user' ? m.text : <RichText text={m.text} />}

                  {m.ops && m.ops.length > 0 && (
                    <ul className="ai-ops">
                      {m.ops.map((o, i) => (
                        <li key={i} className={o.ok ? 'ok' : 'ko'}>
                          <button onClick={() => openResult(o)} disabled={!o.ok || o.kind === 'delete'}>
                            <span className="ai-op-ico">{o.ok ? <OpIcon kind={o.kind} /> : <X size={13} />}</span>
                            <span>{o.text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {m.proposal && (
                    <div className={`ai-proposal ${m.proposal.state}`}>
                      <ul>
                        {m.proposal.items.map((it, i) => <li key={i}>{it}</li>)}
                        {m.proposal.more > 0 && <li className="more">… et {m.proposal.more} autre{m.proposal.more > 1 ? 's' : ''}</li>}
                      </ul>
                      {m.proposal.state === 'pending' ? (
                        <div className="ai-proposal-actions">
                          <button className="btn ghost" onClick={() => decide(m, false)} disabled={!!busy}>Annuler</button>
                          <button className="btn primary" onClick={() => decide(m, true)} disabled={!!busy}><Check size={15} /> Confirmer</button>
                        </div>
                      ) : (
                        <div className="ai-proposal-state">
                          {m.proposal.state === 'confirmed' ? 'Confirmé' : m.proposal.state === 'cancelled' ? 'Annulé' : 'Expiré'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="ai-msg assistant">
                <div className="ai-bubble ai-typing">
                  <span className="dots"><i /><i /><i /></span>
                  {busy === 'executing' ? 'Exécution…' : 'Réflexion…'}
                </div>
              </div>
            )}
          </div>

          <footer className="ai-foot">
            {available && msgs.length > 0 && (
              <div className="ai-suggest">
                {SUGGESTIONS.map(s => (
                  <button key={s.label} disabled={!!busy} onClick={() => (s.send === false ? (setInput(s.prompt), inputRef.current?.focus()) : send(s.prompt))}>{s.label}</button>
                ))}
              </div>
            )}
            <form className="ai-input" onSubmit={e => { e.preventDefault(); send(input); }}>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                maxLength={2000}
                disabled={!available}
                placeholder={available ? 'Écris une demande… (Entrée pour envoyer)' : 'Assistant indisponible'}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
              />
              <button className="ai-send" disabled={!available || !input.trim() || !!busy} aria-label="Envoyer"><ArrowUp size={18} /></button>
            </form>
          </footer>
        </section>
      )}
    </>
  );
}
