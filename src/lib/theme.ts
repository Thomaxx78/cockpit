import { useCallback, useEffect, useState } from 'react';

/**
 * Choix du thème de l'interface.
 *
 * CONTRAT avec la feuille de style : l'attribut `data-theme` posé sur <html> vaut
 * 'light' ou 'dark' ; absent, l'interface suit le réglage du système
 * (`prefers-color-scheme`). Le script inline de index.html applique le même
 * attribut avant le chargement de l'appli pour éviter le flash : garder la clé
 * de stockage et les valeurs synchronisées avec lui.
 */
export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'cockpit-theme';
const COLORS = { light: '#f1f3f6', dark: '#0a1020' } as const;
const EVENT = 'cockpit-theme-change';

const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isTheme(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemDark(): boolean {
  try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

/** Thème réellement affiché ('system' résolu selon le réglage de l'appareil). */
export function effectiveTheme(t: Theme): 'light' | 'dark' {
  return t === 'system' ? (systemDark() ? 'dark' : 'light') : t;
}

/** Barre d'état / barre d'adresse : on suit le thème effectif. */
function syncMetaThemeColor(t: Theme) {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach(m => {
    // Mémorise la couleur d'origine liée à la media query (pour le mode 'system').
    if (!m.dataset.original) m.dataset.original = m.content;
    // 'system' : chaque balise garde sa couleur et sa media query, le navigateur choisit seul.
    // Thème forcé : les deux balises prennent la même couleur, quelle que soit la media query.
    m.content = t === 'system' ? m.dataset.original : COLORS[t];
  });
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  root.style.colorScheme = effectiveTheme(t);
  syncMetaThemeColor(t);
}

export function setTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch { /* stockage indisponible : le choix vaut pour cette session */ }
  applyTheme(t);
  dispatchEvent(new CustomEvent<Theme>(EVENT, { detail: t }));
}

/** Thème choisi + thème effectif ; se met à jour si le système change ou dans un autre onglet. */
export function useTheme() {
  const [theme, setState] = useState<Theme>(readTheme);
  const [resolved, setResolved] = useState(() => effectiveTheme(theme));

  useEffect(() => {
    const onChange = (e: Event) => setState((e as CustomEvent<Theme>).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY && e.key !== null) return;
      const t = readTheme();
      applyTheme(t);
      setState(t);
    };
    addEventListener(EVENT, onChange);
    addEventListener('storage', onStorage);
    return () => { removeEventListener(EVENT, onChange); removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    applyTheme(theme);
    setResolved(effectiveTheme(theme));
    if (theme !== 'system') return;
    let mq: MediaQueryList;
    try { mq = matchMedia('(prefers-color-scheme: dark)'); } catch { return; }
    const on = () => { applyTheme('system'); setResolved(effectiveTheme('system')); };
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [theme]);

  const choose = useCallback((t: Theme) => setTheme(t), []);
  return { theme, resolved, setTheme: choose };
}
