import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/backend';

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
  if (!session) return <Login />;
  return <>{children(session.user.email ?? null)}</>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) setError(error.message === 'Invalid login credentials' ? 'Email ou mot de passe incorrect.' : error.message);
    setBusy(false);
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="brandmark big">✦</div>
        <h1>Cockpit IA</h1>
        <p className="hint">Sapaudia · connexion</p>
        <label>Email<input type="email" autoFocus autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}

export const signOut = () => supabase?.auth.signOut();
