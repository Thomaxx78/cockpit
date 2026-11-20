import { useLayoutEffect, useState, type RefObject } from 'react';
import { prefersReducedMotion } from './motion';

/* ---------- Sorties en douceur ----------
   Une fenêtre, un menu ou un panneau ne disparaît plus d'un coup : il reste affiché le
   temps de son animation de sortie (classe `.leaving`, styles/motion-overlays.css), puis
   il est retiré. Pendant la sortie, il est inerte : ni clic, ni focus, ni clavier (pas
   de double envoi, la page dessous reste cliquable). */

/** Durées de sortie (ms), à garder égales à celles de motion-overlays.css. */
export const EXIT_MS = { modal: 180, sheet: 220, palette: 140, menu: 120, panel: 180 } as const;

/** Durée de sortie d'une fenêtre : feuille du bas sur téléphone, sinon fenêtre centrée. */
export const modalExitMs = () => {
  try { return matchMedia('(max-width: 700px)').matches ? EXIT_MS.sheet : EXIT_MS.modal; } catch { return EXIT_MS.modal; }
};

/**
 * `open` passe à faux → `closing` vrai pendant `ms`, puis `mounted` faux.
 * Rouvert pendant la sortie : l'élément reste en place et repart. Avec « réduire les
 * animations » (ou onglet caché), retrait immédiat, avant tout affichage.
 */
export function usePresence(open: boolean, ms: number) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useLayoutEffect(() => {
    if (open || !mounted) return;
    if (prefersReducedMotion() || document.hidden) { setMounted(false); return; }
    const id = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(id);
  }, [open, mounted, ms]);
  return { mounted: mounted || open, closing: mounted && !open };
}

/** Rend l'élément inerte (attribut `inert`, absent des types de React 18) : le focus en sort. */
export function useInert(ref: RefObject<HTMLElement>, on: boolean) {
  useLayoutEffect(() => { ref.current?.toggleAttribute('inert', on); }, [ref, on]);
}
