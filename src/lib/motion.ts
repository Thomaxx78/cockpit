import { useEffect } from 'react';
import { flushSync } from 'react-dom';

/* ---------- Transitions d'interface ----------
   On s'appuie sur l'API View Transitions du navigateur : il photographie l'écran avant et
   après la mise à jour, puis anime le passage (styles dans styles.css, section « Mouvement »).
   `data-vt` sur <html> indique le type de transition en cours ('page', 'auth', 'theme') pour
   que la feuille de style choisisse l'animation. Sans l'API, ou avec « réduire les
   animations », la mise à jour est appliquée directement. */

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

export const prefersReducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export const canTransition = () => !!(document as VTDocument).startViewTransition && !prefersReducedMotion() && !document.hidden;

/** Vrai pendant le rendu déclenché par une transition de page (voir <Main> dans App). */
export const inPageTransition = () => document.documentElement.dataset.vt === 'page';

export function transition(update: () => void, kind: 'page' | 'auth' | 'theme') {
  if (!canTransition()) { update(); return; }
  const root = document.documentElement;
  root.dataset.vt = kind;
  const t = (document as VTDocument).startViewTransition!(() => flushSync(update));
  t.finished.finally(() => { if (root.dataset.vt === kind) delete root.dataset.vt; });
}

/* ---------- Ciel ----------
   Moment de la journée (heure réelle) posé sur <html data-sky="…"> : la barre latérale
   prend une lueur d'aube, de jour, de crépuscule ou de nuit, comme le logo. */
type Sky = 'dawn' | 'day' | 'dusk' | 'night';
const skyNow = (): Sky => {
  const h = new Date().getHours();
  return h >= 6 && h < 9 ? 'dawn' : h >= 9 && h < 17 ? 'day' : h >= 17 && h < 21 ? 'dusk' : 'night';
};

export function useSkyPhase() {
  useEffect(() => {
    const set = () => { document.documentElement.dataset.sky = skyNow(); };
    set();
    const id = setInterval(set, 60_000);
    return () => clearInterval(id);
  }, []);
}
