import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Delete } from 'lucide-react';
import { supabase } from '../lib/backend';

/**
 * Le code n'est stocké nulle part dans le front : c'est le mot de passe d'un compte Supabase unique
 * (haché côté serveur, tentatives limitées par Supabase). Seul l'email technique du compte est dans le .env.
 */
const AUTH_EMAIL = import.meta.env.VITE_AUTH_EMAIL as string | undefined;
const PIN_LENGTH = 6;

export function AuthGate({ children }: { children: (email: string | null) => ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabase) return <>{children(null)}</>;
  if (session === undefined) return <div className="splash"><div className="spinner" /></div>;
  if (!session) return <PinLock />;
  return <>{children(session.user.email ?? null)}</>;
}

const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
];

function PinLock() {
  const [pin, setPin] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'error' | 'ok'>('idle');
  const [message, setMessage] = useState('Saisis ton code');
  const [now, setNow] = useState(() => new Date());
  const [pressed, setPressed] = useState<string | null>(null);
  const live = useRef({ pin, state });
  live.current = { pin, state };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  const submit = useCallback(async (code: string) => {
    setState('busy');
    const { error } = await supabase!.auth.signInWithPassword({ email: AUTH_EMAIL!, password: code });
    if (!error) { setState('ok'); return; }
    const limited = error.status === 429 || /rate limit/i.test(error.message);
    setMessage(limited ? 'Trop de tentatives — réessaie dans quelques minutes' : 'Code incorrect');
    setState('error');
    setTimeout(() => { setPin(''); setState('idle'); }, 650);
  }, []);

  const press = useCallback((d: string) => {
    const { pin: cur, state: st } = live.current;
    if (st === 'busy' || st === 'error' || st === 'ok' || cur.length >= PIN_LENGTH) return;
    const next = cur + d;
    setPin(next);
    if (next.length === PIN_LENGTH) submit(next);
  }, [submit]);

  const erase = useCallback(() => {
    if (live.current.state === 'idle') setPin(p => p.slice(0, -1));
  }, []);

  useEffect(() => {
    const flash = (k: string) => { setPressed(k); setTimeout(() => setPressed(p => (p === k ? null : p)), 120); };
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { press(e.key); flash(e.key); }
      else if (e.key === 'Backspace') { erase(); flash('del'); }
      else if (e.key === 'Escape') setPin('');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [press, erase]);

  if (!AUTH_EMAIL) {
    return <div className="lock"><p className="lock-msg">VITE_AUTH_EMAIL manquant dans le .env</p></div>;
  }

  return (
    <div className="lock">
      <div className="lock-clock">
        <div className="lock-time">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="lock-date">{now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>

      <div className="lock-center">
        <div className="lock-icon">✦</div>
        <div className={`lock-msg ${state === 'error' ? 'is-error' : ''}`}>{state === 'busy' ? 'Vérification…' : state === 'ok' ? 'Déverrouillé' : message}</div>
        <div className={`pin-dots ${state}`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
        </div>

        <div className="keypad">
          {KEYS.map(([d, letters]) => (
            <button key={d} className={`key ${pressed === d ? 'down' : ''}`} onClick={() => press(d)} aria-label={d}>
              <span className="key-num">{d}</span>
              <span className="key-letters">{letters}</span>
            </button>
          ))}
          <span />
          <button className={`key ${pressed === '0' ? 'down' : ''}`} onClick={() => press('0')} aria-label="0">
            <span className="key-num">0</span>
          </button>
          <button className={`key ghost ${pressed === 'del' ? 'down' : ''}`} onClick={erase} aria-label="Effacer" disabled={!pin}>
            <Delete size={24} />
          </button>
        </div>
      </div>

      <div className="lock-foot">Cockpit · tape ton code au clavier ou sur le pavé</div>
    </div>
  );
}

export const signOut = () => supabase?.auth.signOut();
