import { useEffect, useId, useState } from 'react';

/* Logo du Cockpit : deux sommets, un astre qui parcourt le ciel et un petit randonneur.
   Jour (7h–20h) : le soleil se lève à gauche, culmine et se couche à droite derrière les sommets.
   Nuit : la lune fait le même trajet. Le temps est accéléré (une journée = CYCLE_MS, 40 s) et part
   de l'heure réelle. Le randonneur gravit le grand sommet, lève les bras en haut, redescend au
   col, passe le petit sommet et repart du pied gauche. Avec « réduire les animations », l'astre
   reste à sa place réelle et le randonneur se tient au sommet, immobile. */
const DAY_START = 7;
const DAY_END = 20;
const CYCLE_MS = 40_000;
const FRAME_MS = 33; // ~30 images/s : assez pour une marche fluide, sans charger le processeur

/** Position sur l'arc (viewBox 32×32) et nature de l'astre pour une heure (0–24). */
function skyAt(h: number) {
  const day = h >= DAY_START && h < DAY_END;
  const span = day ? DAY_END - DAY_START : 24 - (DAY_END - DAY_START);
  const since = day ? h - DAY_START : (h - DAY_END + 24) % 24;
  const t = since / span; // 0 = lever, 1 = coucher
  // Aux extrémités l'astre est sous l'horizon (y > 25 + rayon) : le passage soleil ↔ lune est invisible.
  // Puissance < 1 : montée et descente raides, l'astre reste caché très peu de temps entre soleil et lune.
  return { day, x: 6 + 20 * t, y: 29.5 - 22.5 * Math.sin(Math.PI * t) ** 0.4 };
}

const realHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

/* ---------- Randonneur ----------
   Trajet sur la crête (mêmes points que le dessin des montagnes). La durée de chaque tronçon
   dépend de sa longueur et de la pente : on monte plus lentement qu'on ne descend. */
const RIDGE: [number, number][] = [[3, 25], [12.5, 9.5], [18, 18.5], [21, 14], [29, 25]];
const SUMMIT_PAUSE = 1300; // ms, bras levés au sommet
const HIKER_SCALE = 1.45; // taille du randonneur : lisible dès 36 px
const SEGMENTS = RIDGE.slice(1).map(([bx, by], i) => {
  const [ax, ay] = RIDGE[i];
  const len = Math.hypot(bx - ax, by - ay);
  return { ax, ay, dx: (bx - ax) / len, dy: (by - ay) / len, len, ms: len * (by < ay ? 340 : 210) };
});
const WALK_MS = SEGMENTS.reduce((s, g) => s + g.ms, 0) + SUMMIT_PAUSE;

const LEAN_UP = 0.6, LEAN_DOWN = -0.2; // penché en avant en montée, en arrière en descente
const BLEND = 1.2; // unités de crête sur lesquelles on passe d'une pose à l'autre
const RAISE_MS = 380; // montée et descente des bras au sommet
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => k * k * (3 - 2 * k); // départ et arrivée en douceur
const segLean = (i: number) => (SEGMENTS[i].dy < 0 ? LEAN_UP : LEAN_DOWN);

/**
 * Pose du randonneur à l'instant `ms`. Tout varie en continu, sans à-coup :
 * - `amp` (ampleur du pas) retombe à 0 aux changements de pente et au sommet : les pieds se
 *   rejoignent avant que la pente change (sinon ils sauteraient d'une pente à l'autre) ;
 * - `lean` passe progressivement d'une inclinaison à l'autre ;
 * - `raise` (bras levés) monte puis redescend en douceur pendant la pause au sommet.
 */
function hikerAt(ms: number) {
  const loop = ms % WALK_MS;
  let t = loop, dist = 0;
  for (let i = 0; i < SEGMENTS.length; i++) {
    const g = SEGMENTS[i];
    if (t < g.ms) {
      const d = g.len * (t / g.ms);
      const near = Math.min(1, d / BLEND, (g.len - d) / BLEND);
      // Inclinaison : partie de celle du tronçon précédent (debout au sortir du sommet),
      // tend vers « debout » en approchant du sommet.
      let lean = segLean(i);
      if (d < BLEND && i > 0) lean = mix(i === 1 ? 0 : segLean(i - 1), lean, ease(d / BLEND));
      if (g.len - d < BLEND && i === 0) lean = mix(0, lean, ease((g.len - d) / BLEND));
      return { x: g.ax + g.dx * d, y: g.ay + g.dy * d, slope: g.dy / g.dx, dist: dist + d, amp: ease(near), lean, raise: 0, loop };
    }
    t -= g.ms; dist += g.len;
    if (i === 0) { // pause au grand sommet
      if (t < SUMMIT_PAUSE) {
        const raise = ease(Math.min(1, t / RAISE_MS, (SUMMIT_PAUSE - t) / RAISE_MS));
        return { x: RIDGE[1][0], y: RIDGE[1][1], slope: 0, dist, amp: 0, lean: 0, raise, loop };
      }
      t -= SUMMIT_PAUSE;
    }
  }
  return { x: RIDGE[4][0], y: RIDGE[4][1], slope: 0, dist, amp: 0, lean: 0, raise: 0, loop };
}

/** Petit bonhomme bâton : pieds posés sur la pente, buste penché dans la montée, bras et jambes alternés. */
function Hiker({ ms, still }: { ms: number; still: boolean }) {
  const h = still
    ? { x: RIDGE[1][0], y: RIDGE[1][1], slope: 0, dist: 0, amp: 0, lean: 0, raise: 1, loop: WALK_MS / 2 }
    : hikerAt(ms);
  const phase = h.dist * 1.7; // ≈ 2 pas par 3,7 unités de crête
  const swing = Math.sin(phase) * h.amp;
  // Dessin en coordonnées locales (pieds en 0,0), agrandi de HIKER_SCALE autour du point
  // de crête : agrandir autour de ce point garde les pieds sur la pente. Pas mesurés à
  // l'horizontale (sur une pente raide, les jambes se confondraient), y suit la pente.
  const sx = swing * 0.85;
  const f1 = [sx, sx * h.slope];
  const f2 = [-sx, -sx * h.slope];
  const lean = h.lean;
  const bob = Math.abs(Math.cos(phase)) * 0.2 * h.amp; // le corps se soulève à chaque pas
  const hip = [lean * 0.3, -1.8 - bob];
  const sh = [hip[0] + lean, hip[1] - 1.5];
  const head = [sh[0] + lean * 0.4, sh[1] - 1];
  // Genoux poussés vers l'avant (sens de la marche) : la jambe se plie, on lit une marche.
  const knee = (f: number[]) => [(hip[0] + f[0]) / 2 + 0.35 * Math.max(h.amp, 0.3), (hip[1] + f[1]) / 2];
  // Bras : balancier pendant la marche, levés en V au sommet (la tête reste dégagée), avec un
  // passage continu de l'un à l'autre.
  const hand = (side: -1 | 1): [number, number] => [
    sh[0] + mix(side * swing * 0.85, side * 1.05, h.raise),
    sh[1] + mix(1.1, -1.7, h.raise),
  ];
  const hands = [hand(-1), hand(1)];
  // Fondu au départ (pied gauche) et à l'arrivée (pied droit) : la boucle ne se voit pas.
  const edge = Math.min(h.loop, WALK_MS - h.loop);
  const opacity = Math.min(1, edge / 450);
  const p = (a: number[]) => `${a[0].toFixed(2)} ${a[1].toFixed(2)}`;
  return (
    <g className="logo-hiker" opacity={opacity.toFixed(2)} transform={`translate(${p([h.x, h.y])}) scale(${HIKER_SCALE})`}
      fill="none" stroke="var(--logo-hiker)" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${p(f1)} L${p(knee(f1))} L${p(hip)} L${p(knee(f2))} L${p(f2)} M${p(hip)} L${p(sh)} M${p(hands[0])} L${p(sh)} L${p(hands[1])}`} />
      <circle cx={head[0].toFixed(2)} cy={head[1].toFixed(2)} r=".8" fill="var(--logo-hiker)" stroke="none" />
    </g>
  );
}

/** Horloge du logo : heure accélérée (astre) et temps écoulé (randonneur). */
function useLogoClock() {
  const [clock, setClock] = useState(() => ({ hour: realHour(), ms: 0, still: false }));
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setClock({ hour: realHour(), ms: 0, still: true });
      const id = setInterval(() => setClock({ hour: realHour(), ms: 0, still: true }), 60_000);
      return () => clearInterval(id);
    }
    const start = performance.now(), h0 = realHour();
    let raf = 0, last = 0;
    const tick = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        const ms = now - start;
        setClock({ hour: (h0 + (ms / CYCLE_MS) * 24) % 24, ms, still: false });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return clock;
}

export function Logo({ size = 20 }: { size?: number }) {
  const clock = useLogoClock();
  const { day, x, y } = skyAt(clock.hour);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const mask = `lune${uid}`, sky = `ciel${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" overflow="visible">
      <defs>
        {/* croissant de lune : disque moins un disque décalé */}
        <mask id={mask}>
          <circle r="3.2" fill="#fff" />
          <circle cx="1.6" cy="-1.1" r="2.7" fill="#000" />
        </mask>
        {/* ciel = tout ce qui est au-dessus de l'horizon (pied des montagnes) */}
        <clipPath id={sky}><rect x="-8" y="-8" width="48" height="33" /></clipPath>
      </defs>
      <g clipPath={`url(#${sky})`}>
        <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
          {day
            ? <circle r="3.4" fill="#ffc94d" />
            : <circle r="3.2" fill="var(--logo-moon)" mask={`url(#${mask})`} />}
        </g>
      </g>
      <path d="M3 25 L12.5 9.5 L18 18.5 L21 14 L29 25 Z" fill="currentColor" />
      {/* versant à l'ombre du grand sommet */}
      <path d="M12.5 9.5 L18 18.5 L16.4 25 L13.8 25 Z" fill="#000" opacity=".16" />
      {/* trop petit pour être lisible en dessous de 30 px : pas de randonneur */}
      {size >= 30 && <Hiker ms={clock.ms} still={clock.still} />}
    </svg>
  );
}

/** Écran d'attente plein écran : même place et même fond que l'écran de démarrage de index.html
    (classe .boot), pour que le passage du HTML statique à l'appli ne se voie pas. */
export function Splash() {
  return <div className="boot" role="status" aria-label="Chargement"><Logo size={72} /></div>;
}
