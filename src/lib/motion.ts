import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
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

/* ---------- Indicateur qui glisse ----------
   Fond de l'élément actif d'un menu (barre latérale, onglets du téléphone) : un seul élément,
   placé sous les liens, qui se déplace en CSS jusqu'à l'élément actif. Il reste dessous :
   les textes du menu sont toujours lisibles pendant le déplacement. */
export function useSlidingIndicator(container: RefObject<HTMLElement>, selector: string, key: unknown): CSSProperties {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number; ready: boolean } | null>(null);
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el || !el.offsetParent) { setBox(null); return; }
      // Position de mise en page (offset*), pas getBoundingClientRect : on ignore ainsi les
      // décalages des animations d'arrivée. Le conteneur doit être positionné (offsetParent).
      let x = 0, y = 0;
      for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) { x += n.offsetLeft; y += n.offsetTop; }
      // `ready` passe à vrai après la première mesure : pas de glissement depuis le coin à l'ouverture.
      setBox(b => ({ x, y, w: el.offsetWidth, h: el.offsetHeight, ready: b !== null }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [container, selector, key]);
  if (!box) return { opacity: 0 };
  return {
    transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h,
    transition: box.ready ? undefined : 'none',
  };
}
